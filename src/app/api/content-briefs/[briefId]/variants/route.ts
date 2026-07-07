/**
 * GET /api/content-briefs/[briefId]/variants — 获取视频版本列表
 *
 * 返回指定 ContentBrief 的所有 VideoVariant 记录。
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 200: { variants: VideoVariant[] }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 7.1, 11.1, 12.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 ContentBrief 并验证归属
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
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 查询 VideoVariants
    const variants = await prisma.videoVariant.findMany({
      where: { contentBriefId: briefId },
      orderBy: { createdAt: 'desc' },
      include: {
        complianceChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    return NextResponse.json({ variants })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/content-briefs/[briefId]/variants] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
