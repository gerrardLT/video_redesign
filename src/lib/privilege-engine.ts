/**
 * 特权引擎（PrivilegeEngine）
 * 根据用户订阅状态和等级动态决定其可用特权：
 * - 年卡会员：最高优先级(priority=1)、1080p分辨率、去水印、30天版本历史
 * - 月卡会员：中等优先级(priority=3)、1080p分辨率、去水印、30天版本历史
 * - 免费用户：标准优先级(priority=5)、最高720p、有水印、7天版本历史
 *
 * 所有等级的生成模式统一为链式串行（分镜组尾帧衔接需要前一组完成后才能拿到尾帧给下一组）。
 * 并发限制的含义为：用户能同时对多少个不同项目发起生成任务。
 */
import { prisma } from './db'
import {
  type UserTier,
  type ConcurrencyConfig,
  CONCURRENCY_LIMITS,
  QUEUE_PRIORITIES,
} from '@/constants/concurrency'
import { MERCHANT_PRIVILEGE_MAPPING } from '@/constants/merchant'

// ========================
// 类型定义
// ========================

export interface UserPrivileges {
  /** 生成队列优先级 (1=年卡最高优先, 3=月卡, 5=免费最低) */
  queuePriority: number
  /** 允许的最大分辨率列表 */
  allowedResolutions: string[]
  /** 是否添加水印 */
  watermarkEnabled: boolean
  /** 版本历史保留天数 */
  historyRetentionDays: number
  /** 是否为活跃会员 */
  isActiveMember: boolean
  /** 用户等级 */
  tier: UserTier
  /** 并发配置（各任务类型的项目级并发限制） */
  concurrency: ConcurrencyConfig
}

// ========================
// 纯函数：并发配置查询
// ========================

/**
 * 根据用户等级返回并发配置
 *
 * 纯函数，直接从常量表查询。
 *
 * @param tier - 用户等级
 * @returns 各任务类型的并发限制配置
 */
export function getConcurrencyConfig(tier: UserTier): ConcurrencyConfig {
  return CONCURRENCY_LIMITS[tier]
}

// ========================
// 纯函数：等级判定
// ========================

/**
 * 根据订阅状态和套餐类型确定用户等级
 *
 * 纯函数，无副作用，可用于属性测试。
 *
 * 判定逻辑：
 * 1. 若 subscriptionStatus !== 'ACTIVE'（无有效订阅） → FREE
 * 2. 若 planType === 'yearly'（年卡套餐） → YEARLY
 * 3. 否则（月卡套餐） → MONTHLY
 *
 * @param subscriptionStatus - 订阅记录状态（ACTIVE / CANCELED / EXPIRED / null）
 * @param planType - 套餐类型（'monthly' / 'yearly' / null）
 * @returns 用户等级
 */
export function determineTier(
  subscriptionStatus: string | null,
  planType: string | null
): UserTier {
  if (subscriptionStatus !== 'ACTIVE') {
    return 'FREE'
  }
  if (planType === 'yearly') {
    return 'YEARLY'
  }
  return 'MONTHLY'
}

// ========================
// 纯函数：特权判定
// ========================

/**
 * 根据用户等级确定完整特权配置
 *
 * 纯函数，无副作用，可用于属性测试。
 * 队列优先级基于 QUEUE_PRIORITIES 常量表。
 *
 * @param tier - 用户等级
 * @returns 用户完整特权配置
 */
export function determinePrivileges(tier: UserTier): UserPrivileges {
  const concurrency = getConcurrencyConfig(tier)
  const queuePriority = QUEUE_PRIORITIES[tier]

  if (tier === 'YEARLY' || tier === 'MONTHLY') {
    return {
      queuePriority,
      allowedResolutions: ['480p', '720p', '1080p'],
      watermarkEnabled: false,
      historyRetentionDays: 30,
      isActiveMember: true,
      tier,
      concurrency,
    }
  }

  // FREE 等级
  return {
    queuePriority,
    allowedResolutions: ['480p', '720p'],
    watermarkEnabled: true,
    historyRetentionDays: 7,
    isActiveMember: false,
    tier,
    concurrency,
  }
}

// ========================
// 异步方法：查询用户特权
// ========================

/**
 * 获取用户当前特权配置
 *
 * 查询数据库中该用户是否存在 status='ACTIVE' 的 SubscriptionRecord，
 * 关联查询 SubscriptionPlan 获取套餐类型（monthly/yearly），
 * 然后调用 determineTier 确定等级，最终通过 determinePrivileges 返回完整特权配置。
 *
 * @param userId - 用户 ID
 * @returns 用户完整特权配置（含并发限制）
 */
export async function getUserPrivileges(userId: string): Promise<UserPrivileges> {
  const activeRecord = await prisma.subscriptionRecord.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
    },
    include: {
      plan: true,
    },
  })

  const subscriptionStatus = activeRecord?.status ?? null
  const planType = activeRecord?.plan?.type ?? null
  const tier = determineTier(subscriptionStatus, planType)

  return determinePrivileges(tier)
}

// ========================
// 本地生活会员权益（Merchant Privileges）
// ========================

/**
 * 本地生活会员权益（由 UserTier 经 MERCHANT_PRIVILEGE_MAPPING 决定）
 *
 * 会员权益统一收敛到视频重塑既有的订阅体系（UserTier），
 * 不再依据 SubscriptionPlan.name 解读已废除的 Merchant_Tier。
 */
export interface MerchantPrivileges {
  /** 用户等级（FREE / MONTHLY / YEARLY） */
  tier: UserTier
  /** 导出最高分辨率（'720p' | '1080p'） */
  exportResolution: '720p' | '1080p'
  /** 是否启用合规检测 */
  complianceCheckEnabled: boolean
  /** 是否开放数据洞察 */
  insightsEnabled: boolean
  /** 名下门店数量上限 */
  maxStores: number
  /** 批量并发上限（复用 CONCURRENCY_LIMITS[tier].generate 语义） */
  batchConcurrency: number
}

/**
 * 纯函数：根据用户等级返回本地生活会员权益
 *
 * 无副作用，可用于属性测试。
 * 导出分辨率、合规检测、数据洞察、门店上限直接查 MERCHANT_PRIVILEGE_MAPPING；
 * 批量并发复用 CONCURRENCY_LIMITS[tier].generate 的项目级并发语义。
 *
 * @param tier - 用户等级
 * @returns 本地生活会员权益配置
 */
export function determineMerchantPrivileges(tier: UserTier): MerchantPrivileges {
  const mapping = MERCHANT_PRIVILEGE_MAPPING[tier]

  return {
    tier,
    exportResolution: mapping.exportResolution,
    complianceCheckEnabled: mapping.complianceCheckEnabled,
    insightsEnabled: mapping.insightsEnabled,
    maxStores: mapping.maxStores,
    batchConcurrency: CONCURRENCY_LIMITS[tier].generate,
  }
}

/**
 * 异步：查询用户当前本地生活会员权益
 *
 * 复用既有 getUserPrivileges 的订阅查询路径得到 UserTier，
 * 再经 determineMerchantPrivileges 映射为本地生活权益。
 * 不新增任何按 SubscriptionPlan.name 解读的路径。
 *
 * @param userId - 用户 ID
 * @returns 本地生活会员权益配置
 */
export async function getMerchantPrivileges(userId: string): Promise<MerchantPrivileges> {
  const { tier } = await getUserPrivileges(userId)

  return determineMerchantPrivileges(tier)
}
