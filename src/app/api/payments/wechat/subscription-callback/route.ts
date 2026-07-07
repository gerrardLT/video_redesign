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
 * POST /api/payments/wechat/subscription-callback
 * 微信签约代扣回调接口
 *
 * 处理场景：
 * - 签约+首期扣款成功（FIRST_SUBSCRIBE 订单）
 * - 自动续费扣款结果（RENEWAL 订单）
 * - 手动续费扣款结果（MANUAL_RENEWAL 订单）
 *
 * 无论成功失败都返回 200 + { code: 'SUCCESS' }（微信要求）
 */
export async function POST(request: NextRequest) {
  try {
    // 读取回调请求体和签名头
    const body = await request.json()
    const headers: Record<string, string> = {
      'wechatpay-signature': request.headers.get('wechatpay-signature') || '',
      'wechatpay-timestamp': request.headers.get('wechatpay-timestamp') || '',
      'wechatpay-nonce': request.headers.get('wechatpay-nonce') || '',
      'wechatpay-serial': request.headers.get('wechatpay-serial') || '',
    }

    logger.info('收到微信签约代扣回调', { headers, body })

    // 验证签名并解析回调数据
    const gateway = getPaymentGateway('wechat')
    const callbackData = await gateway.verifyContractCallback(body, headers)

    logger.info('微信签约代扣回调验签成功', {
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
      channel: 'wechat' as const,
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

    logger.info('微信签约代扣回调处理完成', { orderNo: callbackData.orderNo })

    return NextResponse.json({ code: 'SUCCESS', message: '成功' })
  } catch (error) {
    // 无论发生什么错误都返回 200，避免微信重复推送
    logger.error('微信签约代扣回调处理失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ code: 'SUCCESS', message: '成功' })
  }
}
