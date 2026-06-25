/**
 * 支付宝网关实现
 *
 * 基础支付：支付宝开放平台 SDK（电脑网站支付）
 * 签约代扣：支付宝周期扣款签约接口
 *
 * API 文档参考：
 * - 电脑网站支付：https://opendocs.alipay.com/open/270/105899
 * - 周期扣款签约：https://opendocs.alipay.com/open/20190319/aligr1e
 * - 周期扣款：https://opendocs.alipay.com/open/085qdg
 */
import crypto from 'crypto'
import { CreatePaymentParamsSchema } from './types'
import type {
  IPaymentGateway,
  CreatePaymentParams,
  PaymentResult,
  PaymentCallbackData,
  RefundParams,
  RefundResult,
  CreateContractPaymentParams,
  ContractDeductionParams,
  SubscriptionCallbackData,
} from './types'

/** 支付宝网关地址 */
const ALIPAY_GATEWAY_URL = 'https://openapi.alipay.com/gateway.do'

export class AlipayGateway implements IPaymentGateway {
  private appId: string
  private privateKey: string
  private alipayPublicKey: string

  constructor() {
    // P0 修复：环境变量缺失时直接抛错，不使用空字符串静默降级
    this.appId = process.env.ALIPAY_APP_ID || ''
    this.privateKey = process.env.ALIPAY_PRIVATE_KEY || ''
    this.alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY || ''

    const missing: string[] = []
    if (!this.appId) missing.push('ALIPAY_APP_ID')
    if (!this.privateKey) missing.push('ALIPAY_PRIVATE_KEY')
    if (!this.alipayPublicKey) missing.push('ALIPAY_PUBLIC_KEY')

    if (missing.length > 0) {
      throw new Error(
        `支付宝网关初始化失败：缺少环境变量 ${missing.join(', ')}。` +
        `请在 .env.production 中配置所有支付宝密钥。`
      )
    }
  }

  /**
   * 生成支付宝 RSA2 签名
   * 对请求参数按 ASCII 排序后使用 SHA256WithRSA 签名
   */
  private generateSignature(params: Record<string, string>): string {
    // 按参数名 ASCII 排序，排除 sign 和 sign_type
    const sortedKeys = Object.keys(params)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== '')
      .sort()

    const signContent = sortedKeys.map((key) => `${key}=${params[key]}`).join('&')
    const sign = crypto.createSign('RSA-SHA256')
    sign.update(signContent, 'utf8')
    return sign.sign(this.privateKey, 'base64')
  }

  /**
   * 验证支付宝回调 RSA2 签名
   */
  private verifyAlipaySignature(params: Record<string, string>): boolean {
    const sign = params.sign
    if (!sign) return false

    const sortedKeys = Object.keys(params)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== '')
      .sort()

    const signContent = sortedKeys.map((key) => `${key}=${params[key]}`).join('&')
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signContent, 'utf8')
    return verify.verify(this.alipayPublicKey, sign, 'base64')
  }

  /**
   * 构造支付宝通用请求参数
   */
  private buildCommonParams(method: string): Record<string, string> {
    return {
      app_id: this.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      version: '1.0',
    }
  }

  /**
   * 调用支付宝 API
   */
  private async callAlipayApi(
    method: string,
    bizContent: Record<string, unknown>,
    notifyUrl?: string
  ): Promise<Record<string, unknown>> {
    const commonParams = this.buildCommonParams(method)
    if (notifyUrl) {
      commonParams.notify_url = notifyUrl
    }
    commonParams.biz_content = JSON.stringify(bizContent)

    // 生成签名
    commonParams.sign = this.generateSignature(commonParams)

    // 构造请求
    const formData = new URLSearchParams()
    for (const [key, value] of Object.entries(commonParams)) {
      formData.append(key, value)
    }

    const response = await fetch(ALIPAY_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    })

    if (!response.ok) {
      throw new Error(`支付宝 API 调用失败: ${response.statusText}`)
    }

    const data = await response.json() as Record<string, unknown>
    // 支付宝响应格式: { method_response: { code, msg, ... } }
    const responseKey = method.replace(/\./g, '_') + '_response'
    const apiResponse = data[responseKey] as Record<string, unknown>

    if (!apiResponse || apiResponse.code !== '10000') {
      const subMsg = (apiResponse?.sub_msg as string) || (apiResponse?.msg as string) || '未知错误'
      throw new Error(`支付宝 ${method} 失败: ${subMsg}`)
    }

    return apiResponse
  }

  /**
   * 创建支付宝电脑网站支付订单
   * 调用 alipay.trade.page.pay 接口
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    CreatePaymentParamsSchema.parse(params)

    const commonParams = this.buildCommonParams('alipay.trade.page.pay')
    commonParams.notify_url = params.notifyUrl
    commonParams.return_url = process.env.ALIPAY_RETURN_URL || ''
    commonParams.biz_content = JSON.stringify({
      out_trade_no: params.orderNo,
      total_amount: (params.amount / 100).toFixed(2), // 分转元
      subject: params.description,
      product_code: 'FAST_INSTANT_TRADE_PAY',
    })

    commonParams.sign = this.generateSignature(commonParams)

    // 构造跳转支付 URL
    const queryStr = Object.entries(commonParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    const payUrl = `${ALIPAY_GATEWAY_URL}?${queryStr}`

    return {
      paymentId: params.orderNo,
      payUrl,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }
  }

  /**
   * 验证支付宝回调
   * 1. 验证 RSA2 签名
   * 2. 验证 trade_status
   * 3. 解析支付结果
   */
  async verifyCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<PaymentCallbackData> {
    const callbackBody = body as Record<string, string>

    if (!this.verifyAlipaySignature(callbackBody)) {
      throw new Error('支付宝回调签名验证失败')
    }

    const tradeStatus = callbackBody.trade_status
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      throw new Error(`支付宝回调交易状态异常: ${tradeStatus}`)
    }

    const orderNo = callbackBody.out_trade_no
    const transactionId = callbackBody.trade_no || ''
    // 支付宝金额单位为元，转换为分
    const amountYuan = parseFloat(callbackBody.total_amount || '0')
    const amount = Math.round(amountYuan * 100)
    const paidAt = callbackBody.gmt_payment
      ? new Date(callbackBody.gmt_payment)
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
      rawData: callbackBody as unknown as Record<string, unknown>,
    }
  }

  /**
   * 发起支付宝退款
   * 调用 alipay.trade.refund 接口
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const apiResponse = await this.callAlipayApi('alipay.trade.refund', {
      out_trade_no: params.orderNo,
      out_request_no: params.refundNo,
      refund_amount: (params.refundAmount / 100).toFixed(2),
      refund_reason: params.reason || '用户申请退款',
    })

    return {
      success: true,
      refundId: (apiResponse.trade_no as string) || params.refundNo,
      status: 'SUCCESS', // 支付宝退款同步返回结果
      refundAmount: params.refundAmount,
    }
  }

  /**
   * 创建签约+首期扣款
   * 调用支付宝周期扣款签约 alipay.user.agreement.page.sign（结合首期支付）
   *
   * 流程：
   * 1. 通过 alipay.user.agreement.page.sign 发起签约+支付
   * 2. 用户在支付宝侧完成签约并支付首期费用
   * 3. 支付宝异步通知签约结果和支付结果
   *
   * 文档: https://opendocs.alipay.com/open/20190319/aligr1e
   */
  async createContractPayment(
    params: CreateContractPaymentParams
  ): Promise<PaymentResult & { contractId?: string }> {
    const periodRule = params.contractConfig.periodType === 'MONTH'
      ? { period_type: 'MONTH', period: params.contractConfig.periodCount }
      : { period_type: 'YEAR', period: params.contractConfig.periodCount }

    const commonParams = this.buildCommonParams('alipay.user.agreement.page.sign')
    commonParams.notify_url = params.notifyUrl
    commonParams.return_url = process.env.ALIPAY_RETURN_URL || ''
    commonParams.biz_content = JSON.stringify({
      // 签约参数
      personal_product_code: 'CYCLE_PAY_AUTH_P',
      sign_scene: 'INDUSTRY|DIGITAL_MEDIA',
      external_agreement_no: `agreement_${params.orderNo}`,
      // 周期规则
      period_rule_params: {
        period_type: periodRule.period_type,
        period: periodRule.period,
        execute_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        single_amount: (params.contractConfig.singleLimit / 100).toFixed(2),
        total_amount: (params.contractConfig.singleLimit * 120 / 100).toFixed(2), // 总限额 = 单笔 × 120次
        total_payments: 120,
      },
      // 签约协议到期时间
      sign_validity_period: formatAlipayDate(params.contractConfig.contractExpireTime),
      // 首期支付参数（签约+支付合并）
      access_params: {
        channel: 'ALIPAYAPP',
      },
      // 首期支付信息
      trade_no: params.orderNo,
      product_code: 'CYCLE_PAY_AUTH',
    })

    commonParams.sign = this.generateSignature(commonParams)

    // 构造签约支付跳转 URL
    const queryStr = Object.entries(commonParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    const payUrl = `${ALIPAY_GATEWAY_URL}?${queryStr}`

    return {
      paymentId: params.orderNo,
      payUrl,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      contractId: undefined, // 签约协议号通过异步回调返回
    }
  }

  /**
   * 通过签约协议发起代扣
   * 调用 alipay.trade.pay 接口（周期扣款场景）
   *
   * 文档: https://opendocs.alipay.com/open/085qdg
   */
  async executeContractDeduction(
    params: ContractDeductionParams
  ): Promise<PaymentResult> {
    const apiResponse = await this.callAlipayApi(
      'alipay.trade.pay',
      {
        out_trade_no: params.orderNo,
        total_amount: (params.amount / 100).toFixed(2),
        subject: params.description,
        product_code: 'CYCLE_PAY_AUTH',
        agreement_params: {
          agreement_no: params.contractId,
        },
      },
      process.env.ALIPAY_SUBSCRIPTION_NOTIFY_URL || ''
    )

    const tradeNo = (apiResponse.trade_no as string) || params.orderNo

    return {
      paymentId: tradeNo,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 代扣结果异步回调
    }
  }

  /**
   * 解除签约协议
   * 调用 alipay.user.agreement.unsign 接口
   *
   * 文档: https://opendocs.alipay.com/open/067fma
   */
  async cancelContract(contractId: string): Promise<{ success: boolean }> {
    await this.callAlipayApi('alipay.user.agreement.unsign', {
      agreement_no: contractId,
      personal_product_code: 'CYCLE_PAY_AUTH_P',
    })

    return { success: true }
  }

  /**
   * 验证签约代扣回调
   * 处理签约成功、扣款结果、签约解除三种回调场景
   *
   * 回调通过 notify_type 区分：
   * - dut_user_sign: 用户签约成功
   * - trade_status_sync: 扣款结果通知
   * - dut_user_unsign: 用户解约通知
   */
  async verifyContractCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<SubscriptionCallbackData> {
    const callbackBody = body as Record<string, string>

    if (!this.verifyAlipaySignature(callbackBody)) {
      throw new Error('支付宝签约代扣回调签名验证失败')
    }

    const notifyType = callbackBody.notify_type

    // 签约解除回调
    if (notifyType === 'dut_user_unsign') {
      return {
        orderNo: callbackBody.external_agreement_no || '',
        transactionId: '',
        status: 'success',
        contractId: callbackBody.agreement_no,
        amount: 0,
        paidAt: new Date(),
      }
    }

    // 签约成功回调
    if (notifyType === 'dut_user_sign') {
      return {
        orderNo: callbackBody.external_agreement_no || '',
        transactionId: '',
        status: 'success',
        contractId: callbackBody.agreement_no,
        amount: 0,
        paidAt: callbackBody.sign_time ? new Date(callbackBody.sign_time) : new Date(),
      }
    }

    // 扣款结果回调（trade_status_sync）
    const tradeStatus = callbackBody.trade_status
    const isSuccess = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
    const amountYuan = parseFloat(callbackBody.total_amount || '0')

    return {
      orderNo: callbackBody.out_trade_no || '',
      transactionId: callbackBody.trade_no || '',
      status: isSuccess ? 'success' : 'failure',
      contractId: callbackBody.agreement_no,
      failReason: isSuccess ? undefined : `交易状态: ${tradeStatus}`,
      amount: Math.round(amountYuan * 100),
      paidAt: callbackBody.gmt_payment
        ? new Date(callbackBody.gmt_payment)
        : new Date(),
    }
  }
}

/**
 * 格式化日期为支付宝要求的格式 (yyyy-MM-dd HH:mm:ss)
 */
function formatAlipayDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}
