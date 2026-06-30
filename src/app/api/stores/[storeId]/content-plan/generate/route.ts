/**
 * POST /api/stores/[storeId]/content-plan/generate — 触发生成 7 天内容计划
 *
 * 验证商家权限后，按固定单价 CREDIT_COST_CONTENT_PLAN 冻结积分（RESERVE），
 * 通过后入队 BullMQ `generate-content-plan` 任务由 Worker 异步处理，返回 202 Accepted。
 *
 * 计费收敛说明（merchant-billing-unification）：
 * - 已移除本地生活自建额度体系（不再调用 checkMerchantQuota(CREATE_CONTENT_PLAN)）。
 * - 改为统一消费视频重塑既有积分：按固定 CREDIT_COST_CONTENT_PLAN 走
 *   reserveMerchantCredits(CONTENT_PLAN, contentPlanId, ...) 冻结。
 * - 内容计划 id 在本路由预生成（contentPlanId）并随 job 透传给 Worker，确保 Worker
 *   创建 ContentPlan 时复用同一 id，使后续 CHARGE / REFUND（Worker，task 8.1）与本次
 *   RESERVE 共用同一 (bizRefType, bizRefId) 关联键（幂等键），从而不重复冻结/扣费。
 * - 本路由仅负责 RESERVE 冻结；CHARGE（成功扣费）/ REFUND（失败退款）在 Worker
 *   计费点处理，避免在此处双重扣费。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 202: { message: string, storeId: string, contentPlanId: string } 已接受
 * - 401: 未认证
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 403: 无权限（无商家身份或非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 2.3, 3.3
 */

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { reserveMerchantCredits } from '@/lib/merchant-billing-service'
import { CREDIT_COST_CONTENT_PLAN } from '@/constants/merchant'
import { generateContentPlanQueue } from '@/lib/queue'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 1. 验证商家对该门店的访问权限
    const { merchant } = await validateMerchantAccess(userId, storeId)

    // 2. 预生成内容计划 id：随 job 透传给 Worker，确保 RESERVE 与后续 CHARGE/REFUND
    //    共用同一 (CONTENT_PLAN, contentPlanId) 关联键（幂等键）。
    const contentPlanId = randomUUID()

    // 3. 按固定单价冻结积分（RESERVE）。
    //    余额不足时 reserveMerchantCredits 抛 ApiError('INSUFFICIENT_CREDITS', 402)，
    //    由下方 catch 统一转为 402 响应，余额不变、绝不欠费。
    await reserveMerchantCredits({
      userId,
      bizRefType: 'CONTENT_PLAN',
      bizRefId: contentPlanId,
      amount: CREDIT_COST_CONTENT_PLAN,
      remark: `[MERCHANT_CONTENT_PLAN] 内容计划生成冻结 ${CREDIT_COST_CONTENT_PLAN} 积分`,
    })

    // 4. 入队 BullMQ generate-content-plan 任务（透传预生成的 contentPlanId 供 Worker 复用）
    await generateContentPlanQueue.add('generate-content-plan', {
      storeId,
      merchantId: merchant.id,
      userId,
      contentPlanId,
    })

    return NextResponse.json(
      { message: '已接受，正在生成内容计划', storeId, contentPlanId },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/stores/[storeId]/content-plan/generate] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
