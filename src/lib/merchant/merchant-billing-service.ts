/**
 * 商家积分计费服务（merchant-billing-service）
 *
 * 本地生活营销平台（/merchant）的可计费操作统一收敛到视频重塑既有的积分体系。
 * 本服务对外暴露以「商家实体关联键（bizRefType + bizRefId）」为中心的计费接口，
 * 内部复用 credit-service 与全局积分写锁 withCreditLock，绝不写入 jobId，
 * 从源头杜绝 credit_ledger_job_id_fkey 外键违约。
 *
 * 本文件实现：
 * - 纯函数 estimateRenderCost（渲染成本估算）；
 * - reserve/charge/refund 三个薄封装，内部分别委托 credit-service 的
 *   reserveCreditsByBizRef / chargeCreditsByBizRef / refundCreditsByBizRef，
 *   关联恒走 (bizRefType, bizRefId)，绝不接受、绝不写入 jobId。
 */

import type { Prisma } from '@/generated/prisma'
import {
  estimateGroupCreditCost,
  reserveCreditsByBizRef,
  chargeCreditsByBizRef,
  refundCreditsByBizRef,
} from '@/lib/shared/credit-service'

/**
 * 商家实体关联类型（写入 CreditLedger.bizRefType）。
 *
 * 'STORE' 仅为类型完整性占位：建店不扣积分（Req 3.4），门店数量改由
 * User_Tier 的 Privilege_Mapping 门店上限门控，该 bizRef 不进入 reserve/charge 路径。
 */
export type MerchantBizRefType = 'CONTENT_BRIEF' | 'CONTENT_PLAN' | 'STORE'

/** 商家计费冻结输入（关联键 = bizRefType + bizRefId） */
export interface MerchantReserveInput {
  userId: string
  bizRefType: MerchantBizRefType
  bizRefId: string
  /** 冻结额度（估算值），必须 > 0 */
  amount: number
  /** 流水备注（用于区分操作，如 '[MERCHANT_RENDER] 渲染冻结 N 积分'） */
  remark: string
}

/** 商家计费扣费输入（关联键 = bizRefType + bizRefId） */
export interface MerchantChargeInput {
  userId: string
  bizRefType: MerchantBizRefType
  bizRefId: string
  /** 实际应扣额度（≤ 已冻结额，多余部分退回） */
  actualAmount: number
}

/** 商家计费退款输入（关联键 = bizRefType + bizRefId） */
export interface MerchantRefundInput {
  userId: string
  bizRefType: MerchantBizRefType
  bizRefId: string
}

/**
 * 估算渲染积分成本：对一组分镜组时长，按既有 estimateGroupCreditCost(duration, resolution)
 * 逐组求和返回。该值用于商家视频渲染入队前的 RESERVE 冻结额。
 *
 * 纯函数，无副作用，复用视频重塑「按组时长 × 分辨率」的计费公式，不重复实现。
 *
 * @param groupDurations 各分镜组时长数组（单位：秒，每项应 > 0）
 * @param resolution 目标分辨率（如 '720p' / '1080p'），透传给 estimateGroupCreditCost
 * @returns 各分镜组积分消耗之和；空数组返回 0
 */
export function estimateRenderCost(groupDurations: number[], resolution: string): number {
  return groupDurations.reduce(
    (sum, duration) => sum + estimateGroupCreditCost(duration, resolution),
    0
  )
}

/**
 * 冻结商家操作积分（RESERVE）——薄封装，委托 credit-service.reserveCreditsByBizRef。
 *
 * - 经 withCreditLock 全局锁串行化 + Prisma 事务（由底层实现保证）。
 * - 幂等键：(bizRefType, bizRefId, action='RESERVE')，已存在则跳过（重试不重复冻结）。
 * - 余额 < amount → 抛 ApiError('INSUFFICIENT_CREDITS', 402)，余额不变、绝不为负、绝不欠费。
 * - 写 CreditLedger 时 jobId 恒为 null，关联恒走 bizRefType / bizRefId。
 *
 * 注意：'STORE' 建店不扣积分（Req 3.4），不应进入本路径；本函数仅用于
 * CONTENT_BRIEF（渲染 / 含超分导出）与 CONTENT_PLAN（内容计划生成）等可计费操作。
 *
 * @param input 冻结输入（关联键 = bizRefType + bizRefId）
 */
export async function reserveMerchantCredits(input: MerchantReserveInput): Promise<void> {
  await reserveCreditsByBizRef({
    userId: input.userId,
    bizRefType: input.bizRefType,
    bizRefId: input.bizRefId,
    amount: input.amount,
    remark: input.remark,
  })
}

/**
 * 正式扣费（CHARGE，基于已有 RESERVE）——薄封装，委托 credit-service.chargeCreditsByBizRef。
 *
 * tx 版本：可在外部事务中调用，与商家实体状态更新（如置 ContentBrief GENERATED）同事务。
 * - 幂等键：(bizRefType, bizRefId, action='CHARGE')，已存在则跳过（重试不重复扣费）。
 * - 多冻结差额（reserved − actualAmount）以 REFUND 退回后再记 CHARGE，使净扣 = actualAmount。
 * - 关联恒走 bizRefType / bizRefId，绝不写入 jobId。
 *
 * @param tx Prisma 事务客户端（与商家实体状态更新同事务）
 * @param input 扣费输入（关联键 = bizRefType + bizRefId）
 */
export async function chargeMerchantCredits(
  tx: Prisma.TransactionClient,
  input: MerchantChargeInput
): Promise<void> {
  await chargeCreditsByBizRef(tx, {
    userId: input.userId,
    bizRefType: input.bizRefType,
    bizRefId: input.bizRefId,
    actualAmount: input.actualAmount,
  })
}

/**
 * 退款（REFUND）——薄封装，委托 credit-service.refundCreditsByBizRef。
 *
 * 用于 CHARGE 之前失败的全额补偿：退还额 = 该关联键已 RESERVE 的冻结额度。
 * - 经 withCreditLock 全局锁串行化 + Prisma 事务（由底层实现保证）。
 * - 幂等键：(bizRefType, bizRefId, action='REFUND')，已存在则跳过（不重复退款）。
 * - 无对应 RESERVE 时跳过（绝不凭空增加余额）；退款后余额恢复至冻结发生前。
 * - 关联恒走 bizRefType / bizRefId，绝不写入 jobId。
 *
 * @param input 退款输入（关联键 = bizRefType + bizRefId）
 */
export async function refundMerchantCredits(input: MerchantRefundInput): Promise<void> {
  await refundCreditsByBizRef({
    userId: input.userId,
    bizRefType: input.bizRefType,
    bizRefId: input.bizRefId,
  })
}
