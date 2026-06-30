/**
 * GET /api/stores/switcher — 门店切换器数据（需求 10.1, 10.4）
 *
 * 鉴权：从 x-user-id header 获取用户 ID。
 * 调用 cross-store-service.getStoreSwitcher，仅当会员权益 maxStores>1 且实际拥有多家门店
 * 时返回多店列表，否则返回 { multiStore:false }，前端据此隐藏切换器与跨店看板（不展示空壳）。
 *
 * 纯读库，不消耗积分。
 *
 * 响应：
 * - 200: StoreSwitcher（{ multiStore:false } 或 { multiStore:true, stores:[...] }）
 * - 401: 未认证
 * - 500: 服务器内部错误
 *
 * Requirements: 10.1, 10.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { getStoreSwitcher } from '@/lib/cross-store-service'
import { ApiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 获取门店切换器数据（单店/无多店权益时返回 multiStore:false）
    const switcher = await getStoreSwitcher({ userId })

    return NextResponse.json(switcher)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/switcher] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
