/**
 * GET /api/merchant/subscription — 获取当前用户的会员权益与积分余额
 *
 * 收敛后：会员权益由 privilege-engine 的 getMerchantPrivileges 经 UserTier
 * （FREE / MONTHLY / YEARLY）映射决定，积分余额由 credit-service 的 getBalance 返回。
 * 不再汇总额度（Quota）信息。
 *
 * 响应：
 * - 200: { tier, exportResolution, complianceCheckEnabled, insightsEnabled,
 *          maxStores, batchConcurrency, creditBalance }
 * - 401: 未认证
 * - 500: 服务器内部错误
 *
 * Requirements: 2.3, 5.1, 5.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { getMerchantPrivileges } from '@/lib/privilege-engine'
import { getBalance } from '@/lib/credit-service'
import { ApiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 并行获取会员权益与积分余额
    const [privileges, creditBalance] = await Promise.all([
      getMerchantPrivileges(userId),
      getBalance(userId),
    ])

    // 3. 返回聚合信息（权益 + 积分余额）
    return NextResponse.json({
      tier: privileges.tier,
      exportResolution: privileges.exportResolution,
      complianceCheckEnabled: privileges.complianceCheckEnabled,
      insightsEnabled: privileges.insightsEnabled,
      maxStores: privileges.maxStores,
      batchConcurrency: privileges.batchConcurrency,
      creditBalance,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/merchant/subscription] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
