/**
 * PATCH /api/stores/[storeId]/notifications/[notificationId]/read — 标记门店通知已读（置 read=true）
 *
 * 说明：本端点为「门店作用域」通知（StoreNotification）的标记已读。挂在门店作用域路径下，
 * 与既有 user 作用域通知端点 /api/notifications/[id]/read 区分，避免 Next.js App Router
 * 同层动态段不同 slug 名（[id] vs [notificationId]）导致的构建冲突。
 *
 * 调用 task-center-service.markNotificationRead：将指定 StoreNotification 置 read=true。
 *
 * 鉴权（防越权改他人/他店通知）：
 * 1. 先查 StoreNotification 取出其 storeId（通知不存在 → 404）；
 * 2. 校验通知所属 storeId 与路径 storeId 一致（不一致 → 404，避免跨店越权）；
 * 3. 通过 validateMerchantAccess 校验该 storeId 归属当前 merchant；
 * 4. 校验通过后才调用服务标记已读。
 *
 * Route Handler 仅做鉴权 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 响应：
 * - 200: { success: true }
 * - 401: 未认证
 * - 403: 无权限（通知所属门店非当前 merchant）
 * - 404: 通知不存在或不属于该门店
 * - 500: 服务器内部错误
 *
 * Requirements: 9.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { markNotificationRead, TaskCenterError } from '@/lib/task-center-service'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string; notificationId: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { storeId, notificationId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 1. 先查通知取出其 storeId（不存在 → 404）
    const notification = await prisma.storeNotification.findUnique({
      where: { id: notificationId },
      select: { storeId: true },
    })
    if (!notification) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '通知不存在' } },
        { status: 404 }
      )
    }

    // 2. 校验通知归属路径 storeId（避免跨店越权读写）
    if (notification.storeId !== storeId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '通知不属于该门店' } },
        { status: 404 }
      )
    }

    // 3. 校验该门店归属当前 merchant（防越权改他人通知）
    await validateMerchantAccess(userId, storeId)

    // 4. 标记已读（置 read=true，不消耗积分）
    await markNotificationRead({ notificationId })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    // 服务层通知缺失（与上文查询之间的竞态）映射为 404
    if (error instanceof TaskCenterError && error.code === 'NOTIFICATION_NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '通知不存在' } },
        { status: 404 }
      )
    }
    console.error('[PATCH /api/stores/[storeId]/notifications/[notificationId]/read] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
