import { NextRequest, NextResponse } from 'next/server'
import { getPaymentGateway } from '@/services/payment'
import {
  handleSubscriptionPaymentCallback,
  handleRenewalCallback,
} from '@/lib/shared/subscription-service'
import { logger } from '@/lib/shared/logger'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/alipay/subscription-callback
 * 支付宝周期扣款回调接口
 *
 * 处理场景：
 * - 签约+首期扣款成功（FIRST_SUBSCRIBE 订单）
 * - 自动续费扣款结果（RENEWAL 订单）
 * - 手动续费扣款结果（MANUAL_RENEWAL 订单）
 *
 * 成功返回纯文本 'success'（支付宝要求）
 * 失败返回纯文本 'fail'（触发支付宝重试）
 */
export async function POST(request: NextRequest) {
  try {
    // 支付宝回调可能以 form-urlencoded 或 JSON 形式发送
    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, unknown>

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData()
      body = Object.fromEntries(formData.entries())
    } else {
      body = await request.json()
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    logger.info('收到支付宝周期扣款回调', { body })

    // 验证签名并解析回调数据
    const gateway = getPaymentGateway('alipay')
    const callbackData = await gateway.verifyContractCallback(body, headers)

    logger.info('支付宝周期扣款回调验签成功', {
      orderNo: callbackData.orderNo,
      transactionId: callbackData.transactionId,
      status: callbackData.status,
    })

    // 将平台回调数据转换为业务层格式
    const serviceCallbackData = {
      orderNo: callbackData.orderNo,
      transactionId: callbackData.transactionId,
      amount: callbackData.amount,
      paidAt: callbackData.paidAt,
      channel: 'alipay' as const,
      contractId: callbackData.contractId,
      success: callbackData.status === 'success',
      failReason: callbackData.failReason,
    }

    // 根据订单类型分发处理
    const order = await prisma.subscriptionOrder.findUnique({
      where: { id: callbackData.orderNo },
    })

    if (order) {
      if (order.type === 'FIRST_SUBSCRIBE') {
        await handleSubscriptionPaymentCallback(serviceCallbackData)
      } else {
        // RENEWAL 或 MANUAL_RENEWAL
        await handleRenewalCallback(serviceCallbackData)
      }
    }

    logger.info('支付宝周期扣款回调处理完成', { orderNo: callbackData.orderNo })

    // 支付宝要求返回纯文本 'success'
    return new NextResponse('success', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    // 记录错误日志，返回 'fail' 让支付宝重试
    logger.error('支付宝周期扣款回调处理失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return new NextResponse('fail', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
