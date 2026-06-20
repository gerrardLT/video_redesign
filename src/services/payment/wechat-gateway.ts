/**
 * 微信支付网关实现
 *
 * 基础支付：微信支付 V3 API（Native 支付）
 * 签约代扣：微信支付委托代扣 API（周期性扣款）
 *
 * API 文档参考：
 * - Native 支付：https://pay.weixin.qq.com/docs/merchant/apis/native-payment/direct/native-prepay.html
 * - 委托代扣：https://pay.weixin.qq.com/docs/merchant/apis/entrusted-payment/direct/direct-entrust-sign.html
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

/** 微信支付 V3 API 基础地址 */
const WECHAT_PAY_BASE_URL = 'https://api.mch.weixin.qq.com'

export class WechatPayGateway implements IPaymentGateway {
  private mchId: string
  private appId: string
  private apiV3Key: string
  private serialNo: string
  private privateKey: string

  constructor() {
    this.mchId = process.env.WECHAT_PAY_MCH_ID || ''
    this.appId = process.env.WECHAT_PAY_APP_ID || ''
    this.apiV3Key = process.env.WECHAT_PAY_API_V3_KEY || ''
    this.serialNo = process.env.WECHAT_PAY_SERIAL_NO || ''
    this.privateKey = process.env.WECHAT_PAY_PRIVATE_KEY || ''
  }

  /**
   * 生成微信支付 V3 API 签名
   * 使用 SHA256withRSA 算法对请求内容签名
   */
  private generateSignature(
    method: string,
    url: string,
    timestamp: string,
    nonceStr: string,
    body: string
  ): string {
    const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`
    const sign = crypto.createSign('RSA-SHA256')
    sign.update(message)
    return sign.sign(this.privateKey, 'base64')
  }

  /**
   * 构造微信支付 V3 API 请求的 Authorization 头
   */
  private buildAuthHeader(
    method: string,
    url: string,
    body: string
  ): string {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = crypto.randomBytes(16).toString('hex')
    const signature = this.generateSignature(method, url, timestamp, nonceStr, body)

    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`
  }

  /**
   * 解密微信支付 V3 回调中的加密数据
   * 使用 AEAD_AES_256_GCM 算法解密
   */
  private decryptResource(resource: {
    algorithm: string
    ciphertext: string
    associated_data: string
    nonce: string
  }): Record<string, unknown> {
    const { ciphertext, associated_data, nonce } = resource
    const ciphertextBuffer = Buffer.from(ciphertext, 'base64')
    const authTag = ciphertextBuffer.subarray(ciphertextBuffer.length - 16)
    const data = ciphertextBuffer.subarray(0, ciphertextBuffer.length - 16)

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.apiV3Key),
      Buffer.from(nonce)
    )
    decipher.setAuthTag(authTag)
    decipher.setAAD(Buffer.from(associated_data))

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(decrypted.toString('utf8'))
  }

  /**
   * 验证微信支付 V3 回调签名
   */
  private verifyCallbackSignature(
    body: string,
    headers: Record<string, string>
  ): boolean {
    const signature = headers['wechatpay-signature']
    const timestamp = headers['wechatpay-timestamp']
    const nonce = headers['wechatpay-nonce']
    const platformCert = process.env.WECHAT_PAY_PLATFORM_CERT || ''

    if (!signature || !timestamp || !nonce) {
      return false
    }

    const message = `${timestamp}\n${nonce}\n${body}\n`
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(message)
    return verify.verify(platformCert, signature, 'base64')
  }

  /**
   * 创建微信 Native 支付订单
   * 调用微信支付 V3 Native 下单接口
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    CreatePaymentParamsSchema.parse(params)

    const url = '/v3/pay/transactions/native'
    const requestBody = {
      appid: this.appId,
      mchid: this.mchId,
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: params.notifyUrl,
      amount: {
        total: params.amount,
        currency: 'CNY',
      },
    }

    const bodyStr = JSON.stringify(requestBody)
    const authorization = this.buildAuthHeader('POST', url, bodyStr)

    const response = await fetch(`${WECHAT_PAY_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`微信支付下单失败: ${errorData.message || response.statusText}`)
    }

    const data = await response.json() as { code_url: string; prepay_id?: string }

    return {
      paymentId: params.orderNo,
      qrCode: data.code_url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }
  }

  /**
   * 验证微信支付回调
   * 1. 验证签名（SHA256-RSA2048）
   * 2. 解密 resource 数据（AEAD_AES_256_GCM）
   * 3. 解析支付结果
   */
  async verifyCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<PaymentCallbackData> {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)

    if (!this.verifyCallbackSignature(bodyStr, headers)) {
      throw new Error('微信支付回调签名验证失败')
    }

    const callbackBody = typeof body === 'string' ? JSON.parse(body) : body as Record<string, unknown>
    const resource = callbackBody.resource as {
      algorithm: string
      ciphertext: string
      associated_data: string
      nonce: string
    }

    if (!resource) {
      throw new Error('微信支付回调数据格式错误：缺少 resource 字段')
    }

    const decrypted = this.decryptResource(resource) as {
      out_trade_no: string
      transaction_id: string
      amount: { total: number }
      success_time: string
    }

    return {
      orderNo: decrypted.out_trade_no,
      transactionId: decrypted.transaction_id,
      amount: decrypted.amount.total,
      paidAt: new Date(decrypted.success_time),
      channel: 'wechat',
      rawData: callbackBody as Record<string, unknown>,
    }
  }

  /**
   * 发起微信退款
   * 调用微信支付 V3 退款接口
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const url = '/v3/refund/domestic/refunds'
    const requestBody = {
      out_trade_no: params.orderNo,
      out_refund_no: params.refundNo,
      reason: params.reason || '用户申请退款',
      amount: {
        refund: params.refundAmount,
        total: params.totalAmount,
        currency: 'CNY',
      },
    }

    const bodyStr = JSON.stringify(requestBody)
    const authorization = this.buildAuthHeader('POST', url, bodyStr)

    const response = await fetch(`${WECHAT_PAY_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`微信退款失败: ${errorData.message || response.statusText}`)
    }

    const data = await response.json() as {
      refund_id: string
      status: string
      amount: { refund: number }
    }

    return {
      success: true,
      refundId: data.refund_id,
      status: data.status === 'SUCCESS' ? 'SUCCESS' : 'PROCESSING',
      refundAmount: data.amount.refund,
    }
  }

  /**
   * 创建签约+首期扣款
   * 调用微信支付委托代扣签约+支付接口
   *
   * API: POST /v3/pay/partner/transactions/native (含签约参数)
   * 文档: https://pay.weixin.qq.com/docs/merchant/apis/entrusted-payment/direct/direct-entrust-sign.html
   */
  async createContractPayment(
    params: CreateContractPaymentParams
  ): Promise<PaymentResult & { contractId?: string }> {
    const url = '/v3/pay/transactions/native'
    const contractDisplayAccount = `${this.appId}_subscription`

    const requestBody = {
      appid: this.appId,
      mchid: this.mchId,
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: params.notifyUrl,
      amount: {
        total: params.amount,
        currency: 'CNY',
      },
      // 签约参数 - 微信委托代扣签约场景
      contract_sign_info: {
        contract_display_account: contractDisplayAccount,
        // 签约模板编号（需在微信支付商户平台配置）
        plan_id: process.env.WECHAT_PAY_CONTRACT_PLAN_ID || '',
        // 签约协议号（商户侧唯一）
        contract_code: `contract_${params.orderNo}`,
        // 请求签约序列号
        request_serial: Date.now(),
        // 签约版本
        contract_signed_notify_url: params.notifyUrl,
        // 周期扣费规则
        deduct_duration: {
          deduct_frequency: params.contractConfig.periodType === 'MONTH'
            ? { frequency_type: 'MONTH', frequency_count: params.contractConfig.periodCount }
            : { frequency_type: 'YEAR', frequency_count: params.contractConfig.periodCount },
          deduct_amount: {
            total: params.contractConfig.singleLimit,
            currency: 'CNY',
          },
        },
        // 签约到期时间
        contract_expired_time: params.contractConfig.contractExpireTime.toISOString(),
      },
    }

    const bodyStr = JSON.stringify(requestBody)
    const authorization = this.buildAuthHeader('POST', url, bodyStr)

    const response = await fetch(`${WECHAT_PAY_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`微信签约代扣创建失败: ${errorData.message || response.statusText}`)
    }

    const data = await response.json() as {
      code_url: string
      contract_id?: string
    }

    return {
      paymentId: params.orderNo,
      qrCode: data.code_url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      contractId: data.contract_id,
    }
  }

  /**
   * 通过签约协议发起代扣
   * 调用微信支付委托代扣扣款接口
   *
   * API: POST /v3/pay/partner/transactions/papay/apply
   * 文档: https://pay.weixin.qq.com/docs/merchant/apis/entrusted-payment/direct/direct-entrust-deduct.html
   */
  async executeContractDeduction(
    params: ContractDeductionParams
  ): Promise<PaymentResult> {
    const url = '/v3/papay/pay/transactions/apply'
    const requestBody = {
      appid: this.appId,
      mchid: this.mchId,
      out_trade_no: params.orderNo,
      description: params.description,
      contract_id: params.contractId,
      notify_url: process.env.WECHAT_PAY_SUBSCRIPTION_NOTIFY_URL || '',
      amount: {
        total: params.amount,
        currency: 'CNY',
      },
      // 代扣场景信息
      scene_info: {
        payer_client_ip: '127.0.0.1',
      },
    }

    const bodyStr = JSON.stringify(requestBody)
    const authorization = this.buildAuthHeader('POST', url, bodyStr)

    const response = await fetch(`${WECHAT_PAY_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`微信代扣扣款失败: ${errorData.message || response.statusText}`)
    }

    const data = await response.json() as {
      out_trade_no: string
      transaction_id?: string
    }

    return {
      paymentId: data.out_trade_no,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 代扣结果异步回调
    }
  }

  /**
   * 解除签约协议
   * 调用微信支付委托代扣解约接口
   *
   * API: POST /v3/papay/sign/contracts/{contract_id}/terminate
   * 文档: https://pay.weixin.qq.com/docs/merchant/apis/entrusted-payment/direct/direct-entrust-terminate-contract.html
   */
  async cancelContract(contractId: string): Promise<{ success: boolean }> {
    const url = `/v3/papay/sign/contracts/${contractId}/terminate`
    const requestBody = {
      contract_termination_remark: '用户主动取消订阅',
    }

    const bodyStr = JSON.stringify(requestBody)
    const authorization = this.buildAuthHeader('POST', url, bodyStr)

    const response = await fetch(`${WECHAT_PAY_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`微信签约协议解除失败: ${errorData.message || response.statusText}`)
    }

    return { success: true }
  }

  /**
   * 验证签约代扣回调
   * 处理签约成功、扣款结果、签约解除三种回调场景
   *
   * 回调类型通过 event_type 区分：
   * - ENTRUST.SIGN: 签约成功
   * - TRANSACTION.SUCCESS: 代扣成功
   * - ENTRUST.TERMINATE: 签约解除
   */
  async verifyContractCallback(
    body: unknown,
    headers: Record<string, string>
  ): Promise<SubscriptionCallbackData> {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)

    if (!this.verifyCallbackSignature(bodyStr, headers)) {
      throw new Error('微信签约代扣回调签名验证失败')
    }

    const callbackBody = typeof body === 'string' ? JSON.parse(body) : body as Record<string, unknown>
    const resource = callbackBody.resource as {
      algorithm: string
      ciphertext: string
      associated_data: string
      nonce: string
    }

    if (!resource) {
      throw new Error('微信签约代扣回调数据格式错误：缺少 resource 字段')
    }

    const decrypted = this.decryptResource(resource) as {
      out_trade_no?: string
      transaction_id?: string
      contract_id?: string
      trade_state?: string
      amount?: { total: number }
      success_time?: string
      contract_termination_mode?: string
    }

    const eventType = callbackBody.event_type as string

    // 签约解除回调
    if (eventType === 'ENTRUST.TERMINATE') {
      return {
        orderNo: decrypted.out_trade_no || '',
        transactionId: '',
        status: 'success',
        contractId: decrypted.contract_id,
        amount: 0,
        paidAt: new Date(),
      }
    }

    // 判断扣款是否成功
    const isSuccess = decrypted.trade_state === 'SUCCESS'

    return {
      orderNo: decrypted.out_trade_no || '',
      transactionId: decrypted.transaction_id || '',
      status: isSuccess ? 'success' : 'failure',
      contractId: decrypted.contract_id,
      failReason: isSuccess ? undefined : `交易状态: ${decrypted.trade_state}`,
      amount: decrypted.amount?.total || 0,
      paidAt: decrypted.success_time ? new Date(decrypted.success_time) : new Date(),
    }
  }
}
