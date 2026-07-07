import { NextRequest, NextResponse } from 'next/server'
import { getPaymentGateway } from '@/services/payment'
import * as OrderService from '@/lib/shared/order-service'
import { logger } from '@/lib/shared/logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/alipay/callback
 * 支付宝回调接口
 *
 * - 无需 JWT 认证（已加入 PUBLIC_API_PATHS）
 * - 成功返回纯文本 'success'（支付宝要求）
 * - 失败返回纯文本 'fail'
 */
export async function POST(request: NextRequest) {
  try {
    // 支付宝回调以 form-urlencoded 或 JSON 形式发送
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

    logger.info('收到支付宝回调', { 
      // P2 修复：日志脱敏，不记录完整 body（含签名密钥信息）
      out_trade_no: (body as Record<string, unknown>).out_trade_no,
      trade_status: (body as Record<string, unknown>).trade_status,
      total_amount: (body as Record<string, unknown>).total_amount,
    })

    // 验证签名并解析回调数据
    const gateway = getPaymentGateway('alipay')
    const callbackData = await gateway.verifyCallback(body, headers)

    logger.info('支付宝回调验签成功', {
      orderNo: callbackData.orderNo,
      transactionId: callbackData.transactionId,
      amount: callbackData.amount,
    })

    // 处理业务逻辑：更新订单状态 + 充值积分
    await OrderService.handlePaymentCallback(callbackData)

    logger.info('支付宝回调处理完成', { orderNo: callbackData.orderNo })

    // 支付宝要求返回纯文本 'success'
    return new NextResponse('success', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    // 记录错误日志，返回 'fail' 让支付宝重试
    logger.error('支付宝回调处理失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return new NextResponse('fail', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
