/**
 * 内容日历生成服务
 *
 * 基于门店画像、剧本库和每日目标分配规则，为门店生成 7 天内容计划。
 * 每天对应一条 ContentBrief + 关联的 ShotTasks，所有写操作在数据库事务中完成。
 *
 * 复盘反哺（需求 1.3, 1.7）：生成前读取未消费的 PlanGenerationInput（由
 * performance-learning-service.applyInsights 写入），将其 goal 偏好 / 复用权重 /
 * 规避名单注入本轮生成输入；命中后在计划上写入「已采纳上轮复盘建议:<摘要>」可见标注，
 * 并以原子条件更新把 consumedAt 置位恰一次（一次性消费，杜绝重复消费）。
 *
 * 计划可编辑（需求 6.1-6.5, 6.7）：在自动生成之外，提供 editContentBrief（改期/换 goal/
 * 换 playbook/删除）、addContentBrief（某天新增）、setDayLockState（锁定/跳过某天）三类
 * 纯写库操作（不消耗积分）。换 goal/playbook 时基于 StoreProfile 重实例化镜头脚本与文案草稿；
 * 单日 brief 数量上界默认 3（可由 StoreProfile.weeklyCadence 覆盖），超出显式拒绝；已拍素材
 * 保留不丢弃并返回 assetWarning；自动生成尊重 CalendarDayState 的 LOCKED/SKIPPED 决定。
 *
 * Requirements: 1.3, 1.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7
 */

import { prisma } from '@/lib/shared/db'
import { selectPlaybooks, instantiatePlaybookWithProvenance } from './playbook-engine'
import type { Playbook, PlaybookSegment } from './playbook-engine'
import { generatePerformanceInsights } from './performance-learning-service'
import { WEEKLY_GOAL_SCHEDULE } from '@/constants/merchant'
import type { ContentGoal, MerchantIndustry, ShotTaskType, ShotTaskDraft } from '@/types/merchant'
import type { Prisma } from '@/generated/prisma'

/**
 * 解析出的未消费复盘反哺输入（来自 PlanGenerationInput 的强类型快照）。
 * 仅在存在未消费记录且生成时成功抢占消费权时用于写入可见标注。
 */
interface ResolvedPlanInput {
  id: string
  acceptedNextGoals: ContentGoal[]
  reusePlaybookIds: string[]
  avoidPlaybookIds: string[]
  acceptedSummaries: string[]
}

/**
 * 把 Prisma Json 列安全解析为字符串数组；非数组或元素非字符串时返回空数组（不静默伪造内容）。
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 读取门店最新一条未消费的 PlanGenerationInput（按 createdAt 降序取最近一次采纳）。
 * 不存在时返回 null（本轮生成不带反哺标注）。
 */
async function loadUnconsumedPlanInput(storeId: string): Promise<ResolvedPlanInput | null> {
  const record = await prisma.planGenerationInput.findFirst({
    where: { storeId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  if (!record) return null

  return {
    id: record.id,
    // acceptedNextGoals 为 ContentGoal[]；按字符串数组解析后交由下游目标分配逻辑使用
    acceptedNextGoals: asStringArray(record.acceptedNextGoals) as ContentGoal[],
    reusePlaybookIds: asStringArray(record.reusePlaybookIds),
    avoidPlaybookIds: asStringArray(record.avoidPlaybookIds),
    acceptedSummaries: asStringArray(record.acceptedSummaries),
  }
}

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
 * 3.1 读取未消费的 PlanGenerationInput（复盘反哺，需求 1.3）：合并 goal 偏好/复用权重/规避名单
 * 4. 创建 ContentPlan 记录（命中反哺输入时写入「已采纳上轮复盘建议:<摘要>」标注，需求 1.7）
 * 5. 对每一天：根据 WEEKLY_GOAL_SCHEDULE 确定 goal → selectPlaybook → instantiatePlaybookWithProvenance → 创建 ContentBrief（含 provenance 溯源快照）+ ShotTasks
 * 6. 设置 ContentBrief.status = READY_TO_SHOOT；命中反哺输入时回填 ContentBrief.planInputId
 * 7. 以原子条件更新把 PlanGenerationInput.consumedAt 置位恰一次（一次性消费），并返回 contentPlan + briefs
 *
 * @param input.storeId 门店 ID
 * @param input.startDate 起始日期（默认明天）
 * @param input.days 天数（默认 7）
 * @param input.preferredGoals 用户偏好目标（可选）
 * @param input.contentPlanId 计费收敛（可选）：预生成的内容计划 id，由
 *   /content-plan/generate 路由在 RESERVE 时透传。提供时作为创建 ContentPlan 记录的 id，
 *   使 Worker 的 CHARGE / REFUND（task 8.1）与路由 RESERVE 共用同一
 *   (CONTENT_PLAN, contentPlanId) 关联键（幂等键）。未提供时由数据库自动生成 id（如
 *   画像 Worker 自动触发的 onboarding 路径，不计费）。
 */
export async function generateContentPlan(input: {
  storeId: string
  startDate: Date
  days: number
  preferredGoals?: ContentGoal[]
  contentPlanId?: string
}): Promise<{ contentPlan: ContentPlanRecord; briefs: ContentBriefRecord[] }> {
  const { storeId, startDate, days, preferredGoals, contentPlanId } = input

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

  // 3.1 读取未消费的复盘反哺输入（需求 1.3）：把上轮采纳建议的 goal 偏好/复用权重/规避名单
  //     合并进本轮生成输入。此处仅读取并参与候选筛选；consumedAt 的置位推迟到事务内原子完成，
  //     以保证「一次性消费」（需求 1.7 / Property 8）。
  const planInput = await loadUnconsumedPlanInput(storeId)

  // 合并规避名单：performance-learning 的 playbooksToAvoid ∪ 反哺输入的 avoidPlaybookIds（去重）
  if (planInput && planInput.avoidPlaybookIds.length > 0) {
    excludePlaybookIds = Array.from(new Set([...excludePlaybookIds, ...planInput.avoidPlaybookIds]))
  }

  // 复用权重名单：来自反哺输入的 reusePlaybookIds（在同 goal 候选中前置）
  const preferredPlaybookIds = planInput?.reusePlaybookIds ?? []

  // 计算每天的目标分配（Req 4.2, 4.5, 4.6）
  // goal 偏好优先级：调用方显式 preferredGoals > 反哺采纳的 acceptedNextGoals > performance-learning 推荐
  const effectivePreferredGoals =
    preferredGoals ??
    (planInput && planInput.acceptedNextGoals.length > 0 ? planInput.acceptedNextGoals : undefined) ??
    preferredGoalsFromLearning
  const dailyGoals = assignDailyGoals(startDate, days, hasActiveOffers, effectivePreferredGoals)

  // 计算结束日期
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + days - 1)

  // 选择剧本（通过 playbook-engine），传入复用权重名单使采纳的复用剧本优先选用
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
    preferredPlaybookIds,
  })

  // 3.3 读取计划区间内的锁定/跳过状态（需求 6.5 / Property 23）：
  //     自动生成尊重用户对某天的 LOCKED/SKIPPED 决定——不覆盖、不改写，且不在 SKIPPED 天填充内容。
  //     允许该天空缺（需求 6.7），不伪造内容补位。
  const lockRangeStart = utcDayStart(startDate)
  const lockRangeEnd = new Date(utcDayStart(endDate))
  lockRangeEnd.setUTCDate(lockRangeEnd.getUTCDate() + 1)
  const dayStates = await prisma.calendarDayState.findMany({
    where: { storeId, date: { gte: lockRangeStart, lt: lockRangeEnd } },
  })
  const blockedDayMs = new Set(
    dayStates
      .filter((s) => s.state === 'LOCKED' || s.state === 'SKIPPED')
      .map((s) => utcDayStart(s.date).getTime())
  )

  // 4-6. 在事务中创建 ContentPlan + ContentBrief + ShotTasks
  const result = await prisma.$transaction(async (tx) => {
    // 3.2 原子化抢占消费权（需求 1.7 / Property 8：一次性消费）：
    //     仅当该 PlanGenerationInput 仍未被消费（consumedAt = null）时，本次生成才置位 consumedAt
    //     并成为唯一消费者。条件更新依赖数据库行级写锁，并发生成下至多一方 count===1。
    //     consumed 为 true 时本计划写入「已采纳上轮复盘建议」标注并回填 brief.planInputId；
    //     为 false（被其它并发生成抢占）时本计划不带反哺标注，避免重复消费可见化。
    let adoptedPlanInputId: string | null = null
    let adoptedSummaries: string[] = []
    if (planInput) {
      const claimed = await tx.planGenerationInput.updateMany({
        where: { id: planInput.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      if (claimed.count === 1) {
        adoptedPlanInputId = planInput.id
        adoptedSummaries = planInput.acceptedSummaries
      }
    }

    // 反哺可见标注（需求 1.7）：命中消费且存在采纳摘要时生成「已采纳上轮复盘建议:<摘要>」
    const adoptedInsightNote =
      adoptedPlanInputId && adoptedSummaries.length > 0
        ? `已采纳上轮复盘建议:${adoptedSummaries.join('；')}`
        : null

    // 4. 创建 ContentPlan 记录
    //    若调用方透传了预生成的 contentPlanId（计费收敛 RESERVE 关联键），则复用为记录 id，
    //    使 Worker 的 CHARGE / REFUND 与路由 RESERVE 共用同一 (CONTENT_PLAN, id) 幂等键；
    //    未透传时由数据库自动生成 id。
    const contentPlan = await tx.contentPlan.create({
      data: {
        ...(contentPlanId ? { id: contentPlanId } : {}),
        storeId,
        title: `${store.name} ${formatDate(startDate)} ~ ${formatDate(endDate)} 内容计划`,
        startDate,
        endDate,
        strategy: {
          dailyGoals,
          hasActiveOffers,
          playbookCount: playbooks.length,
          preferredGoals: preferredGoals ?? null,
          // 复盘反哺标注（需求 1.7）：可见地记录本计划采纳的上轮建议来源与摘要
          planInputId: adoptedPlanInputId,
          adoptedSummaries,
          adoptedInsightNote,
        },
        status: 'ACTIVE',
      },
    })

    // 5. 对每一天：实例化剧本 → 创建 ContentBrief + ShotTasks
    const briefs: ContentBriefRecord[] = []

    for (let i = 0; i < days; i++) {
      const scheduledDate = new Date(startDate)
      scheduledDate.setDate(scheduledDate.getDate() + i)

      // 尊重锁定/跳过（需求 6.5 / Property 23）：该天被用户 LOCKED/SKIPPED 时不自动生成，
      // 允许空缺（需求 6.7），不覆盖用户决定、不填充伪内容。
      if (blockedDayMs.has(utcDayStart(scheduledDate).getTime())) {
        continue
      }

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

      // 实例化剧本为 ContentBriefDraft，同时获取画像引用溯源（生成时快照，需求 5.1, 5.2, 5.6）
      const { draft, provenance } = await instantiatePlaybookWithProvenance({
        playbook,
        store: {
          id: store.id,
          name: store.name,
          industry: store.industry as Parameters<typeof instantiatePlaybookWithProvenance>[0]['store']['industry'],
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
          // 命中复盘反哺消费时回填关联（需求 1.7），未命中为 null
          planInputId: adoptedPlanInputId,
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
          platformCopies: draft.platformCopies as unknown as Prisma.InputJsonValue,
          tags: draft.tags,
          aiReasoning: draft.aiReasoning,
          // 生成时画像引用溯源快照（需求 5.1, 5.2, 5.6）；不回溯改写（需求 5.4）
          provenance: provenance as unknown as Prisma.InputJsonValue,
          // 创建关联的 ShotTasks
          shotTasks: {
            create: shotTasks.map((st) => ({
              order: st.order,
              type: st.type,
              title: st.title,
              instruction: st.instruction,
              durationSec: st.durationSec,
              required: st.required,
              framingGuide: (st.framingGuide ?? undefined) as Prisma.InputJsonValue | undefined,
              qualityRules: (st.qualityRules ?? undefined) as Prisma.InputJsonValue | undefined,
              status: 'PENDING' as const,
            })),
          },
        },
        include: {
          shotTasks: true,
        },
      })

      briefs.push(brief as unknown as ContentBriefRecord)
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
  planInputId: string | null
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

// ========================
// 需求 6：内容计划可编辑（编辑/新增 brief + 锁定跳过）
// ========================

/** 单日 brief 数量默认上界（需求 6.2）；可由 StoreProfile.weeklyCadence 对应日的 count 覆盖 */
const DEFAULT_DAILY_BRIEF_LIMIT = 3

/** 重实例化失败兜底镜头（与 generateContentPlan 保持一致：至少保留 1 个 shotTask） */
const FALLBACK_SHOT_TASK: ShotTaskDraft = {
  order: 1,
  type: 'PRODUCT_CLOSEUP',
  title: '拍产品特写',
  instruction: '把手机靠近产品，拍清楚产品的样子',
  durationSec: 5,
  required: true,
}

/**
 * 把任意 Date 归一化为该日的 UTC 零点，用于按「自然日」分组/比较与 CalendarDayState 唯一键对齐。
 * 采用 UTC 口径保证确定性（不受运行环境时区影响）。
 */
function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** 校验日期合法，非法时显式抛错（不静默放过） */
function assertValidDate(date: Date | undefined, label: string): asserts date is Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error(`[content-calendar-service] ${label} 不是合法日期`)
  }
}

/**
 * 解析某一天的 brief 数量上界（需求 6.2）。
 * 默认 3；若 StoreProfile.weeklyCadence 中存在与该天 ISO 星期（1=周一..7=周日）匹配且 count 合法
 * （非负有限数）的配置项，则以其 count 覆盖默认值。
 */
function resolveDayUpperBound(weeklyCadence: unknown, date: Date): number {
  if (!Array.isArray(weeklyCadence)) return DEFAULT_DAILY_BRIEF_LIMIT

  const jsDay = date.getUTCDay() // 0=周日..6=周六
  const isoDay = jsDay === 0 ? 7 : jsDay // 转 ISO：1=周一..7=周日

  for (const entry of weeklyCadence) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const day = record.day
      const count = record.count
      if (
        typeof day === 'number' &&
        day === isoDay &&
        typeof count === 'number' &&
        Number.isFinite(count) &&
        count >= 0
      ) {
        return count
      }
    }
  }

  return DEFAULT_DAILY_BRIEF_LIMIT
}

/**
 * 校验目标日在单日上界之内（需求 6.2）；达到/超过上界时显式拒绝并抛错，事务内调用可保证该天
 * brief 集合保持不变（Property 20）。excludeBriefId 用于改期场景排除被移动的 brief 自身。
 */
async function assertDayCapacity(
  tx: Prisma.TransactionClient,
  storeId: string,
  weeklyCadence: unknown,
  date: Date,
  excludeBriefId?: string
): Promise<void> {
  const upperBound = resolveDayUpperBound(weeklyCadence, date)
  const start = utcDayStart(date)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  const count = await tx.contentBrief.count({
    where: {
      storeId,
      scheduledDate: { gte: start, lt: end },
      ...(excludeBriefId ? { id: { not: excludeBriefId } } : {}),
    },
  })

  if (count >= upperBound) {
    throw new Error(
      `[content-calendar-service] ${formatDate(date)} 当日内容已达上限 ${upperBound} 条，无法新增或改期到该天（需求 6.2）`
    )
  }
}

/** 门店上下文（门店 + 画像 + 活跃优惠），重实例化/新增 brief 共用 */
type StoreContext = NonNullable<Awaited<ReturnType<typeof loadStoreContext>>>

/**
 * 加载门店 + 画像 + 活跃优惠，并做画像完整性校验（无画像/内容定位为空时显式抛错，不静默降级）。
 */
async function loadStoreContext(storeId: string) {
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
  if (!store.profile) {
    throw new Error(
      `[content-calendar-service] 门店画像未完成，请先生成画像 (storeId: ${storeId})`
    )
  }
  if (!store.profile.contentPositioning) {
    throw new Error(
      `[content-calendar-service] 门店画像内容定位为空，请先完善画像 (storeId: ${storeId})`
    )
  }

  return store
}

/** 把 StoreContext.store 映射为 playbook-engine 所需的 Store 形状 */
function toEngineStore(store: StoreContext) {
  return {
    id: store.id,
    name: store.name,
    industry: store.industry as MerchantIndustry,
    city: store.city,
    district: store.district,
    businessArea: store.businessArea,
    address: store.address,
    mainProducts: store.mainProducts as string[],
    mainSellingPoints: store.mainSellingPoints as string[],
    canShootKitchen: store.canShootKitchen,
    canShootStaff: store.canShootStaff,
    canShootCustomers: store.canShootCustomers,
  }
}

/** 把门店画像映射为 playbook-engine 所需的 StoreProfile 形状 */
function toEngineProfile(profile: NonNullable<StoreContext['profile']>) {
  return {
    id: profile.id,
    storeId: profile.storeId,
    contentPositioning: profile.contentPositioning,
    recommendedPersona: profile.recommendedPersona,
    hookKeywords: profile.hookKeywords as string[] | null,
    forbiddenClaims: profile.forbiddenClaims as string[] | null,
    preferredCta: profile.preferredCta as string[] | null,
    contentDos: profile.contentDos as string[] | null,
    contentDonts: profile.contentDonts as string[] | null,
  }
}

/** 把活跃优惠映射为 playbook-engine 所需的 ProductOffer 形状 */
function toEngineOffer(offer: StoreContext['offers'][number]) {
  return {
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
}

/**
 * 把 Prisma 原始 Playbook 记录 cast 为类型安全的 Playbook（Json 列返回 unknown 需手动 cast）。
 * 仅用于 CHANGE_PLAYBOOK / addContentBrief 指定 playbookId 的场景。
 */
function castPlaybookRecord(raw: {
  id: string
  industry: string
  name: string
  goal: string
  description: string | null
  structure: unknown
  requiredShots: unknown
  optionalShots: unknown
  hookTemplates: unknown
  captionTemplates: unknown
  coverTitleTemplates: unknown
  ctaTemplates: unknown
  complianceRules: unknown
  scoreWeight: unknown
  tierRequired: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}): Playbook {
  return {
    id: raw.id,
    industry: raw.industry as MerchantIndustry,
    name: raw.name,
    goal: raw.goal as ContentGoal,
    description: raw.description,
    structure: (raw.structure ?? []) as PlaybookSegment[],
    requiredShots: (raw.requiredShots ?? []) as ShotTaskType[],
    optionalShots: (raw.optionalShots ?? null) as ShotTaskType[] | null,
    hookTemplates: (raw.hookTemplates ?? []) as string[],
    captionTemplates: (raw.captionTemplates ?? []) as string[],
    coverTitleTemplates: (raw.coverTitleTemplates ?? []) as string[],
    ctaTemplates: (raw.ctaTemplates ?? []) as string[],
    complianceRules: (raw.complianceRules ?? null) as Record<string, unknown> | null,
    scoreWeight: (raw.scoreWeight ?? null) as { views: number; conversion: number } | null,
    tierRequired: raw.tierRequired,
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

/** 按 playbookId 读取并 cast 剧本；不存在或已停用时显式抛错 */
async function loadPlaybookById(playbookId: string): Promise<Playbook> {
  const raw = await prisma.playbook.findUnique({ where: { id: playbookId } })
  if (!raw) {
    throw new Error(`[content-calendar-service] 剧本不存在: ${playbookId}`)
  }
  if (!raw.isActive) {
    throw new Error(`[content-calendar-service] 剧本已停用，无法使用: ${playbookId}`)
  }
  return castPlaybookRecord(raw)
}

/** 为指定 goal 选择一个剧本（复用 playbook-engine 的评分/连续使用规则），无可用剧本时抛错 */
async function selectPlaybookForGoal(store: StoreContext, goal: ContentGoal): Promise<Playbook> {
  const playbooks = await selectPlaybooks({
    industry: store.industry as MerchantIndustry,
    goals: [goal],
    storeProfile: toEngineProfile(store.profile!),
    offers: store.offers.map(toEngineOffer),
    days: 1,
  })
  const playbook = playbooks[0]
  if (!playbook) {
    throw new Error(`[content-calendar-service] 目标 ${goal} 无可用剧本，无法重实例化`)
  }
  return playbook
}

/**
 * 为某 goal 选取一个用于实例化的优惠：需要产品引用的 goal 优先沿用现有 offerId（若仍活跃），
 * 否则取第一个活跃优惠；不需要产品引用的 goal 返回 undefined。
 */
function pickOfferForGoal(
  store: StoreContext,
  goal: ContentGoal,
  currentOfferId?: string | null
): StoreContext['offers'][number] | undefined {
  if (!GOALS_REQUIRING_PRODUCT.includes(goal) || store.offers.length === 0) {
    return undefined
  }
  return store.offers.find((o) => o.id === currentOfferId) ?? store.offers[0]
}

/**
 * 基于门店画像重实例化剧本草稿（镜头脚本 + 文案草稿），返回 draft + provenance 溯源快照。
 * 纯本地规则 + 模板（含 LLM 润色，复用既有实例化链路），不消耗积分。
 */
async function reinstantiateDraft(input: {
  store: StoreContext
  playbook: Playbook
  offer?: StoreContext['offers'][number]
  scheduledDate: Date
}) {
  const { store, playbook, offer, scheduledDate } = input
  return instantiatePlaybookWithProvenance({
    playbook,
    store: toEngineStore(store),
    profile: toEngineProfile(store.profile!),
    offer: offer ? toEngineOffer(offer) : undefined,
    scheduledDate,
  })
}

/** 把 ShotTaskDraft[] 收敛到 1-5 条（与 generateContentPlan 一致），用于 Prisma nested create */
function buildShotTaskCreateData(shotTasks: ShotTaskDraft[]) {
  const limited = shotTasks.slice(0, 5)
  if (limited.length === 0) {
    limited.push(FALLBACK_SHOT_TASK)
  }
  return limited.map((st) => ({
    order: st.order,
    type: st.type,
    title: st.title,
    instruction: st.instruction,
    durationSec: st.durationSec,
    required: st.required,
    framingGuide: (st.framingGuide ?? undefined) as Prisma.InputJsonValue | undefined,
    qualityRules: (st.qualityRules ?? undefined) as Prisma.InputJsonValue | undefined,
    status: 'PENDING' as const,
  }))
}

/**
 * 编辑单条 brief（需求 6.1）：改期 / 换 goal / 换 playbook / 删除。
 *
 * - RESCHEDULE：校验新日期合法并受单日上界约束（需求 6.2），仅更新 scheduledDate，不重实例化。
 * - CHANGE_GOAL / CHANGE_PLAYBOOK：基于 StoreProfile 重实例化镜头脚本与文案草稿（需求 6.3，可反哺）；
 *   若该 brief 已有已拍素材（RawAsset），保留不丢弃并返回 assetWarning（需求 6.4），由商家决定是否重拍。
 * - DELETE：删除该 brief（级联删除 shotTasks；RawAsset 经 onDelete:SetNull 解除关联但保留素材行）。
 *
 * 纯写库，不消耗积分（重实例化为规则 + 模板 + 既有 LLM 润色链路，文案草稿本地生成）。
 *
 * @returns brief 删除时为 null；reinstantiated 标识是否发生了重实例化；assetWarning 仅在换选题且有已拍素材时返回。
 */
export async function editContentBrief(input: {
  briefId: string
  op: 'RESCHEDULE' | 'CHANGE_GOAL' | 'CHANGE_PLAYBOOK' | 'DELETE'
  payload: {
    newDate?: Date
    newGoal?: ContentGoal
    newPlaybookId?: string
  }
}): Promise<{ brief: ContentBriefRecord | null; reinstantiated: boolean; assetWarning?: string }> {
  const { briefId, op, payload } = input

  const existing = await prisma.contentBrief.findUnique({
    where: { id: briefId },
    select: { id: true, storeId: true, scheduledDate: true, offerId: true },
  })
  if (!existing) {
    throw new Error(`[content-calendar-service] 内容任务不存在: ${briefId}`)
  }

  // ---- DELETE：删除 brief，允许该天空缺（需求 6.7），不自动补位 ----
  if (op === 'DELETE') {
    await prisma.contentBrief.delete({ where: { id: briefId } })
    return { brief: null, reinstantiated: false }
  }

  // ---- RESCHEDULE：改期（需求 6.1, 6.2）----
  if (op === 'RESCHEDULE') {
    assertValidDate(payload.newDate, '改期目标日期')
    const newDate = payload.newDate

    const profile = await prisma.storeProfile.findUnique({
      where: { storeId: existing.storeId },
      select: { weeklyCadence: true },
    })

    const updated = await prisma.$transaction(async (tx) => {
      // 单日上界校验排除被移动的 brief 自身（需求 6.2 / Property 20）
      await assertDayCapacity(tx, existing.storeId, profile?.weeklyCadence, newDate, briefId)
      return tx.contentBrief.update({
        where: { id: briefId },
        data: { scheduledDate: newDate },
        include: { shotTasks: true },
      })
    })

    return { brief: updated, reinstantiated: false }
  }

  // ---- CHANGE_GOAL / CHANGE_PLAYBOOK：重实例化（需求 6.3, 6.4）----
  const store = await loadStoreContext(existing.storeId)

  // 确定新剧本与目标 goal
  let playbook: Playbook
  let goal: ContentGoal
  if (op === 'CHANGE_GOAL') {
    if (!payload.newGoal) {
      throw new Error('[content-calendar-service] 更换选题目标需提供 newGoal')
    }
    goal = payload.newGoal
    playbook = await selectPlaybookForGoal(store, goal)
  } else {
    // CHANGE_PLAYBOOK
    if (!payload.newPlaybookId) {
      throw new Error('[content-calendar-service] 更换剧本需提供 newPlaybookId')
    }
    playbook = await loadPlaybookById(payload.newPlaybookId)
    goal = playbook.goal // 换 playbook 时 goal 跟随新剧本
  }

  const offer = pickOfferForGoal(store, goal, existing.offerId)

  // 基于画像重实例化草稿（需求 6.3）；沿用 brief 原排期日期，不改期
  const { draft, provenance } = await reinstantiateDraft({
    store,
    playbook,
    offer,
    scheduledDate: existing.scheduledDate,
  })

  const result = await prisma.$transaction(async (tx) => {
    // 已拍素材检测（需求 6.4）：统计该 brief 下所有 shotTask 关联的 RawAsset 数量
    const assetCount = await tx.rawAsset.count({
      where: { shotTask: { contentBriefId: briefId } },
    })
    const assetWarning =
      assetCount > 0
        ? '选题已变更，原素材可能与新脚本不匹配，请确认是否重拍'
        : undefined

    // 删除旧 shotTasks；RawAsset.shotTaskId 经 onDelete:SetNull 置空，素材行保留不丢弃（需求 6.4 / Property 22）
    await tx.shotTask.deleteMany({ where: { contentBriefId: briefId } })

    const brief = await tx.contentBrief.update({
      where: { id: briefId },
      data: {
        goal,
        playbookId: playbook.id,
        offerId: offer?.id ?? null,
        title: draft.title,
        hook: draft.hook,
        mainMessage: draft.mainMessage,
        suggestedCaption: draft.suggestedCaption,
        suggestedTitle: draft.suggestedTitle,
        suggestedCoverTitle: draft.suggestedCoverTitle,
        suggestedCta: draft.suggestedCta,
        platformCopies: draft.platformCopies as unknown as Prisma.InputJsonValue,
        tags: draft.tags,
        aiReasoning: draft.aiReasoning,
        // 换选题为全新 AI 草稿，整体替换文案，故清除人工修改标记（需求 6.3 重实例化）
        copyEdited: false,
        // 重实例化时刷新画像引用溯源快照（基于当前画像，需求 5.1, 5.2）
        provenance: provenance as unknown as Prisma.InputJsonValue,
        shotTasks: {
          create: buildShotTaskCreateData(draft.shotTasks),
        },
      },
      include: { shotTasks: true },
    })

    return { brief: brief as unknown as ContentBriefRecord, assetWarning }
  })

  return { brief: result.brief, reinstantiated: true, assetWarning: result.assetWarning }
}

/**
 * 某天新增 brief（需求 6.1, 6.2）。
 * 基于 StoreProfile 实例化镜头脚本与文案草稿（含 provenance 溯源快照）；受单日上界约束，
 * 超出上界时显式拒绝（需求 6.2 / Property 20）。纯写库，不消耗积分。
 *
 * @param input.playbookId 可选；提供时使用指定剧本，否则按 goal 自动选择剧本。
 */
export async function addContentBrief(input: {
  storeId: string
  date: Date
  goal: ContentGoal
  playbookId?: string
}): Promise<ContentBriefRecord> {
  const { storeId, date, goal, playbookId } = input
  assertValidDate(date, '新增内容日期')

  const store = await loadStoreContext(storeId)

  // 确定剧本：显式指定则校验其 goal 与入参一致，否则按 goal 自动选择
  let playbook: Playbook
  if (playbookId) {
    playbook = await loadPlaybookById(playbookId)
    if (playbook.goal !== goal) {
      throw new Error(
        `[content-calendar-service] 指定剧本目标(${playbook.goal})与新增目标(${goal})不一致`
      )
    }
  } else {
    playbook = await selectPlaybookForGoal(store, goal)
  }

  const offer = pickOfferForGoal(store, goal)

  const { draft, provenance } = await reinstantiateDraft({
    store,
    playbook,
    offer,
    scheduledDate: date,
  })

  const brief = await prisma.$transaction(async (tx) => {
    // 单日上界校验（需求 6.2 / Property 20）：新增不排除任何 brief
    await assertDayCapacity(tx, storeId, store.profile!.weeklyCadence, date)

    return tx.contentBrief.create({
      data: {
        storeId,
        playbookId: playbook.id,
        title: draft.title,
        goal,
        scheduledDate: date,
        status: 'READY_TO_SHOOT',
        hook: draft.hook,
        mainMessage: draft.mainMessage,
        offerId: offer?.id ?? null,
        suggestedCaption: draft.suggestedCaption,
        suggestedTitle: draft.suggestedTitle,
        suggestedCoverTitle: draft.suggestedCoverTitle,
        suggestedCta: draft.suggestedCta,
        platformCopies: draft.platformCopies as unknown as Prisma.InputJsonValue,
        tags: draft.tags,
        aiReasoning: draft.aiReasoning,
        provenance: provenance as unknown as Prisma.InputJsonValue,
        shotTasks: {
          create: buildShotTaskCreateData(draft.shotTasks),
        },
      },
      include: { shotTasks: true },
    })
  })

  return brief as unknown as ContentBriefRecord
}

/**
 * 锁定 / 跳过 / 恢复某天（需求 6.5）。
 *
 * 写入 CalendarDayState（按 storeId + 自然日 UTC 零点为唯一键 upsert）。下一轮自动生成
 * （generateContentPlan）尊重 LOCKED/SKIPPED 状态：不覆盖、不改写，且不在 SKIPPED 天填充内容
 * （Property 23）。state=NORMAL 表示恢复为可自动生成。纯写库，不消耗积分。
 */
export async function setDayLockState(input: {
  storeId: string
  date: Date
  state: 'LOCKED' | 'SKIPPED' | 'NORMAL'
}): Promise<void> {
  const { storeId, date, state } = input
  assertValidDate(date, '锁定/跳过日期')

  // 归一化到 UTC 零点，与 generateContentPlan 的日比较口径及 @@unique([storeId, date]) 对齐
  const normalizedDate = utcDayStart(date)

  await prisma.calendarDayState.upsert({
    where: { storeId_date: { storeId, date: normalizedDate } },
    create: { storeId, date: normalizedDate, state },
    update: { state },
  })
}
