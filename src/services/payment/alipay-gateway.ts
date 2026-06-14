/**
 * 支付宝网关实现（Mock）
 *
 * 当前为 Mock 实现，后续接入支付宝开放平台 SDK（电脑网站支付）。
 * - 创建支付：返回 Mock 跳转支付 URL
 * - 验证回调：Mock RSA2 验签
 * - 退款：Mock 退款请求
 */
import { CreatePaymentParamsSchema } from './types'
import type {
  IPaymentGateway,
  CreatePaymentParams,
  PaymentResult,
  PaymentCallbackData,
  RefundParams,
  RefundResult,
} from './types'

export class AlipayGateway implements IPaymentGateway {
  /**
   * 创建支付宝电脑网站支付订单
   * Mock 返回跳转支付 URL
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    // 参数校验
    CreatePaymentParamsSchema.parse(params)

    // Mock: 生成交易号和支付跳转 URL
    const tradeNo = `ali_trade_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const payUrl = `https://openapi.alipay.com/gateway.do?trade_no=${tradeNo}&mock=true`

    return {
      paymentId: tradeNo,
      payUrl,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟过期
    }
  }

  /**
   * 验证支付宝回调
   * Mock: RSA2 验签逻辑
   *
   * 真实实现需要：
   * 1. 获取所有回调参数（排除 sign 和 sign_type）
   * 2. 按参数名 ASCII 排序拼接
   * 3. 使用支付宝公钥 + RSA2(SHA256WithRSA) 验证签名
   */
  async verifyCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<PaymentCallbackData> {
    const callbackBody = body as Record<string, unknown>

    // Mock 签名验证：检查 sign 字段是否存在
    const sign = callbackBody?.sign as string | undefined
    if (!sign) {
      throw new Error('支付宝回调签名验证失败：缺少 sign 字段')
    }

    // Mock: 验证 trade_status
    const tradeStatus = callbackBody?.trade_status as string
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      throw new Error(`支付宝回调交易状态异常: ${tradeStatus}`)
    }

    // 解析回调字段
    const orderNo = callbackBody?.out_trade_no as string
    const transactionId = (callbackBody?.trade_no as string) || `ali_txn_${Date.now()}`
    // 支付宝回调金额单位为元，需转换为分
    const amountYuan = parseFloat((callbackBody?.total_amount as string) || '0')
    const amount = Math.round(amountYuan * 100)
    const paidAt = callbackBody?.gmt_payment
      ? new Date(callbackBody.gmt_payment as string)
      : new Date()

    if (!orderNo) {
      throw new Error('支付宝回调数据格式错误：缺少商户订单号')
    }

    return {
      orderNo,
      transactionId,
      amount,
      paidAt,
      channel: 'alipay',
      rawData: callbackBody,
    }
  }

  /**
   * 发起支付宝退款
   * Mock 实现
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const refundId = `ali_refund_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    return {
      success: true,
      refundId,
      status: 'SUCCESS', // 支付宝退款同步返回结果
      refundAmount: params.refundAmount,
    }
  }
}
