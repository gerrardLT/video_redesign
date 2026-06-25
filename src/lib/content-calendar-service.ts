/**
 * 内容日历生成服务
 *
 * 基于门店画像、剧本库和每日目标分配规则，为门店生成 7 天内容计划。
 * 每天对应一条 ContentBrief + 关联的 ShotTasks，所有写操作在数据库事务中完成。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import { prisma } from '@/lib/db'
import { selectPlaybooks, instantiatePlaybook } from '@/lib/playbook-engine'
import { generatePerformanceInsights } from '@/lib/performance-learning-service'
import { WEEKLY_GOAL_SCHEDULE } from '@/constants/merchant'
import type { ContentGoal } from '@/types/merchant'

// ========================
// 需要产品引用的 ContentGoal（无 ProductOffer 时跳过）
// Req 4.6: 无 ProductOffer 时跳过需要产品引用的 goal
// ========================

/** 需要关联商品/优惠信息的内容目标 */
const GOALS_REQUIRING_PRODUCT: ContentGoal[] = [
  'PROMOTION',
  'NEW_PRODUCT',
]

/** 无商品时的替代目标列表（品牌故事、氛围、信任类） */
const FALLBACK_GOALS: ContentGoal[] = [
  'BRAND_STORY',
  'TRUST_BUILDING',
  'REPEAT_PURCHASE',
]

// ========================
// 主函数：生成内容计划
// ========================

/**
 * 生成内容计划
 *
 * 流程：
 * 1. 读取 Store + StoreProfile + active ProductOffers
 * 2. 如无 StoreProfile 或 contentPositioning 为空 → 抛错 (Req 4.7)
 * 3. 如有 performance-learning 数据 → 读取 recommendedNextGoals 和 playbooksToAvoid（可选）
 * 4. 创建 ContentPlan 记录
 * 5. 对每一天：根据 WEEKLY_GOAL_SCHEDULE 确定 goal → selectPlaybook → instantiatePlaybook → 创建 ContentBrief + ShotTasks
 * 6. 设置 ContentBrief.status = READY_TO_SHOOT
 * 7. 返回 contentPlan + briefs
 *
 * @param input.storeId 门店 ID
 * @param input.startDate 起始日期（默认明天）
 * @param input.days 天数（默认 7）
 * @param input.preferredGoals 用户偏好目标（可选）
 */
export async function generateContentPlan(input: {
  storeId: string
  startDate: Date
  days: number
  preferredGoals?: ContentGoal[]
}): Promise<{ contentPlan: ContentPlanRecord; briefs: ContentBriefRecord[] }> {
  const { storeId, startDate, days, preferredGoals } = input

  // 1. 读取 Store + StoreProfile + active ProductOffers
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      profile: true,
      offers: { where: { isActive: true } },
    },
  })

  if (!store) {
    throw new Error(`[content-calendar-service] 门店不存在: ${storeId}`)
  }

  // 2. 如无 StoreProfile 或 contentPositioning 为空 → 抛错 (Req 4.7)
  if (!store.profile) {
    throw new Error(
      `[content-calendar-service] 门店画像未完成，请先生成画像再创建内容计划 (storeId: ${storeId})`
    )
  }

  if (!store.profile.contentPositioning) {
    throw new Error(
      `[content-calendar-service] 门店画像内容定位为空，请先完善画像再创建内容计划 (storeId: ${storeId})`
    )
  }

  const storeProfile = store.profile
  const activeOffers = store.offers
  const hasActiveOffers = activeOffers.length > 0

  // 3. 读取 performance-learning 数据（获取 recommendedNextGoals 和 playbooksToAvoid）
  let excludePlaybookIds: string[] = []
  let preferredGoalsFromLearning: ContentGoal[] | undefined = undefined
  try {
    const insights = await generatePerformanceInsights({ storeId })
    excludePlaybookIds = insights.playbooksToAvoid
    if (insights.recommendedNextGoals.length > 0) {
      preferredGoalsFromLearning = insights.recommendedNextGoals
    }
  } catch (error) {
    // 学习数据获取失败不阻塞日历生成，记录日志
    console.warn('[content-calendar-service] performance-learning 数据获取失败，使用默认策略:', error)
  }

  // 计算每天的目标分配（Req 4.2, 4.5, 4.6）
  // 优先使用用户指定的 preferredGoals，其次使用 performance-learning 推荐的目标
  const effectivePreferredGoals = preferredGoals ?? preferredGoalsFromLearning
  const dailyGoals = assignDailyGoals(startDate, days, hasActiveOffers, effectivePreferredGoals)

  // 计算结束日期
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + days - 1)

  // 选择剧本（通过 playbook-engine）
  const playbooks = await selectPlaybooks({
    industry: store.industry as Parameters<typeof selectPlaybooks>[0]['industry'],
    goals: dailyGoals,
    storeProfile: {
      id: storeProfile.id,
      storeId: storeProfile.storeId,
      contentPositioning: storeProfile.contentPositioning,
      recommendedPersona: storeProfile.recommendedPersona,
      hookKeywords: storeProfile.hookKeywords as string[] | null,
      forbiddenClaims: storeProfile.forbiddenClaims as string[] | null,
      preferredCta: storeProfile.preferredCta as string[] | null,
      contentDos: storeProfile.contentDos as string[] | null,
      contentDonts: storeProfile.contentDonts as string[] | null,
    },
    offers: activeOffers.map((o) => ({
      id: o.id,
      storeId: o.storeId,
      name: o.name,
      description: o.description,
      originalPrice: o.originalPrice,
      salePrice: o.salePrice,
      sellingPoints: o.sellingPoints as string[] | null,
      usageRules: o.usageRules,
      isActive: o.isActive,
    })),
    days,
    excludePlaybookIds,
  })

  // 4-6. 在事务中创建 ContentPlan + ContentBrief + ShotTasks
  const result = await prisma.$transaction(async (tx) => {
    // 4. 创建 ContentPlan 记录
    const contentPlan = await tx.contentPlan.create({
      data: {
        storeId,
        title: `${store.name} ${formatDate(startDate)} ~ ${formatDate(endDate)} 内容计划`,
        startDate,
        endDate,
        strategy: {
          dailyGoals,
          hasActiveOffers,
          playbookCount: playbooks.length,
          preferredGoals: preferredGoals ?? null,
        },
        status: 'ACTIVE',
      },
    })

    // 5. 对每一天：实例化剧本 → 创建 ContentBrief + ShotTasks
    const briefs: ContentBriefRecord[] = []

    for (let i = 0; i < days; i++) {
      const scheduledDate = new Date(startDate)
      scheduledDate.setDate(scheduledDate.getDate() + i)

      const goal = dailyGoals[i]
      const playbook = playbooks[i]

      if (!playbook) {
        // 无可用剧本时跳过该天（不应发生，种子数据保证覆盖）
        console.warn(
          `[content-calendar-service] 第 ${i + 1} 天无可用剧本 (goal: ${goal})，跳过`
        )
        continue
      }

      // 为需要产品引用的 goal 选择一个 offer
      const offer = GOALS_REQUIRING_PRODUCT.includes(goal) && hasActiveOffers
        ? pickOffer(activeOffers, i)
        : undefined

      // 实例化剧本为 ContentBriefDraft
      const draft = await instantiatePlaybook({
        playbook,
        store: {
          id: store.id,
          name: store.name,
          industry: store.industry as Parameters<typeof instantiatePlaybook>[0]['store']['industry'],
          city: store.city,
          district: store.district,
          businessArea: store.businessArea,
          address: store.address,
          mainProducts: store.mainProducts as string[],
          mainSellingPoints: store.mainSellingPoints as string[],
          canShootKitchen: store.canShootKitchen,
          canShootStaff: store.canShootStaff,
          canShootCustomers: store.canShootCustomers,
        },
        profile: {
          id: storeProfile.id,
          storeId: storeProfile.storeId,
          contentPositioning: storeProfile.contentPositioning,
          recommendedPersona: storeProfile.recommendedPersona,
          hookKeywords: storeProfile.hookKeywords as string[] | null,
          forbiddenClaims: storeProfile.forbiddenClaims as string[] | null,
          preferredCta: storeProfile.preferredCta as string[] | null,
          contentDos: storeProfile.contentDos as string[] | null,
          contentDonts: storeProfile.contentDonts as string[] | null,
        },
        offer: offer
          ? {
              id: offer.id,
              storeId: offer.storeId,
              name: offer.name,
              description: offer.description,
              originalPrice: offer.originalPrice,
              salePrice: offer.salePrice,
              sellingPoints: offer.sellingPoints as string[] | null,
              usageRules: offer.usageRules,
              isActive: offer.isActive,
            }
          : undefined,
        scheduledDate,
      })

      // 确保 shotTasks 数量在 1-5 之间（Req 4.4）
      const shotTasks = draft.shotTasks.slice(0, 5)
      if (shotTasks.length === 0) {
        // 至少保留 1 个 shot task
        shotTasks.push({
          order: 1,
          type: 'PRODUCT_CLOSEUP',
          title: '拍产品特写',
          instruction: '把手机靠近产品，拍清楚产品的样子',
          durationSec: 5,
          required: true,
        })
      }

      // 创建 ContentBrief 记录，状态设为 READY_TO_SHOOT（Req 4.1 步骤 6）
      const brief = await tx.contentBrief.create({
        data: {
          storeId,
          contentPlanId: contentPlan.id,
          playbookId: playbook.id,
          title: draft.title,
          goal: goal,
          scheduledDate,
          status: 'READY_TO_SHOOT',
          hook: draft.hook,
          mainMessage: draft.mainMessage,
          offerId: offer?.id ?? null,
          suggestedCaption: draft.suggestedCaption,
          suggestedTitle: draft.suggestedTitle,
          suggestedCoverTitle: draft.suggestedCoverTitle,
          suggestedCta: draft.suggestedCta,
          platformCopies: draft.platformCopies as Record<string, unknown>,
          tags: draft.tags,
          aiReasoning: draft.aiReasoning,
          // 创建关联的 ShotTasks
          shotTasks: {
            create: shotTasks.map((st) => ({
              order: st.order,
              type: st.type,
              title: st.title,
              instruction: st.instruction,
              durationSec: st.durationSec,
              required: st.required,
              framingGuide: st.framingGuide ?? undefined,
              qualityRules: st.qualityRules ?? undefined,
              status: 'PENDING',
            })),
          },
        },
        include: {
          shotTasks: true,
        },
      })

      briefs.push(brief)
    }

    return { contentPlan, briefs }
  })

  return result
}

// ========================
// 每日目标分配逻辑
// ========================

/**
 * 根据起始日期和天数分配每日 ContentGoal
 *
 * 规则 (Req 4.2):
 * - 使用 WEEKLY_GOAL_SCHEDULE 根据星期几分配固定目标
 *
 * 约束 (Req 4.5):
 * - 7 天内无重复 ContentGoal
 *
 * 约束 (Req 4.6):
 * - 无 ProductOffer 时跳过需要产品引用的 goal，用替代目标代替
 */
function assignDailyGoals(
  startDate: Date,
  days: number,
  hasActiveOffers: boolean,
  preferredGoals?: ContentGoal[]
): ContentGoal[] {
  const goals: ContentGoal[] = []
  const usedGoals = new Set<ContentGoal>()

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)

    // 获取星期几 (1=周一, 7=周日)
    const jsDay = date.getDay() // 0=周日, 1=周一, ..., 6=周六
    const isoDay = jsDay === 0 ? 7 : jsDay // 转为 ISO 格式: 1=周一, 7=周日

    // 从 WEEKLY_GOAL_SCHEDULE 获取当天目标
    let goal = WEEKLY_GOAL_SCHEDULE[isoDay as keyof typeof WEEKLY_GOAL_SCHEDULE] as ContentGoal

    // Req 4.6: 无 ProductOffer 时跳过需要产品引用的 goal
    if (!hasActiveOffers && GOALS_REQUIRING_PRODUCT.includes(goal)) {
      goal = pickFallbackGoal(usedGoals)
    }

    // Req 4.5: 确保 7 天内无重复 ContentGoal
    if (usedGoals.has(goal)) {
      goal = pickUniqueGoal(usedGoals, hasActiveOffers, preferredGoals)
    }

    usedGoals.add(goal)
    goals.push(goal)
  }

  return goals
}

/**
 * 从备选列表中选取一个未使用过的替代目标
 */
function pickFallbackGoal(usedGoals: Set<ContentGoal>): ContentGoal {
  for (const goal of FALLBACK_GOALS) {
    if (!usedGoals.has(goal)) {
      return goal
    }
  }
  // 所有备选都用过了，使用 CUSTOMER_TESTIMONIAL 作为最后兜底
  return 'CUSTOMER_TESTIMONIAL'
}

/**
 * 选取一个尚未使用的唯一目标
 */
function pickUniqueGoal(
  usedGoals: Set<ContentGoal>,
  hasActiveOffers: boolean,
  preferredGoals?: ContentGoal[]
): ContentGoal {
  // 所有可用目标
  const allGoals: ContentGoal[] = [
    'TRAFFIC',
    'PROMOTION',
    'NEW_PRODUCT',
    'TRUST_BUILDING',
    'BRAND_STORY',
    'CUSTOMER_TESTIMONIAL',
    'WEEKEND_BOOST',
    'REPEAT_PURCHASE',
  ]

  // 如有用户偏好，优先使用
  if (preferredGoals) {
    for (const goal of preferredGoals) {
      if (!usedGoals.has(goal)) {
        if (!hasActiveOffers && GOALS_REQUIRING_PRODUCT.includes(goal)) {
          continue
        }
        return goal
      }
    }
  }

  // 从所有目标中选一个未使用的
  for (const goal of allGoals) {
    if (!usedGoals.has(goal)) {
      if (!hasActiveOffers && GOALS_REQUIRING_PRODUCT.includes(goal)) {
        continue
      }
      return goal
    }
  }

  // 极端情况：所有目标都已使用（天数 > 8 时可能发生），允许重复
  return 'BRAND_STORY'
}

// ========================
// 辅助函数
// ========================

/**
 * 从活跃商品列表中轮询选取一个 offer
 * 使用 dayIndex 取模实现轮询，避免所有天都用同一个 offer
 */
function pickOffer(
  offers: Array<{
    id: string
    storeId: string
    name: string
    description: string | null
    originalPrice: number | null
    salePrice: number | null
    sellingPoints: unknown
    usageRules: string | null
    isActive: boolean
  }>,
  dayIndex: number
) {
  if (offers.length === 0) return undefined
  return offers[dayIndex % offers.length]
}

/**
 * 日期格式化为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ========================
// 类型定义（Prisma 返回的运行时类型别名）
// ========================

/** ContentPlan 记录类型 */
export type ContentPlanRecord = {
  id: string
  storeId: string
  title: string
  startDate: Date
  endDate: Date
  strategy: unknown
  status: string
  createdAt: Date
  updatedAt: Date
}

/** ContentBrief 记录类型（含 ShotTasks） */
export type ContentBriefRecord = {
  id: string
  storeId: string
  contentPlanId: string | null
  playbookId: string | null
  title: string
  goal: string
  scheduledDate: Date
  status: string
  hook: string | null
  mainMessage: string | null
  offerId: string | null
  suggestedCaption: string | null
  suggestedTitle: string | null
  suggestedCoverTitle: string | null
  suggestedCta: string | null
  platformCopies: unknown
  tags: unknown
  aiReasoning: string | null
  createdAt: Date
  updatedAt: Date
  shotTasks: ShotTaskRecord[]
}

/** ShotTask 记录类型 */
export type ShotTaskRecord = {
  id: string
  contentBriefId: string
  order: number
  type: string
  title: string
  instruction: string
  examplePrompt: string | null
  durationSec: number
  required: boolean
  framingGuide: unknown
  qualityRules: unknown
  status: string
  createdAt: Date
  updatedAt: Date
}
