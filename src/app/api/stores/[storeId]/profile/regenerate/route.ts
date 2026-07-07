/**
 * POST /api/stores/[storeId]/profile/regenerate — 重新生成门店画像
 *
 * 当画像生成失败（状态为 PROFILE_PENDING 或 INCOMPLETE）时，
 * 商家可调用此接口重新触发画像生成，无需重新提交问诊表单。
 * 通过 BullMQ 入队 generate-store-profile 任务，由 Worker 异步处理。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 202: { message: string } 已接受，正在重新生成
 * - 401: 未认证
 * - 403: 无权限
 * - 500: 服务器内部错误
 *
 * Requirements: 1.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { generateStoreProfileQueue } from '@/lib/shared/queue'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    const { merchant } = await validateMerchantAccess(userId, storeId)

    // 将门店状态标记为 PROFILE_PENDING（正在重新生成）
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'PROFILE_PENDING' },
    })

    // 入队 BullMQ generate-store-profile 任务（Req 1.7 重试机制由队列配置兜底）
    await generateStoreProfileQueue.add('generate-store-profile', {
      storeId,
      merchantId: merchant.id,
    })

    return NextResponse.json(
      { message: '已接受，正在重新生成门店画像' },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/stores/[storeId]/profile/regenerate] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
