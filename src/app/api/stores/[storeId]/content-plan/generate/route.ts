/**
 * POST /api/stores/[storeId]/content-plan/generate — 触发生成 7 天内容计划
 *
 * 验证商家权限 + 额度检查（CREATE_CONTENT_PLAN），通过后入队 BullMQ
 * `generate-content-plan` 任务由 Worker 异步处理，返回 202 Accepted。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 202: { message: string, storeId: string } 已接受
 * - 401: 未认证
 * - 403: 无权限（无商家身份或非本门店）
 * - 409: 额度不足
 * - 500: 服务器内部错误
 *
 * Requirements: 4.1, 5.1, 5.6, 14.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { checkMerchantQuota } from '@/lib/merchant-quota-service'
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

    // 2. 额度检查：CREATE_CONTENT_PLAN
    const quotaResult = await checkMerchantQuota(userId, 'CREATE_CONTENT_PLAN')
    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'QUOTA_EXCEEDED',
            message: '内容计划额度已用完',
            current: quotaResult.current,
            limit: quotaResult.limit,
            resetDate: quotaResult.resetDate ?? null,
          },
        },
        { status: 409 }
      )
    }

    // 3. 入队 BullMQ generate-content-plan 任务
    await generateContentPlanQueue.add('generate-content-plan', {
      storeId,
      merchantId: merchant.id,
      userId,
    })

    return NextResponse.json(
      { message: '已接受，正在生成内容计划', storeId },
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
