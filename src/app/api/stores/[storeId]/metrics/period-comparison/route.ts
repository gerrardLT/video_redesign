/**
 * GET /api/stores/[storeId]/metrics/period-comparison — 跨周对比视图
 *
 * 调用 performance-learning-service.getPeriodComparison：按 period-service 周期口径
 * 比较两个最近「已结束且含数据」的内容周期（本周 vs 上周关键指标增减）。
 * - 已结束且含数据的周期 <2 时返回 { available:false, reason }，不伪造对比。
 * - 否则返回 { available:true, current, previous, deltas }。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { available: false, reason: string } | { available: true, current, previous, deltas }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 1.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { getPeriodComparison } from '@/lib/merchant/performance-learning-service'
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

    // 调用跨周对比服务（不消耗积分）
    const result = await getPeriodComparison({ storeId })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores/[storeId]/metrics/period-comparison] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
