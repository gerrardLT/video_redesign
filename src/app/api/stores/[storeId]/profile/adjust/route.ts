/**
 * PATCH /api/stores/[storeId]/profile/adjust — 调整门店画像依据（可干预 + 可反哺）
 *
 * 调用 store-profile-service.adjustStoreProfile：剔除钩子词 / 替换卖点 / 修改人设 / 修改 CTA。
 * 仅更新当前画像，对调整之后发起的生成生效；不回溯重写既有 brief 的脚本/文案/溯源快照（需求 5.4）。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { profile: StoreProfile, message: string }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 404: 门店或画像不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 5.3, 5.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { adjustStoreProfile } from '@/lib/merchant/store-profile-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

/**
 * 画像调整请求体校验：
 * - 各字段均为可选，仅对提供的字段做调整
 * - removeHookKeywords：需剔除的钩子关键词
 * - updateSellingPoints：卖点替换（from→to）
 * - updatePersona：覆盖推荐人设
 * - updateCta：整体覆盖首选 CTA
 * - 至少需提供一项调整，避免空请求
 */
const AdjustProfileSchema = z
  .object({
    removeHookKeywords: z.array(z.string().min(1)).optional(),
    updateSellingPoints: z
      .array(
        z.object({
          from: z.string().min(1),
          to: z.string().min(1),
        })
      )
      .optional(),
    updatePersona: z.string().optional(),
    updateCta: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (data) =>
      data.removeHookKeywords !== undefined ||
      data.updateSellingPoints !== undefined ||
      data.updatePersona !== undefined ||
      data.updateCta !== undefined,
    { message: '至少需提供一项画像调整' }
  )

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const parseResult = AdjustProfileSchema.safeParse(body)
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

    // 调用服务调整画像（仅对后续生成生效，不回溯；不消耗积分）
    const profile = await adjustStoreProfile({
      storeId,
      patch: parseResult.data,
    })

    return NextResponse.json({ profile, message: '画像已调整，仅对后续生成生效' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PATCH /api/stores/[storeId]/profile/adjust] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
