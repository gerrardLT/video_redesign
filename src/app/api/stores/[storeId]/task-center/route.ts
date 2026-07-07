/**
 * GET /api/stores/[storeId]/task-center — 全局任务中心（当前门店作用域）
 *
 * 调用 task-center-service.getTaskCenter：按当前所选门店作用域聚合进行中的任务
 * （待拍摄 / 渲染中 / 待导出 / 待发布），每项携带非空 actionHref，仅真实状态不含占位。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { tasks: TaskCenterItem[] }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 9.1, 9.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { getTaskCenter } from '@/lib/merchant/task-center-service'
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

    // 聚合当前门店作用域下的进行中任务（不消耗积分）
    const tasks = await getTaskCenter({ storeId })

    return NextResponse.json({ tasks })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/task-center] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
