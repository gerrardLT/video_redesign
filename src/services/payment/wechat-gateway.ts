/**
 * 微信支付网关实现（Mock）
 *
 * 当前为 Mock 实现，后续接入微信支付 V3 API（Native 支付）。
 * - 创建支付：返回 Mock 二维码 URL
 * - 验证回调：Mock AEAD_AES_256_GCM 解密验签
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

export class WechatPayGateway implements IPaymentGateway {
  /**
   * 创建微信 Native 支付订单
   * Mock 返回二维码 URL
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    // 参数校验
    CreatePaymentParamsSchema.parse(params)

    // Mock: 生成预付单ID和二维码 URL
    const prepayId = `wx_prepay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const qrCode = `weixin://wxpay/bizpayurl?pr=${prepayId}`

    return {
      paymentId: prepayId,
      qrCode,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟过期
    }
  }

  /**
   * 验证微信支付回调
   * Mock: AEAD_AES_256_GCM 解密验签逻辑
   *
   * 真实实现需要：
   * 1. 从 headers 获取 Wechatpay-Timestamp、Wechatpay-Nonce、Wechatpay-Signature
   * 2. 使用微信平台公钥验证签名
   * 3. 使用 APIv3 密钥解密 resource 数据
   */
  async verifyCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<PaymentCallbackData> {
    // Mock 签名验证：检查 headers 是否包含必要字段
    const signature = headers['wechatpay-signature']
    const timestamp = headers['wechatpay-timestamp']
    const nonce = headers['wechatpay-nonce']

    if (!signature || !timestamp || !nonce) {
      throw new Error('微信支付回调签名验证失败：缺少必要的签名头信息')
    }

    // Mock: 解析回调数据
    const callbackBody = body as Record<string, unknown>
    const resource = callbackBody?.resource as Record<string, unknown> | undefined

    if (!resource) {
      throw new Error('微信支付回调数据格式错误：缺少 resource 字段')
    }

    // Mock: 模拟解密后的数据
    // 真实场景下需使用 AEAD_AES_256_GCM 解密 resource.ciphertext
    const orderNo = (resource.out_trade_no as string) || ''
    const transactionId = (resource.transaction_id as string) || `wx_txn_${Date.now()}`
    const amount = (resource.amount as number) || 0
    const paidAt = resource.success_time
      ? new Date(resource.success_time as string)
      : new Date()

    if (!orderNo) {
      throw new Error('微信支付回调数据格式错误：缺少商户订单号')
    }

    return {
      orderNo,
      transactionId,
      amount,
      paidAt,
      channel: 'wechat',
      rawData: callbackBody,
    }
  }

  /**
   * 发起微信退款
   * Mock 实现
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const refundId = `wx_refund_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    return {
      success: true,
      refundId,
      status: 'PROCESSING',
      refundAmount: params.refundAmount,
    }
  }
}
