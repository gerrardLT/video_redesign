/**
 * GET /api/stores/[storeId]/content-plan/current — 获取当前活跃的内容计划
 *
 * 返回最新的 ACTIVE 状态 ContentPlan，关联其下所有 ContentBriefs（含 ShotTasks）。
 * 按 startDate 降序取最新一条。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 200: { contentPlan: ContentPlan & { briefs: (ContentBrief & { shotTasks: ShotTask[] })[] } }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: 暂无内容计划
 * - 500: 服务器内部错误
 *
 * Requirements: 4.1, 5.1, 5.6, 15.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    await validateMerchantAccess(userId, storeId)

    // 查询最新的 ACTIVE 内容计划，含关联的 ContentBriefs + ShotTasks
    const contentPlan = await prisma.contentPlan.findFirst({
      where: {
        storeId,
        status: 'ACTIVE',
      },
      orderBy: { startDate: 'desc' },
      include: {
        briefs: {
          orderBy: { scheduledDate: 'asc' },
          include: {
            shotTasks: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    })

    if (!contentPlan) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '暂无活跃的内容计划' } },
        { status: 404 }
      )
    }

    return NextResponse.json({ contentPlan })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/content-plan/current] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
