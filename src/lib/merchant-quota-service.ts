/**
 * 商家额度检查服务（Merchant Quota Service）
 *
 * 根据用户订阅等级检查各操作的额度限制。
 * 支持 FREE/BASIC/GROWTH/AGENCY 四个等级，各等级有不同的门店数、
 * 内容计划数、视频生成数限制。
 *
 * 月度重置规则：
 * - FREE: 终身计数，不重置
 * - BASIC/GROWTH/AGENCY: 每月 1 号 00:00:00 重置生成计数
 *
 * Requirements: 14.1-14.8
 */

import { prisma } from '@/lib/db'
import { SUBSCRIPTION_TIERS } from '@/constants/merchant'
import type { QuotaAction, QuotaCheckResult } from '@/types/merchant'

// ========================
// 类型定义
// ========================

/** 商家订阅等级 */
export type MerchantTier = keyof typeof SUBSCRIPTION_TIERS

// ========================
// 核心导出函数
// ========================

/**
 * 检查商家是否有足够的额度执行指定操作
 *
 * @param userId 用户 ID
 * @param action 需要检查额度的操作类型
 * @returns 额度检查结果：allowed 是否允许，current 当前使用量，limit 额度上限
 */
export async function checkMerchantQuota(
  userId: string,
  action: QuotaAction
): Promise<QuotaCheckResult> {
  // 1. 获取用户订阅等级
  const tier = await getMerchantTier(userId)
  const tierConfig = SUBSCRIPTION_TIERS[tier]

  // 2. 根据操作类型执行对应的额度检查
  switch (action) {
    case 'CREATE_STORE':
      return checkStoreQuota(userId, tierConfig.maxStores)

    case 'CREATE_CONTENT_PLAN':
      return checkContentPlanQuota(userId, tier, tierConfig.maxContentPlans)

    case 'RENDER_VIDEO':
      return checkVideoGenerationQuota(userId, tier, tierConfig.maxGenerations, tierConfig.isLifetime)

    case 'EXPORT_VIDEO':
      return checkExportPermission(tier)

    case 'ACCESS_INSIGHTS':
      return checkInsightsPermission(tier)

    default: {
      // 未知操作类型，拒绝
      const _exhaustive: never = action
      throw new Error(`未知的额度操作类型: ${_exhaustive}`)
    }
  }
}

// ========================
// 订阅等级获取
// ========================

/**
 * 获取用户的商家订阅等级
 *
 * 通过查询用户的活跃订阅记录和关联的套餐信息确定等级。
 * 使用套餐 name 字段与 SUBSCRIPTION_TIERS 中的 label 匹配。
 * 无活跃订阅则返回 FREE。
 */
export async function getMerchantTier(userId: string): Promise<MerchantTier> {
  const activeSubscription = await prisma.subscriptionRecord.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
  })

  if (!activeSubscription) {
    return 'FREE'
  }

  // 根据套餐名称匹配商家等级
  const planName = activeSubscription.plan.name
  const tierEntry = Object.entries(SUBSCRIPTION_TIERS).find(
    ([, config]) => config.label === planName
  )

  if (tierEntry) {
    return tierEntry[0] as MerchantTier
  }

  // 套餐名称无法匹配到商家等级时，按 BASIC 处理（有活跃订阅但未匹配到更高等级）
  return 'BASIC'
}

// ========================
// 各操作的额度检查逻辑
// ========================

/**
 * 检查门店创建额度
 *
 * 统计用户名下已有门店数量，与等级上限对比。
 */
async function checkStoreQuota(
  userId: string,
  maxStores: number
): Promise<QuotaCheckResult> {
  // 通过 Merchant → stores 关联统计
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    include: { _count: { select: { stores: true } } },
  })

  const current = merchant?._count.stores ?? 0
  const allowed = current < maxStores

  return {
    allowed,
    current,
    limit: maxStores,
  }
}

/**
 * 检查内容计划创建额度
 *
 * 统计当前月份已创建的内容计划数量（月度重置）。
 * FREE 等级为终身限制（maxContentPlans=1），其他等级无限制时 limit=-1。
 */
async function checkContentPlanQuota(
  userId: string,
  tier: MerchantTier,
  maxContentPlans: number
): Promise<QuotaCheckResult> {
  // 无限制的等级直接放行
  if (maxContentPlans === Infinity) {
    return { allowed: true, current: 0, limit: -1 }
  }

  // 获取用户名下所有门店 ID
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    select: { stores: { select: { id: true } } },
  })

  if (!merchant) {
    return { allowed: true, current: 0, limit: maxContentPlans }
  }

  const storeIds = merchant.stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return { allowed: true, current: 0, limit: maxContentPlans }
  }

  // FREE 等级：终身计数
  // BASIC 等级：月度计数
  let current: number
  if (tier === 'FREE') {
    current = await prisma.contentPlan.count({
      where: { storeId: { in: storeIds } },
    })
  } else {
    const { monthStart } = getCurrentMonthRange()
    current = await prisma.contentPlan.count({
      where: {
        storeId: { in: storeIds },
        createdAt: { gte: monthStart },
      },
    })
  }

  const allowed = current < maxContentPlans
  const result: QuotaCheckResult = { allowed, current, limit: maxContentPlans }

  // 月度等级附带重置日期
  if (!SUBSCRIPTION_TIERS[tier].isLifetime) {
    result.resetDate = getNextMonthResetDate()
  }

  return result
}

/**
 * 检查视频生成额度
 *
 * - FREE: 终身 3 次限制，统计用户所有历史 VideoVariant 数量
 * - BASIC/GROWTH/AGENCY: 月度限制，统计当月 VideoVariant 数量
 *
 * 注意：一次渲染生成 3 个 VideoVariant，此处统计的是 VideoVariant 总数
 * （与 Requirement 14.2-14.5 中"视频生成次数"对应渲染请求次数，
 *   每次请求消耗 1 次额度但产出 3 个版本）。
 * 这里按渲染请求次数计算：统计关联 ContentBrief 中 status=GENERATED 或以上的数量。
 */
async function checkVideoGenerationQuota(
  userId: string,
  tier: MerchantTier,
  maxGenerations: number,
  isLifetime: boolean
): Promise<QuotaCheckResult> {
  // 获取用户名下所有门店 ID
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    select: { stores: { select: { id: true } } },
  })

  if (!merchant) {
    return { allowed: true, current: 0, limit: maxGenerations }
  }

  const storeIds = merchant.stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return { allowed: true, current: 0, limit: maxGenerations }
  }

  // 统计视频生成次数（以 ContentBrief 进入 RENDERING 或更后状态为准）
  // 使用 VideoVariant 数量除以 3（每次渲染产出 3 个版本）
  let variantCount: number

  if (isLifetime) {
    // FREE 终身计数
    variantCount = await prisma.videoVariant.count({
      where: {
        contentBrief: { storeId: { in: storeIds } },
      },
    })
  } else {
    // 月度计数
    const { monthStart } = getCurrentMonthRange()
    variantCount = await prisma.videoVariant.count({
      where: {
        contentBrief: { storeId: { in: storeIds } },
        createdAt: { gte: monthStart },
      },
    })
  }

  // 每次渲染产出 3 个 VideoVariant，转换为渲染次数
  const current = Math.ceil(variantCount / 3)
  const allowed = current < maxGenerations

  const result: QuotaCheckResult = { allowed, current, limit: maxGenerations }

  // 月度等级附带重置日期
  if (!isLifetime) {
    result.resetDate = getNextMonthResetDate()
  }

  return result
}

/**
 * 检查导出权限
 *
 * 所有等级都允许导出（分辨率不同由导出服务控制），此处仅做权限标记检查。
 * 实际上根据 Requirement 10.5，FREE 等级也可导出（720p）。
 */
async function checkExportPermission(tier: MerchantTier): Promise<QuotaCheckResult> {
  // 所有等级均可导出视频，区别在于分辨率
  // 等级越高分辨率越高，由导出服务根据 tier 决定分辨率
  return {
    allowed: true,
    current: 0,
    limit: -1,
  }
}

/**
 * 检查数据分析（Insights）访问权限
 *
 * 仅 GROWTH 和 AGENCY 等级有数据分析功能。
 */
async function checkInsightsPermission(tier: MerchantTier): Promise<QuotaCheckResult> {
  const tierConfig = SUBSCRIPTION_TIERS[tier]
  const allowed = tierConfig.hasInsights

  return {
    allowed,
    current: 0,
    limit: allowed ? -1 : 0,
  }
}

// ========================
// 工具函数
// ========================

/**
 * 获取当前月份的起止时间范围
 *
 * 月度重置规则：每月 1 号 00:00:00（Requirement 14.8）
 */
function getCurrentMonthRange(): { monthStart: Date; monthEnd: Date } {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
  return { monthStart, monthEnd }
}

/**
 * 获取下个月的重置日期（下月 1 号 00:00:00）
 */
function getNextMonthResetDate(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
}
