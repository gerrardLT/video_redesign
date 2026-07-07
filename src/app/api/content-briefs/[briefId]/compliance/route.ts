/**
 * POST /api/content-briefs/[briefId]/compliance — 触发合规检查
 * GET /api/content-briefs/[briefId]/compliance — 获取合规检查结果
 *
 * POST: 对指定 VideoVariant 执行合规检查
 * GET: 获取该 ContentBrief 的所有合规检查记录
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * POST 请求体：
 * - videoVariantId: string (要检查的视频版本 ID)
 *
 * 响应：
 * - 200 (GET): { checks: ComplianceCheck[] }
 * - 201 (POST): { check: ComplianceCheck }
 * - 400: 参数缺失
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 或 VideoVariant 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 9.1, 9.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { runComplianceCheck } from '@/lib/merchant/compliance-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/**
 * 验证 ContentBrief 归属并返回 brief
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

export async function GET(request: NextRequest, context: RouteContext) {
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

    // 查询所有合规检查记录
    const checks = await prisma.complianceCheck.findMany({
      where: { contentBriefId: briefId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ checks })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/content-briefs/[briefId]/compliance] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
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
    let body: { videoVariantId?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    const { videoVariantId } = body
    if (!videoVariantId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少 videoVariantId 字段' } },
        { status: 400 }
      )
    }

    // 验证 VideoVariant 归属
    const variant = await prisma.videoVariant.findUnique({
      where: { id: videoVariantId },
    })

    if (!variant || variant.contentBriefId !== briefId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'VideoVariant 不存在或不属于该 ContentBrief' } },
        { status: 404 }
      )
    }

    // 执行合规检查
    const check = await runComplianceCheck({
      contentBriefId: briefId,
      videoVariantId,
    })

    return NextResponse.json({ check }, { status: 201 })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/compliance] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
