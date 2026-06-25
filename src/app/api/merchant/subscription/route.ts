/**
 * GET /api/merchant/subscription — 获取当前用户的订阅与额度信息
 *
 * 返回：tier, 各操作当前使用量/上限, resetDate
 *
 * 响应：
 * - 200: { tier, quotas: { ... }, resetDate }
 * - 401: 未认证
 * - 500: 服务器内部错误
 *
 * Requirements: 14.6, 14.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { checkMerchantQuota, getMerchantTier } from '@/lib/merchant-quota-service'
import { ApiError } from '@/lib/api-error'
import { SUBSCRIPTION_TIERS } from '@/constants/merchant'

export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 获取订阅等级
    const tier = await getMerchantTier(userId)
    const tierConfig = SUBSCRIPTION_TIERS[tier]

    // 3. 获取各操作的额度使用情况
    const [storeQuota, contentPlanQuota, renderQuota, exportQuota, insightsQuota] =
      await Promise.all([
        checkMerchantQuota(userId, 'CREATE_STORE'),
        checkMerchantQuota(userId, 'CREATE_CONTENT_PLAN'),
        checkMerchantQuota(userId, 'RENDER_VIDEO'),
        checkMerchantQuota(userId, 'EXPORT_VIDEO'),
        checkMerchantQuota(userId, 'ACCESS_INSIGHTS'),
      ])

    // 4. 返回聚合信息
    return NextResponse.json({
      tier,
      label: tierConfig.label,
      exportResolution: tierConfig.exportResolution,
      quotas: {
        stores: storeQuota,
        contentPlans: contentPlanQuota,
        videoGenerations: renderQuota,
        export: exportQuota,
        insights: insightsQuota,
      },
      resetDate: renderQuota.resetDate ?? null,
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
