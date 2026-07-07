/**
 * POST /api/content-briefs/[briefId]/copy/rewrite-platform — 按平台调性改写文案（需求 2.4, 2.3）
 *
 * 以该平台现有文案为输入，按抖音/小红书/视频号等平台调性重写（保留门店核心卖点与优惠信息），
 * 替换 platformCopies[platform] 并清除人工修改标记，返回新文案供前端预览采纳。
 *
 * 消耗积分：服务层经 credit-service（reserve→charge/refund）+ withCreditLock 全局锁，
 * 执行外部 LLM 推理前先做余额预检（不足显式抛 INSUFFICIENT_CREDITS → 402）。
 * 目标文案存在人工修改标记且未确认覆盖时，服务层抛 CONFIRM_OVERWRITE_REQUIRED → 409（需求 2.3）。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId（brief→store→merchant→user 归属校验）
 *
 * 请求体：{ platform: PublishPlatform, confirmOverwrite?: boolean }
 *
 * 响应：
 * - 200: { preview: PlatformCopy }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 403: 无权限
 * - 404: ContentBrief 不存在 / 该平台暂无现有文案 / 门店画像缺失
 * - 409: 需确认覆盖人工修改（CONFIRM_OVERWRITE_REQUIRED）
 * - 500: 服务器内部错误
 *
 * Requirements: 2.4, 2.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { rewriteForPlatform } from '@/lib/merchant/publish-copy-service'
import { PublishPlatformSchema } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 请求体校验 Schema */
const RewritePlatformRequestSchema = z.object({
  platform: PublishPlatformSchema,
  /** 覆盖人工修改的显式确认（需求 2.3），默认 false */
  confirmOverwrite: z.boolean().optional().default(false),
})

/**
 * 验证 ContentBrief 归属（brief→store→merchant→user）并返回校验结果。
 */
async function validateBriefOwnership(briefId: string, userId: string) {
  const brief = await prisma.contentBrief.findUnique({
    where: { id: briefId },
    include: {
      store: {
        include: {
          merchant: { select: { userId: true } },
        },
      },
    },
  })

  if (!brief) {
    return { error: 'NOT_FOUND' as const, brief: null }
  }

  if (brief.store.merchant.userId !== userId) {
    return { error: 'FORBIDDEN' as const, brief: null }
  }

  return { error: null, brief }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    const { error, brief } = await validateBriefOwnership(briefId, userId)
    if (error === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }
    if (error === 'FORBIDDEN' || !brief) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

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

    const parseResult = RewritePlatformRequestSchema.safeParse(body)
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

    const { platform, confirmOverwrite } = parseResult.data

    // 按平台改写（消耗积分；余额预检 / 人工修改覆盖确认 / 计费均在服务层处理）
    const result = await rewriteForPlatform({
      contentBriefId: briefId,
      platform,
      userId,
      confirmOverwrite,
    })

    return NextResponse.json(result)
  } catch (error) {
    // INSUFFICIENT_CREDITS → 402、CONFIRM_OVERWRITE_REQUIRED → 409 等由 ApiError.statusCode 映射
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/copy/rewrite-platform] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '服务器内部错误' } },
      { status: 500 }
    )
  }
}
