/**
 * GET /api/stores/[storeId]/notifications — 通知中心列表（当前门店作用域）
 *
 * 调用 task-center-service.listNotifications：仅返回当前所选门店作用域的通知，
 * 按创建时间倒序，含已读 / 未读状态，不跨店混合。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { notifications: StoreNotification[] }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 9.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { listNotifications } from '@/lib/merchant/task-center-service'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 查询当前门店作用域的通知列表（不消耗积分）
    const notifications = await listNotifications({ storeId })

    return NextResponse.json({ notifications })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores/[storeId]/notifications] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
