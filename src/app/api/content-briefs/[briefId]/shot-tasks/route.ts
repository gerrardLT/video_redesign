/**
 * GET /api/content-briefs/[briefId]/shot-tasks — 获取拍摄任务列表
 *
 * 返回指定 ContentBrief 的所有 ShotTasks，按 order 升序排列。
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 200: { shotTasks: ShotTask[] }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 5.1, 5.2, 5.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'

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

    // 验证归属关系
    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 查询 ShotTasks，按 order 升序，含关联的 RawAssets
    const shotTasks = await prisma.shotTask.findMany({
      where: { contentBriefId: briefId },
      orderBy: { order: 'asc' },
      include: {
        rawAssets: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    return NextResponse.json({ shotTasks })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/content-briefs/[briefId]/shot-tasks] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
