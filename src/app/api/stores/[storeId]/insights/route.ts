/**
 * GET /api/stores/[storeId]/insights — 获取复盘洞察（含解锁门控）
 *
 * 调用 performance-learning-service.getInsightsUnlockGate：
 * - 带 metrics 的 brief 数 <3 时返回 { unlocked:false, remaining:N }，
 *   前端据此显式提示「再录入 N 条即可解锁优化建议」，不渲染建议、不伪造。
 * - 达标时返回 { unlocked:true, insights }（含 suggestions/evidence/recommendedNextGoals/
 *   playbooksToReuse/playbooksToAvoid）。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { unlocked: false, remaining: number } | { unlocked: true, insights: PerformanceInsights }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 1.1, 1.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { getInsightsUnlockGate } from '@/lib/merchant/performance-learning-service'
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

    // 调用复盘解锁门控服务（不消耗积分）
    const result = await getInsightsUnlockGate({ storeId })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores/[storeId]/insights] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
