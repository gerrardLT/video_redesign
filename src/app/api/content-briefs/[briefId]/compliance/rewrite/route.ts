/**
 * POST /api/content-briefs/[briefId]/compliance/rewrite — 一键改写规避 + 自动重跑合规（需求 2.5, 2.6, 2.7）
 *
 * 读取最近一次合规检查命中的违禁词/风险点(evidence) → 调用真实 LLM 产出去违禁的合规候选文案
 * → 写回 brief 的 suggested* 草稿字段 → 自动重新跑一次合规检查 → 仍 HIGH/BLOCKED 时
 * stillBlocked=true 显式返回剩余风险，绝不标记通过。
 *
 * 消耗积分：服务层经 credit-service（reserve→charge/refund）+ withCreditLock 全局锁，
 * 执行外部 LLM 推理前先做余额预检（不足显式抛 INSUFFICIENT_CREDITS → 402）。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId（brief→store→merchant→user 归属校验）；
 * 并校验 videoVariant 归属于该 brief。
 *
 * 请求体：{ videoVariantId: string }
 *
 * 响应：
 * - 200: { rewrittenCopy: PlatformCopy, recheck: ComplianceCheck, stillBlocked: boolean }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 403: 无权限
 * - 404: ContentBrief / VideoVariant 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 2.5, 2.6, 2.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { rewriteToCompliant } from '@/lib/merchant/compliance-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 请求体校验 Schema */
const ComplianceRewriteRequestSchema = z.object({
  videoVariantId: z.string().min(1, '缺少 videoVariantId'),
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

    const parseResult = ComplianceRewriteRequestSchema.safeParse(body)
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

    const { videoVariantId } = parseResult.data

    // 校验 VideoVariant 归属于该 brief
    const variant = await prisma.videoVariant.findUnique({
      where: { id: videoVariantId },
      select: { contentBriefId: true },
    })
    if (!variant || variant.contentBriefId !== briefId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'VideoVariant 不存在或不属于该 ContentBrief' } },
        { status: 404 }
      )
    }

    // 一键改写规避 + 自动重跑合规（消耗积分；余额预检 / 计费均在服务层处理）
    const result = await rewriteToCompliant({
      contentBriefId: briefId,
      videoVariantId,
      userId,
    })

    return NextResponse.json(result)
  } catch (error) {
    // INSUFFICIENT_CREDITS → 402 等由 ApiError.statusCode 映射
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/compliance/rewrite] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '服务器内部错误' } },
      { status: 500 }
    )
  }
}
