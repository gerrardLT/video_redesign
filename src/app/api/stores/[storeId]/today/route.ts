/**
 * GET /api/stores/[storeId]/today — 获取今日内容任务
 *
 * 查询条件：scheduledDate = 今天，storeId = 当前门店
 * 返回今日的 ContentBrief + 关联的 ShotTasks。
 * 如无今日任务返回 { brief: null, message: '今天没有安排任务' }
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 200: { brief: ContentBrief & { shotTasks: ShotTask[] } } | { brief: null, message: string }
 * - 401: 未认证
 * - 403: 无权限
 * - 500: 服务器内部错误
 *
 * Requirements: 5.1, 5.6, 15.1
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

    // 计算今日日期范围（本地 00:00:00 ~ 23:59:59）
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    // 查询今日的 ContentBrief + ShotTasks
    const brief = await prisma.contentBrief.findFirst({
      where: {
        storeId,
        scheduledDate: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      include: {
        shotTasks: {
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!brief) {
      return NextResponse.json({
        brief: null,
        message: '今天没有安排任务',
      })
    }

    return NextResponse.json({ brief })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/today] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
