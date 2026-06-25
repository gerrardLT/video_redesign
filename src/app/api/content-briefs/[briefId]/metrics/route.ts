/**
 * POST /api/content-briefs/[briefId]/metrics — 录入表现数据
 * GET  /api/content-briefs/[briefId]/metrics — 获取表现数据
 *
 * POST: 创建 PublishMetric 记录
 * GET: 获取该 ContentBrief 的所有 PublishMetric 记录
 *
 * 鉴权：通过 userId → Merchant → Store → ContentBrief 验证归属关系
 *
 * Requirements: 11.1-11.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { recordManualMetrics, MetricsValidationError, MetricsBusinessError } from '@/lib/metrics-ingestor'
import { ApiError } from '@/lib/api-error'
import { PublishPlatformSchema } from '@/types/merchant'
import { z } from 'zod/v4'

/** POST 请求体 Schema */
const PostMetricsSchema = z.object({
  platform: PublishPlatformSchema,
  views: z.number().int().min(0).max(999999999),
  likes: z.number().int().min(0).max(999999999),
  comments: z.number().int().min(0).max(999999999),
  shares: z.number().int().min(0).max(999999999),
  saves: z.number().int().min(0).max(999999999),
  linkClicks: z.number().int().min(0).max(999999999),
  messages: z.number().int().min(0).max(999999999),
  orders: z.number().int().min(0).max(999999999),
  redemptions: z.number().int().min(0).max(999999999),
  revenueCents: z.number().int().min(0).max(999999999),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> }
) {
  const { briefId } = await params

  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 验证归属关系
    await validateBriefAccess(userId, briefId)

    // 3. 解析请求体
    const body = await request.json()
    const parseResult = PostMetricsSchema.safeParse(body)

    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of parseResult.error.issues) {
        const fieldName = issue.path.join('.') || 'unknown'
        if (!fieldErrors[fieldName]) fieldErrors[fieldName] = []
        fieldErrors[fieldName].push(issue.message)
      }
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', fieldErrors } },
        { status: 400 }
      )
    }

    const { platform, ...metrics } = parseResult.data

    // 4. 调用录入服务
    const publishMetric = await recordManualMetrics({
      contentBriefId: briefId,
      platform,
      metrics,
      userId,
    })

    return NextResponse.json({ metric: publishMetric }, { status: 201 })
  } catch (error) {
    if (error instanceof MetricsValidationError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: error.message, fieldErrors: error.fieldErrors } },
        { status: 400 }
      )
    }
    if (error instanceof MetricsBusinessError) {
      const statusMap: Record<string, number> = {
        CONTENT_BRIEF_NOT_FOUND: 404,
        CONTENT_BRIEF_NOT_ELIGIBLE: 400,
        METRICS_LIMIT_EXCEEDED: 400,
      }
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: statusMap[error.code] ?? 400 }
      )
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error(`[POST /api/content-briefs/${briefId}/metrics] 未知错误:`, error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> }
) {
  const { briefId } = await params

  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 验证归属关系
    await validateBriefAccess(userId, briefId)

    // 3. 查询所有 metrics
    const metrics = await prisma.publishMetric.findMany({
      where: { contentBriefId: briefId },
      orderBy: { capturedAt: 'desc' },
    })

    return NextResponse.json({ metrics, total: metrics.length })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error(`[GET /api/content-briefs/${briefId}/metrics] 未知错误:`, error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

// ========================
// 内部工具函数
// ========================

/**
 * 验证用户对 ContentBrief 的访问权限
 * 通过 userId → Merchant → Store → ContentBrief 关系链验证
 *
 * @throws ApiError 403/404
 */
async function validateBriefAccess(userId: string, briefId: string): Promise<void> {
  const contentBrief = await prisma.contentBrief.findUnique({
    where: { id: briefId },
    include: {
      store: {
        include: { merchant: true },
      },
    },
  })

  if (!contentBrief) {
    throw new ApiError('NOT_FOUND', 'ContentBrief 不存在', 404)
  }

  if (contentBrief.store.merchant.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权访问该内容任务', 403)
  }
}
