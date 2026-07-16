/**
 * /api/stores/[storeId]/platform-accounts — 自营平台账号关联（不消耗积分）
 *
 * GET：列出本门店已关联的平台账号（仅非敏感字段，供前端展示状态/「需重新关联」入口）。
 *      绝不返回 encryptedCookie 等凭证密文。
 *
 * POST：复用 platform-metrics-crawler 服务层，支持两阶段授权流程（需求 7.2/7.3/7.4）：
 *  - 阶段一（风险告知 + 授权前置）：请求体仅含 platform 时，调用 requestAccountLink，
 *    返回平台 ToS 提示、风险点列表与一次性授权握手 authToken；此阶段不保存任何凭证。
 *  - 阶段二（保存凭证）：请求体含 cookie + authConfirmed=true 时，调用 saveCredential，
 *    服务端对 cookie 加密后落库（明文凭证仅服务端处理，绝不返回给前端）。
 *    authConfirmed 非 true 时服务层抛 CredentialAuthError，本路由映射为 403。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200(GET): { accounts: SafePlatformAccount[] }
 * - 200(POST): 阶段一 { phase: 'AUTH_NOTICE', tosNotice, risks, authToken }
 *              阶段二 { phase: 'SAVED', account, message }
 * - 400: 参数校验失败 / 请求体格式错误
 * - 401: 未认证
 * - 403: 无权限（非本门店）/ 未完成授权确认（CredentialAuthError）
 * - 500: 服务器内部错误
 *
 * Requirements: 7.2, 7.3, 7.4, 7.6, 7.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import {
  requestAccountLink,
  saveCredential,
  CredentialAuthError,
} from '@/lib/merchant/platform-metrics-crawler'
import { PublishPlatformSchema } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'
import { prisma } from '@/lib/shared/db'
import { logger } from '@/lib/shared/logger'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

/**
 * GET — 列出本门店已关联平台账号（仅非敏感字段）。
 * 用于前端展示关联状态、失效后「需重新关联」入口（需求 7.6/7.8）；不返回凭证密文。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)
    await validateMerchantAccess(userId, storeId)

    // 仅 select 非敏感字段，从源头杜绝 encryptedCookie 外泄
    const accounts = await prisma.platformAccount.findMany({
      where: { storeId },
      select: {
        id: true,
        platform: true,
        status: true,
        authConfirmed: true,
        lastCrawledAt: true,
        crawlIntervalH: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ accounts })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores/[storeId]/platform-accounts] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

/**
 * 关联请求体校验：
 * - platform 必填（限定为受支持的发布平台枚举）。
 * - 当未提供 cookie 时视为阶段一（仅风险告知 + 获取 authToken）。
 * - 当提供 cookie 时视为阶段二（保存凭证）：此时 authConfirmed 与 authToken 必填，
 *   authConfirmed 必须为 true（最终强校验由服务层 saveCredential 把关，抛 CredentialAuthError）。
 * - crawlIntervalH 可选，服务层会夹紧到 [6,24] 小时。
 */
const LinkPlatformAccountSchema = z.object({
  platform: PublishPlatformSchema,
  cookie: z.string().min(1).optional(),
  authConfirmed: z.boolean().optional(),
  authToken: z.string().min(1).optional(),
  crawlIntervalH: z.number().optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    // Zod 校验
    const parseResult = LinkPlatformAccountSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }

    const data = parseResult.data

    // ─── 阶段一：未提供 cookie → 返回风险告知与一次性授权 token，不保存任何凭证 ───
    if (!data.cookie) {
      const linkRequest = await requestAccountLink({ storeId, platform: data.platform })
      return NextResponse.json({
        phase: 'AUTH_NOTICE',
        tosNotice: linkRequest.tosNotice,
        risks: linkRequest.risks,
        authToken: linkRequest.authToken,
      })
    }

    // ─── 阶段二：已提供 cookie → 保存凭证（authConfirmed 由服务层强校验把关）───
    const account = await saveCredential({
      storeId,
      platform: data.platform,
      cookie: data.cookie,
      authConfirmed: data.authConfirmed === true,
      crawlIntervalH: data.crawlIntervalH,
    })

    // 安全：绝不向前端返回加密后的凭证密文（encryptedCookie），仅回传非敏感字段
    const { encryptedCookie: _encryptedCookie, ...safeAccount } = account
    void _encryptedCookie

    return NextResponse.json({
      phase: 'SAVED',
      account: safeAccount,
      message: '平台账号关联成功，凭证已加密存储',
    })
  } catch (error) {
    // 授权未确认：映射为 403（属授权前置未满足，而非参数格式问题）
    if (error instanceof CredentialAuthError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 }
      )
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[POST /api/stores/[storeId]/platform-accounts] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
