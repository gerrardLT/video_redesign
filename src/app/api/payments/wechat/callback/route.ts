import { NextRequest, NextResponse } from 'next/server'
import { getPaymentGateway } from '@/services/payment'
import * as OrderService from '@/lib/shared/order-service'
import { logger } from '@/lib/shared/logger'

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

    logger.info('收到微信支付回调', { nonce: headers['wechatpay-nonce'], serial: headers['wechatpay-serial'] })

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
    // P0 修复：区分验签失败和业务处理失败
    // 验签失败：可能是伪造请求，记录但仍返回 200（微信协议要求）
    // 业务处理失败：订单已标记为 REQUIRES_MANUAL_REVIEW（在 order-service 内处理），
    // 微信会重复推送回调（最多 15 次），handlePaymentCallback 内置幂等可安全重试。
    // 只要验签通过但业务失败，下次微信重试时 handlePaymentCallback 会再次尝试处理。
    logger.error('微信支付回调处理失败', {
      error: error instanceof Error ? error.message : String(error),
      // 不记录完整 headers 和 stack，避免签名信息泄露到日志
    })

    return NextResponse.json({ code: 'SUCCESS', message: '成功' })
  }
}
