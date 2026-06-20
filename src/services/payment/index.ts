/**
 * Payment Gateway 模块入口
 *
 * 导出支付网关工厂函数和所有类型定义。
 * 使用工厂模式根据支付渠道返回对应的网关实例。
 */
import type { IPaymentGateway, PaymentChannel } from './types'
import { WechatPayGateway } from './wechat-gateway'
import { AlipayGateway } from './alipay-gateway'

// 网关实例缓存（单例）
let wechatGateway: WechatPayGateway | null = null
let alipayGateway: AlipayGateway | null = null

/**
 * 支付网关工厂函数
 * 根据支付渠道返回对应的网关实例（单例模式）
 */
export function getPaymentGateway(channel: PaymentChannel): IPaymentGateway {
  switch (channel) {
    case 'wechat':
      if (!wechatGateway) {
        wechatGateway = new WechatPayGateway()
      }
      return wechatGateway
    case 'alipay':
      if (!alipayGateway) {
        alipayGateway = new AlipayGateway()
      }
      return alipayGateway
    default:
      throw new Error(`不支持的支付渠道: ${channel}`)
  }
}

// 导出所有类型
export type {
  IPaymentGateway,
  PaymentChannel,
  CreatePaymentParams,
  PaymentResult,
  PaymentCallbackData,
  RefundParams,
  RefundResult,
  CreateContractPaymentParams,
  ContractDeductionParams,
  SubscriptionCallbackData,
} from './types'

// 导出 Zod schema（供 API 路由做参数校验）
export {
  PaymentChannel as PaymentChannelSchema,
  CreatePaymentParamsSchema,
  RefundParamsSchema,
} from './types'

// 导出具体网关类（供单元测试使用）
export { WechatPayGateway } from './wechat-gateway'
export { AlipayGateway } from './alipay-gateway'
