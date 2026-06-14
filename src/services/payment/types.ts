/**
 * 支付网关类型定义
 * Payment Gateway 抽象层的核心接口与数据类型
 */
import { z } from 'zod/v4'

// ========================
// 支付渠道枚举
// ========================

export const PaymentChannel = z.enum(['wechat', 'alipay'])
export type PaymentChannel = z.infer<typeof PaymentChannel>

// ========================
// 创建支付参数
// ========================

export const CreatePaymentParamsSchema = z.object({
  orderNo: z.string().min(1, '订单号不能为空'),
  amount: z.number().int().positive('金额必须为正整数（单位：分）'),
  description: z.string().min(1, '商品描述不能为空'),
  channel: PaymentChannel,
  notifyUrl: z.url('回调地址格式不正确'),
  clientIp: z.string().optional(),
})

export type CreatePaymentParams = z.infer<typeof CreatePaymentParamsSchema>

// ========================
// 支付结果
// ========================

export interface PaymentResult {
  /** 支付平台交易预付单ID */
  paymentId: string
  /** 支付宝跳转 URL */
  payUrl?: string
  /** 微信支付二维码链接 */
  qrCode?: string
  /** 支付过期时间 */
  expiresAt: Date
}

// ========================
// 支付回调数据
// ========================

export interface PaymentCallbackData {
  /** 商户订单号 */
  orderNo: string
  /** 支付平台交易号 */
  transactionId: string
  /** 实际支付金额（分） */
  amount: number
  /** 支付完成时间 */
  paidAt: Date
  /** 支付渠道 */
  channel: PaymentChannel
  /** 原始回调数据（用于存档） */
  rawData: Record<string, unknown>
}

// ========================
// 退款参数
// ========================

export const RefundParamsSchema = z.object({
  orderNo: z.string().min(1, '订单号不能为空'),
  refundNo: z.string().min(1, '退款单号不能为空'),
  totalAmount: z.number().int().positive('订单总金额必须为正整数'),
  refundAmount: z.number().int().positive('退款金额必须为正整数'),
  reason: z.string().optional(),
})

export type RefundParams = z.infer<typeof RefundParamsSchema>

// ========================
// 退款结果
// ========================

export interface RefundResult {
  /** 退款是否发起成功 */
  success: boolean
  /** 支付平台退款单号 */
  refundId: string
  /** 退款状态 */
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
  /** 退款金额（分） */
  refundAmount: number
}

// ========================
// 支付网关接口
// ========================

export interface IPaymentGateway {
  /** 创建支付订单，返回支付链接/二维码 */
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>

  /** 验证并解析支付回调数据 */
  verifyCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<PaymentCallbackData>

  /** 发起退款 */
  refund(params: RefundParams): Promise<RefundResult>
}
