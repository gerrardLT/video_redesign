import { NextRequest, NextResponse } from 'next/server'
import { getPaymentGateway } from '@/services/payment'
import * as OrderService from '@/lib/order-service'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/wechat/callback
 * 微信支付回调接口
 *
 * - 无需 JWT 认证（已加入 PUBLIC_API_PATHS）
 * - 无论成功失败都返回 200（微信要求，否则会重试推送）
 * - 成功返回 { code: 'SUCCESS', message: '成功' }
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

    logger.info('收到微信支付回调', { headers, body })

    // 验证签名并解析回调数据
    const gateway = getPaymentGateway('wechat')
    const callbackData = await gateway.verifyCallback(body, headers)

    logger.info('微信支付回调验签成功', {
      orderNo: callbackData.orderNo,
      transactionId: callbackData.transactionId,
      amount: callbackData.amount,
    })

    // 处理业务逻辑：更新订单状态 + 充值积分
    await OrderService.handlePaymentCallback(callbackData)

    logger.info('微信支付回调处理完成', { orderNo: callbackData.orderNo })

    return NextResponse.json({ code: 'SUCCESS', message: '成功' })
  } catch (error) {
    // 无论发生什么错误都返回 200，避免微信重复推送
    logger.error('微信支付回调处理失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ code: 'SUCCESS', message: '成功' })
  }
}
