/**
 * GET /api/stores/[storeId]/publish-queue — 待发布清单视图（需求 8.2）
 *
 * 调用 publish-queue-service.listPublishQueue：返回门店作用域下所有已导出内容的
 * 待发布清单项（按导出时间倒序）。前端据每项 publishedPlatforms 区分
 * 「未发布 / 已发布到 X 平台」。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { items: PublishQueueItem[] }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 8.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { listPublishQueue } from '@/lib/merchant/publish-queue-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 调用待发布清单服务（不消耗积分）
    const items = await listPublishQueue({ storeId })

    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/publish-queue] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
