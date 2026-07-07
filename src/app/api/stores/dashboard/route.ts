/**
 * GET /api/stores/dashboard — 跨店看板聚合（需求 10.3, 10.5）
 *
 * 鉴权：从 x-user-id header 获取用户 ID。
 * 调用 cross-store-service.getCrossStoreDashboard，对商家名下每家门店做真实聚合查询，
 * 返回各门店的本周内容完成度、最佳视频表现、待办数，绝不占位/伪造。
 *
 * 可见性（单店/无多店权益时隐藏看板）由 /api/stores/switcher 统一裁决并交前端控制；
 * 本端点始终对所有名下门店返回真实聚合（无门店时返回空数组）。
 *
 * 纯读库，不消耗积分。
 *
 * 响应：
 * - 200: { stores: StoreKpiSummary[] }
 * - 401: 未认证
 * - 500: 服务器内部错误
 *
 * Requirements: 10.3, 10.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { getCrossStoreDashboard } from '@/lib/merchant/cross-store-service'
import { ApiError } from '@/lib/shared/api-error'
export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)
    // 2. 跨店看板真实聚合（逐店本周完成度/最佳视频/待办数）
    const stores = await getCrossStoreDashboard({ userId })
    return NextResponse.json({ stores })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/dashboard] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
