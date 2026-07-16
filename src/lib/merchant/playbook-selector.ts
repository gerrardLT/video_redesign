/**
 * 剧本选择算法
 *
 * 根据门店画像和内容目标选择合适的剧本集。
 * 包含剧本兼容性检查、加权评分、连续使用限制等核心选择逻辑。
 */

import { prisma } from '@/lib/shared/db'
import { MAX_CONSECUTIVE_PLAYBOOK_USE } from '@/constants/merchant'
import type {
  Store, StoreProfile, ProductOffer, Playbook, PlaybookSegment,
} from './playbook-types'
import type { MerchantIndustry, ContentGoal, ShotTaskType } from '@/generated/prisma'

// ========================
// 镜头类型与拍摄能力的映射
// ========================

/** 需要特定拍摄能力的镜头类型映射 */
const SHOT_CAPABILITY_MAP: Record<ShotTaskType, 'canShootKitchen' | 'canShootStaff' | 'canShootCustomers' | null> = {
  COOKING_PROCESS: 'canShootKitchen',
  STAFF_ACTION: 'canShootStaff',
  CUSTOMER_REACTION: 'canShootCustomers',
  OWNER_TALKING: 'canShootStaff',
  STOREFRONT: null,
  PRODUCT_CLOSEUP: null,
  ENVIRONMENT: null,
  OFFER_DISPLAY: null,
  CTA_SCREEN: null,
  AI_GENERATED_FILLER: null,
}

// ========================
// selectPlaybooks — 剧本选择算法
// ========================

/**
 * 根据门店画像和内容目标选择合适的剧本集
 *
 * 选择算法：
 * 1. 从 DB 查询 industry + isActive=true 的所有 Playbook
 * 2. 按 ContentGoal 分组
 * 3. 过滤掉需要不可用拍摄能力的剧本
 * 4. 按 scoreWeight 加权排序
 * 5. 确保同一剧本不连续使用超过 3 次（查最近 3 个 ContentBrief 的 playbookId）
 * 6. 如指定 goal 无匹配，fallback 到最高分可用剧本
 * 7. 排除 excludePlaybookIds（来自 performance-learning 避免列表）
 */
export async function selectPlaybooks(input: {
  industry: MerchantIndustry
  goals: ContentGoal[]
  storeProfile: StoreProfile
  offers: ProductOffer[]
  days: number
  excludePlaybookIds?: string[]
  // 复用权重名单（需求 1.3）：来自上轮复盘建议「复用剧本」，命中的剧本在同 goal 候选中优先选用
  preferredPlaybookIds?: string[]
}): Promise<Playbook[]> {
  const { industry, goals, storeProfile, offers, days, excludePlaybookIds = [], preferredPlaybookIds = [] } = input

  // 1. 从 DB 查询该行业所有激活的剧本
  const rawPlaybooks = await prisma.playbook.findMany({
    where: {
      industry,
      isActive: true,
    },
  })

  // 转为类型安全的 Playbook 对象
  const allPlaybooks: Playbook[] = rawPlaybooks.map(castPlaybook)

  // 7. 排除 performance-learning 建议避免的剧本
  const availablePlaybooks = allPlaybooks.filter(
    (pb) => !excludePlaybookIds.includes(pb.id)
  )

  // 3. 过滤掉需要不可用拍摄能力的剧本（仅过滤必拍镜头）
  const store: Pick<Store, 'canShootKitchen' | 'canShootStaff' | 'canShootCustomers'> = {
    canShootKitchen: storeProfile.contentDos?.some((d: string) => d.includes('厨房')) ?? false,
    canShootStaff: true, // 默认可以拍员工
    canShootCustomers: false,
  }
  // 使用 storeProfile 关联的 store 拍摄能力，需要从 storeProfile.storeId 查询
  const storeRecord = await prisma.store.findUnique({
    where: { id: storeProfile.storeId },
    select: { canShootKitchen: true, canShootStaff: true, canShootCustomers: true },
  })
  if (storeRecord) {
    store.canShootKitchen = storeRecord.canShootKitchen
    store.canShootStaff = storeRecord.canShootStaff
    store.canShootCustomers = storeRecord.canShootCustomers
  }

  const capablePlaybooks = availablePlaybooks.filter((pb) =>
    isPlaybookCompatible(pb, store)
  )

  // 5. 查询最近 3 个 ContentBrief 的 playbookId，防止连续重复使用
  const recentBriefs = await prisma.contentBrief.findMany({
    where: { storeId: storeProfile.storeId },
    orderBy: { scheduledDate: 'desc' },
    take: MAX_CONSECUTIVE_PLAYBOOK_USE,
    select: { playbookId: true },
  })
  const recentPlaybookIds = recentBriefs.map((b) => b.playbookId).filter(Boolean) as string[]

  // 按 goal 为每天选择剧本
  const selectedPlaybooks: Playbook[] = []
  // 跟踪本次选择中连续使用同一剧本的次数
  const consecutiveTracker: string[] = [...recentPlaybookIds]

  for (let i = 0; i < days; i++) {
    const goal = goals[i % goals.length]

    // 2. 按 ContentGoal 分组筛选
    let candidates = capablePlaybooks.filter((pb) => pb.goal === goal)

    // 6. 如指定 goal 无匹配，fallback 到最高分可用剧本
    if (candidates.length === 0) {
      candidates = [...capablePlaybooks]
    }

    if (candidates.length === 0) {
      // 无可用剧本，跳过（理论上不应发生，种子数据保证覆盖）
      continue
    }

    // 4. 按 scoreWeight 加权排序（views + conversion 之和，越高越优先）
    const sorted = sortByScoreWeight(candidates, offers)

    // 4.1 复用权重（需求 1.3）：上轮复盘采纳的「复用剧本」在同 goal 候选中前置，
    //     保持原有评分次序作为次级排序，命中名单者整体提到队首
    const reuseBoosted = preferredPlaybookIds.length > 0
      ? [
          ...sorted.filter((pb) => preferredPlaybookIds.includes(pb.id)),
          ...sorted.filter((pb) => !preferredPlaybookIds.includes(pb.id)),
        ]
      : sorted

    // 5. 排除连续使用超过 MAX_CONSECUTIVE_PLAYBOOK_USE 次的剧本
    const selected = pickNonConsecutive(reuseBoosted, consecutiveTracker)

    if (selected) {
      selectedPlaybooks.push(selected)
      consecutiveTracker.push(selected.id)
    } else {
      // 所有剧本都连续使用超限，取最高分的
      selectedPlaybooks.push(reuseBoosted[0])
      consecutiveTracker.push(reuseBoosted[0].id)
    }
  }

  return selectedPlaybooks
}

// ========================
// 内部辅助函数
// ========================

/**
 * 将 Prisma 原始记录转为类型安全的 Playbook 对象
 * Prisma Json 字段返回 unknown，需要手动 cast
 */
export function castPlaybook(raw: Record<string, unknown>): Playbook {
  return {
    id: raw.id as string,
    industry: raw.industry as MerchantIndustry,
    name: raw.name as string,
    goal: raw.goal as ContentGoal,
    description: raw.description as string | null,
    structure: (raw.structure ?? []) as PlaybookSegment[],
    requiredShots: (raw.requiredShots ?? []) as ShotTaskType[],
    optionalShots: (raw.optionalShots ?? null) as ShotTaskType[] | null,
    hookTemplates: (raw.hookTemplates ?? []) as string[],
    captionTemplates: (raw.captionTemplates ?? []) as string[],
    coverTitleTemplates: (raw.coverTitleTemplates ?? []) as string[],
    ctaTemplates: (raw.ctaTemplates ?? []) as string[],
    complianceRules: (raw.complianceRules ?? null) as Record<string, unknown> | null,
    scoreWeight: (raw.scoreWeight ?? null) as { views: number; conversion: number } | null,
    tierRequired: (raw.tierRequired ?? 'FREE') as string,
    isActive: raw.isActive as boolean,
    createdAt: raw.createdAt as Date,
    updatedAt: raw.updatedAt as Date,
  }
}

/**
 * 检查剧本是否与门店的拍摄能力兼容
 * 仅检查必拍镜头（requiredShots），可选镜头不影响选择
 */
function isPlaybookCompatible(
  playbook: Playbook,
  store: Pick<Store, 'canShootKitchen' | 'canShootStaff' | 'canShootCustomers'>
): boolean {
  for (const shotType of playbook.requiredShots) {
    const capabilityKey = SHOT_CAPABILITY_MAP[shotType]
    if (capabilityKey && !store[capabilityKey as keyof typeof store]) {
      return false
    }
  }
  return true
}

/**
 * 按 scoreWeight 加权排序
 * 优先级：有 offer 匹配时 conversion 权重更高；无 offer 时 views 权重更高
 */
function sortByScoreWeight(playbooks: Playbook[], offers: ProductOffer[]): Playbook[] {
  const hasActiveOffer = offers.some((o) => o.isActive)

  return [...playbooks].sort((a, b) => {
    const scoreA = getWeightedScore(a.scoreWeight, hasActiveOffer)
    const scoreB = getWeightedScore(b.scoreWeight, hasActiveOffer)
    return scoreB - scoreA // 降序
  })
}

/** 计算加权分数 */
function getWeightedScore(
  weight: { views: number; conversion: number } | null,
  hasOffer: boolean
): number {
  if (!weight) return 50 // 无权重时使用默认中间值
  if (hasOffer) {
    // 有活跃优惠时，conversion 权重更高
    return weight.views * 0.4 + weight.conversion * 0.6
  }
  // 无优惠时，views 权重更高
  return weight.views * 0.6 + weight.conversion * 0.4
}

/**
 * 从排序后的候选列表中选择一个不会连续超限的剧本
 * 检查最近 MAX_CONSECUTIVE_PLAYBOOK_USE 个使用记录
 */
function pickNonConsecutive(
  sorted: Playbook[],
  recentIds: string[]
): Playbook | null {
  for (const pb of sorted) {
    if (!isConsecutiveOverLimit(pb.id, recentIds)) {
      return pb
    }
  }
  return null
}

/**
 * 判断某个 playbookId 是否已经连续使用达到上限
 */
function isConsecutiveOverLimit(playbookId: string, recentIds: string[]): boolean {
  if (recentIds.length < MAX_CONSECUTIVE_PLAYBOOK_USE) return false

  // 检查最近 N 个是否全是同一个 playbookId
  const tail = recentIds.slice(-MAX_CONSECUTIVE_PLAYBOOK_USE)
  return tail.every((id) => id === playbookId)
}
