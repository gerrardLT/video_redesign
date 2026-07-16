/**
 * 留存激励服务（engagement-service）— 连续创作 / 里程碑 / 效果对比 / 进阶引导（需求 11 + 9.3）
 *
 * 职责：
 * 1. getStreak：基于 period-service 周期口径，统计「以当前周期为终点」的最大连续发布段
 *    （连续天数 currentDays + 连续周数 currentWeeks）。统计仅基于真实发布数据
 *    （PublishQueueItem.publishedPlatforms[].publishedAt 与 PublishMetric.capturedAt），
 *    无任何发布记录时返回 0，绝不伪造（需求 11.1, 11.5，Property 36）。
 * 2. checkMilestones：根据连续创作进度与「本周内容任务是否全部完成」判定已达成里程碑，
 *    返回当前成立的全部里程碑（当且仅当其达成条件成立，Property 37）；对「新达成」的里程碑
 *    写入一条门店作用域 StoreNotification(type=MILESTONE, actionHref=激励页)，使其在通知中心可见
 *    （需求 11.2，design「里程碑通知生产者」），并以 StreakRecord.milestones 持久化已达成集合实现去重。
 * 3. getGrowthComparison：基于真实历史展示「本月最佳 vs 上月最佳」（按播放量取真实最佳），
 *    任一侧历史不足时返回 available:false，不制造虚假成长感（需求 11.3，Property 38）。
 * 4. getOnboardingProgress：渐进式进阶引导任务，完成度由门店真实数据派生，前置未完成则锁定
 *    （需求 11.4）。
 *
 * 计费说明：本服务仅做纯数据库读 / 写与纯计算，不触发任何外部 AI 推理，不消耗积分。
 *
 * 周期口径：连续周数统一引用 period-service.resolvePeriods（以门店 StoreProfile.weeklyCadence
 * 定义的「内容周」为准，缺失时回退默认自然周），杜绝另立周期口径。
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 9.3
 * 备注：属性测试（15.2-15.4）、API（15.5）、前端（15.6）为独立任务，本服务仅提供服务层能力。
 */

import { prisma } from '@/lib/shared/db'
import { dispatchNotification } from '@/lib/shared/notification-dispatcher'
import { resolvePeriods, periodIndexOf } from './period-service'
import type { PublishedPlatformEntry } from './publish-queue-service'

// ========================
// 类型定义
// ========================

/** 连续创作统计结果（需求 11.1）—— 严格对应 design.md「11. engagement-service」getStreak 返回 */
export interface StreakResult {
  /** 以基准日为终点的最大连续发布「天数」 */
  days: number
  /** 以当前周期为终点的最大连续发布「周期数」 */
  weeks: number
}

/** 里程碑种类 */
export type MilestoneKind = 'STREAK_DAYS' | 'STREAK_WEEKS' | 'WEEK_COMPLETED'

/** 可见激励里程碑（需求 11.2）——徽章 / 进度 / 鼓励文案的服务层载体 */
export interface Milestone {
  /** 稳定标识（用于去重已达成里程碑），如 'streak_days_7'、'week_completed_2026-01-06' */
  id: string
  /** 里程碑种类 */
  kind: MilestoneKind
  /** 徽章 / 鼓励文案标题 */
  title: string
  /** 通俗鼓励描述 */
  description: string
  /** 达成时的实际值（连续天 / 周数；周完成里程碑为该周已完成任务数） */
  achievedValue: number
  /** 点击直达激励页路由 */
  actionHref: string
}

/** 效果对比中的单条最佳内容（需求 11.3）—— 按所选指标（播放量）取真实最佳 */
export interface BestContent {
  /** 内容任务 ID */
  briefId: string
  /** 内容标题 */
  title: string
  /** 所选对比指标（本服务固定为播放量） */
  metric: 'views'
  /** 该指标真实值（跨该 brief 全部 metrics 求和） */
  value: number
  /** 周期通俗标签：本月 / 上月 */
  periodLabel: string
}

/** 效果对比判别联合类型（需求 11.3，Property 38） */
export type GrowthComparison =
  | { available: false }
  | { available: true; thisBest: BestContent; lastBest: BestContent; evidence: string }

/** 进阶引导任务（需求 11.4）—— 渐进式逐步解锁更深功能 */
export interface OnboardingTask {
  /** 稳定标识 */
  id: string
  /** 任务序号（从 1 开始，决定解锁顺序） */
  order: number
  /** 任务标题 */
  title: string
  /** 通俗描述 */
  description: string
  /** 是否已完成（由门店真实数据派生） */
  completed: boolean
  /** 是否锁定（前置任务未全部完成则锁定，渐进式） */
  locked: boolean
  /** 点击直达对应可操作页面路由 */
  actionHref: string
}

// ========================
// 常量
// ========================

/** 连续「天数」里程碑阈值（达到即获得对应徽章） */
const STREAK_DAY_THRESHOLDS = [3, 7, 14, 30]

/** 连续「周数」里程碑阈值 */
const STREAK_WEEK_THRESHOLDS = [2, 4, 8, 12]

/**
 * 视为「内容任务已完成」的 ContentBrief 状态集合（用于「完成某周全部内容任务」里程碑判定）。
 * 取内容已产出成片或已发布 / 已归档的终态：导出 / 发布 / 归档；FAILED 等非终态不计为完成。
 */
const DONE_BRIEF_STATUSES = ['EXPORTED', 'PUBLISHED', 'ARCHIVED'] as const

// ========================
// 路由辅助
// ========================

/** 激励页路由（里程碑通知与进阶引导直达） */
function growthHref(storeId: string): string {
  return `/merchant/stores/${storeId}/growth`
}

// ========================
// 纯日期 / 周期工具
// ========================

/** 返回某日期所在本地自然日的 00:00（清零时分秒毫秒），作为「发布日」归一化键 */
function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/** 在给定本地 00:00 基础上偏移若干天（自动处理跨月 / 跨年 / 夏令时） */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0)
}

/** 格式化为 YYYY-MM-DD（用于周完成里程碑的稳定标识） */
function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ========================
// 连续创作计算（纯函数，便于属性测试）
// ========================

/**
 * 计算「以当前周期为终点」的最大连续发布段（需求 11.1，Property 36）。
 *
 * - days：将发布日期归一化为本地自然日去重后，从基准日（referenceDate 当日）向过去逐日回溯，
 *   统计无间断的连续发布天数；基准日当日无发布则为 0。
 * - weeks：按 period-service 周期口径将发布日期归入各内容周期，从当前周期（index 0）向过去
 *   逐周期回溯，统计无间断的连续「含真实发布」周期数；当前周期无发布则为 0。
 *
 * 仅基于传入的真实发布日期集合计算，空集合返回 { days:0, weeks:0 }，不伪造。
 *
 * @param input.publishDates 真实发布日期集合（未归一化，允许重复 / 乱序）
 * @param input.weeklyCadence 门店 StoreProfile.weeklyCadence（容错 unknown，缺失回退默认自然周）
 * @param input.referenceDate 基准日（决定「当前周期」与连续天数终点）
 */
export function computeStreak(input: {
  publishDates: Date[]
  weeklyCadence: unknown
  referenceDate: Date
}): StreakResult {
  const { publishDates, weeklyCadence, referenceDate } = input

  if (publishDates.length === 0) {
    return { days: 0, weeks: 0 }
  }

  // 归一化为本地自然日去重，并记录最早发布日（用于决定周期回溯跨度）
  const dayKeys = new Set<number>()
  let earliestMs = Number.POSITIVE_INFINITY
  for (const d of publishDates) {
    const ms = localMidnight(d).getTime()
    dayKeys.add(ms)
    if (ms < earliestMs) earliestMs = ms
  }

  // ─── 连续天数：以基准日为终点向过去逐日回溯，遇缺失即止 ───
  const refMid = localMidnight(referenceDate)
  let days = 0
  let dayCursor = refMid
  while (dayKeys.has(dayCursor.getTime())) {
    days++
    dayCursor = addDays(dayCursor, -1)
  }

  // ─── 连续周数：以当前周期为终点向过去逐周期回溯，遇缺失即止 ───
  // 回溯周期数需覆盖最早发布日至基准日的跨度，并留出缓冲。
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksSpan = Math.max(1, Math.ceil((refMid.getTime() - earliestMs) / msPerWeek) + 2)
  const ranges = resolvePeriods({ weeklyCadence, referenceDate, count: weeksSpan })

  // 标记「含真实发布」的周期序号（落在回溯范围外或未来的发布不计入）
  const activeIndices = new Set<number>()
  for (const d of publishDates) {
    const idx = periodIndexOf(localMidnight(d), ranges)
    if (idx !== null) activeIndices.add(idx)
  }

  let weeks = 0
  let weekCursor = 0
  while (activeIndices.has(weekCursor)) {
    weeks++
    weekCursor--
  }

  return { days, weeks }
}

// ========================
// 真实发布数据采集
// ========================

/**
 * 采集门店的真实发布日期集合（需求 11.5：仅真实发布数据，不伪造）。
 *
 * 数据来源（二者并集）：
 * - PublishQueueItem.publishedPlatforms[].publishedAt：商家手动标记已发布的真实发布时间；
 * - PublishMetric.capturedAt：存在发布数据即代表内容已真实发布，以数据采集日作为发布活动日。
 *
 * @param storeId 门店 ID
 * @returns 未归一化的真实发布日期数组（允许重复 / 乱序，由 computeStreak 归一化）
 */
async function collectPublishDates(storeId: string): Promise<Date[]> {
  const dates: Date[] = []

  // 来源一：待发布清单中已标记发布的平台记录
  const queueItems = await prisma.publishQueueItem.findMany({
    where: { storeId },
    select: { publishedPlatforms: true },
  })
  for (const item of queueItems) {
    const entries: PublishedPlatformEntry[] = Array.isArray(item.publishedPlatforms)
      ? (item.publishedPlatforms as unknown as PublishedPlatformEntry[])
      : []
    for (const e of entries) {
      const t = new Date(e.publishedAt)
      if (!Number.isNaN(t.getTime())) dates.push(t)
    }
  }

  // 来源二：发布数据指标（存在即代表内容已真实发布）
  const metrics = await prisma.publishMetric.findMany({
    where: { contentBrief: { storeId } },
    select: { capturedAt: true },
  })
  for (const m of metrics) {
    dates.push(m.capturedAt)
  }

  return dates
}

// ========================
// 1. 连续创作统计
// ========================

/**
 * 连续创作统计（需求 11.1, 11.5，Property 36）。
 *
 * 读取门店真实发布数据与 weeklyCadence，基于 period-service 周期口径计算「以当前周期为终点」
 * 的最大连续发布段（天 / 周）。纯读库 + 纯计算，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function getStreak(input: { storeId: string }): Promise<StreakResult> {
  const { storeId } = input

  const profile = await prisma.storeProfile.findUnique({
    where: { storeId },
    select: { weeklyCadence: true },
  })

  const publishDates = await collectPublishDates(storeId)

  return computeStreak({
    publishDates,
    weeklyCadence: profile?.weeklyCadence ?? null,
    referenceDate: new Date(),
  })
}

// ========================
// 2. 里程碑检测
// ========================

/** 构造连续天数里程碑 */
function buildStreakDaysMilestone(threshold: number, days: number, storeId: string): Milestone {
  return {
    id: `streak_days_${threshold}`,
    kind: 'STREAK_DAYS',
    title: `连续创作 ${threshold} 天`,
    description: `你已连续发布内容 ${days} 天，坚持就是胜利，继续保持！`,
    achievedValue: days,
    actionHref: growthHref(storeId),
  }
}

/** 构造连续周数里程碑 */
function buildStreakWeeksMilestone(threshold: number, weeks: number, storeId: string): Milestone {
  return {
    id: `streak_weeks_${threshold}`,
    kind: 'STREAK_WEEKS',
    title: `连续创作 ${threshold} 周`,
    description: `你已连续 ${weeks} 周稳定产出内容，节奏越来越稳了！`,
    achievedValue: weeks,
    actionHref: growthHref(storeId),
  }
}

/** 构造「完成某周全部内容任务」里程碑（按周期起始日生成稳定标识，每周仅奖励一次） */
function buildWeekCompletedMilestone(periodStart: Date, doneCount: number, storeId: string): Milestone {
  return {
    id: `week_completed_${dateKey(periodStart)}`,
    kind: 'WEEK_COMPLETED',
    title: '本周任务全部完成',
    description: `太棒了，本周 ${doneCount} 条内容任务已全部完成！`,
    achievedValue: doneCount,
    actionHref: growthHref(storeId),
  }
}

/**
 * 里程碑检测（需求 11.2，Property 37）。
 *
 * 返回「当前成立」的全部里程碑（当且仅当其达成条件成立）：
 * - 连续天数 / 周数里程碑：连续创作达到对应阈值即成立；
 * - 周完成里程碑：当前周期内有内容任务且全部处于完成终态时成立。
 *
 * 副作用（design「里程碑通知生产者」）：对比 StreakRecord.milestones 已达成集合，
 * 仅对「新达成」的里程碑写入一条门店作用域 StoreNotification(type=MILESTONE,
 * actionHref=激励页)，并把连续天/周、最近活跃日、已达成里程碑集合持久化到 StreakRecord
 * （去重保证每个里程碑只产生一次通知）。纯读写库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function checkMilestones(input: { storeId: string }): Promise<Milestone[]> {
  const { storeId } = input

  // ─── Step 1: 读取真实数据并计算连续创作进度 ───
  const profile = await prisma.storeProfile.findUnique({
    where: { storeId },
    select: { weeklyCadence: true },
  })
  const weeklyCadence = profile?.weeklyCadence ?? null
  const publishDates = await collectPublishDates(storeId)
  const now = new Date()
  const streak = computeStreak({ publishDates, weeklyCadence, referenceDate: now })

  // ─── Step 2: 判定「当前周期是否全部内容任务完成」───
  const [currentPeriod] = resolvePeriods({ weeklyCadence, referenceDate: now, count: 1 })
  let weekCompleted = false
  let weekDoneCount = 0
  if (currentPeriod) {
    const weekBriefs = await prisma.contentBrief.findMany({
      where: {
        storeId,
        scheduledDate: { gte: currentPeriod.startDate, lt: currentPeriod.endDate },
      },
      select: { status: true },
    })
    if (weekBriefs.length > 0) {
      const doneStatuses: readonly string[] = DONE_BRIEF_STATUSES
      weekDoneCount = weekBriefs.filter((b) => doneStatuses.includes(b.status)).length
      weekCompleted = weekDoneCount === weekBriefs.length
    }
  }

  // ─── Step 3: 汇总当前成立的里程碑 ───
  const milestones: Milestone[] = []
  for (const t of STREAK_DAY_THRESHOLDS) {
    if (streak.days >= t) milestones.push(buildStreakDaysMilestone(t, streak.days, storeId))
  }
  for (const t of STREAK_WEEK_THRESHOLDS) {
    if (streak.weeks >= t) milestones.push(buildStreakWeeksMilestone(t, streak.weeks, storeId))
  }
  if (weekCompleted && currentPeriod) {
    milestones.push(buildWeekCompletedMilestone(currentPeriod.startDate, weekDoneCount, storeId))
  }

  // ─── Step 4: 与已达成集合比对，仅为新达成者写通知 ───
  const existing = await prisma.streakRecord.findUnique({ where: { storeId } })
  const awardedSet = new Set<string>(
    existing && Array.isArray(existing.milestones)
      ? (existing.milestones as unknown as string[])
      : [],
  )

  for (const m of milestones) {
    if (!awardedSet.has(m.id)) {
      await dispatchNotification(
        { type: 'store', storeId },
        {
          type: 'MILESTONE',
          title: m.title,
          body: m.description,
          actionHref: m.actionHref,
        }
      )
      awardedSet.add(m.id)
    }
  }

  // ─── Step 5: 持久化 StreakRecord（连续天/周 + 最近活跃日 + 已达成集合）───
  const lastActiveDate =
    publishDates.length > 0
      ? new Date(Math.max(...publishDates.map((d) => d.getTime())))
      : null
  const milestoneIds = [...awardedSet]
  await prisma.streakRecord.upsert({
    where: { storeId },
    create: {
      storeId,
      currentDays: streak.days,
      currentWeeks: streak.weeks,
      lastActiveDate,
      milestones: milestoneIds as unknown as object[],
    },
    update: {
      currentDays: streak.days,
      currentWeeks: streak.weeks,
      lastActiveDate,
      milestones: milestoneIds as unknown as object[],
    },
  })

  return milestones
}

// ========================
// 3. 效果对比（本月最佳 vs 上月最佳）
// ========================

/** 含 metrics 的 brief 形态（仅取本服务所需字段） */
interface BriefWithMetrics {
  id: string
  title: string
  scheduledDate: Date
  metrics: { views: number }[]
}

/**
 * 在 [start, end) 排期窗口内，按播放量取真实最佳内容；窗口内无含数据内容时返回 null。
 */
function pickBest(
  briefs: BriefWithMetrics[],
  start: Date,
  end: Date,
  periodLabel: string,
): BestContent | null {
  let best: BestContent | null = null
  for (const brief of briefs) {
    const t = brief.scheduledDate.getTime()
    if (t < start.getTime() || t >= end.getTime()) continue
    const views = brief.metrics.reduce((sum, m) => sum + m.views, 0)
    if (best === null || views > best.value) {
      best = {
        briefId: brief.id,
        title: brief.title,
        metric: 'views',
        value: views,
        periodLabel,
      }
    }
  }
  return best
}

/**
 * 效果对比（需求 11.3，Property 38）。
 *
 * 基于真实历史，分别取本月、上月（按 brief 排期日归属自然月）播放量最高的内容作为最佳。
 * 任一侧无「含真实数据」的内容时返回 { available:false }，不制造虚假成长感。
 * 纯读库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function getGrowthComparison(input: { storeId: string }): Promise<GrowthComparison> {
  const { storeId } = input

  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)

  // 仅拉取上月与本月、且含 metrics 的 brief（按播放量取真实最佳）
  const briefs = await prisma.contentBrief.findMany({
    where: {
      storeId,
      metrics: { some: {} },
      scheduledDate: { gte: lastMonthStart, lt: nextMonthStart },
    },
    select: {
      id: true,
      title: true,
      scheduledDate: true,
      metrics: { select: { views: true } },
    },
  })

  const thisBest = pickBest(briefs, thisMonthStart, nextMonthStart, '本月')
  const lastBest = pickBest(briefs, lastMonthStart, thisMonthStart, '上月')

  // 任一侧历史不足，不伪造对比
  if (!thisBest || !lastBest) {
    return { available: false }
  }

  const delta = thisBest.value - lastBest.value
  const trend = delta > 0 ? `提升 ${delta}` : delta < 0 ? `下降 ${-delta}` : '持平'
  const evidence = `本月最佳《${thisBest.title}》播放 ${thisBest.value}，较上月最佳《${lastBest.title}》播放 ${lastBest.value}（${trend}）`

  return { available: true, thisBest, lastBest, evidence }
}

// ========================
// 4. 进阶引导（渐进式）
// ========================

/**
 * 新手进阶引导任务（需求 11.4）。
 *
 * 返回固定顺序的进阶任务，完成度全部由门店真实数据派生（不伪造）；采用渐进式解锁：
 * 仅当某任务之前的全部任务均已完成时该任务才解锁（locked=false），引导商家逐步深入。
 * 纯读库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function getOnboardingProgress(input: { storeId: string }): Promise<OnboardingTask[]> {
  const { storeId } = input

  // 并行采集各阶段真实完成信号
  const [profile, briefCount, rawAssetCount, queueItems, publishedBriefCount, metricCount] =
    await Promise.all([
      prisma.storeProfile.findUnique({ where: { storeId }, select: { status: true } }),
      prisma.contentBrief.count({ where: { storeId } }),
      prisma.rawAsset.count({ where: { storeId } }),
      prisma.publishQueueItem.findMany({
        where: { storeId },
        select: { publishedPlatforms: true },
      }),
      prisma.contentBrief.count({ where: { storeId, status: 'PUBLISHED' } }),
      prisma.publishMetric.count({ where: { contentBrief: { storeId } } }),
    ])

  // 是否已有任一内容标记发布到平台
  const hasMarkedPublished = queueItems.some((item) => {
    const entries: PublishedPlatformEntry[] = Array.isArray(item.publishedPlatforms)
      ? (item.publishedPlatforms as unknown as PublishedPlatformEntry[])
      : []
    return entries.length > 0
  })

  const hasProfile = profile?.status === 'COMPLETE'
  const hasPlan = briefCount > 0
  const hasShot = rawAssetCount > 0
  const hasExport = queueItems.length > 0
  const hasPublished = hasMarkedPublished || publishedBriefCount > 0
  const hasMetrics = metricCount > 0

  // 固定顺序的进阶任务定义（completed 由真实数据派生）
  const defs: Omit<OnboardingTask, 'locked'>[] = [
    {
      id: 'complete_profile',
      order: 1,
      title: '完善门店画像',
      description: '补全门店定位与卖点，让 AI 更懂你的生意',
      completed: hasProfile,
      actionHref: `/merchant/stores/${storeId}/settings`,
    },
    {
      id: 'generate_plan',
      order: 2,
      title: '生成内容计划',
      description: '一键生成本周内容安排，告别没灵感',
      completed: hasPlan,
      actionHref: `/merchant/stores/${storeId}/calendar`,
    },
    {
      id: 'first_shoot',
      order: 3,
      title: '完成首次拍摄',
      description: '按拍摄引导上传素材，迈出第一步',
      completed: hasShot,
      actionHref: `/merchant/stores/${storeId}/today`,
    },
    {
      id: 'first_export',
      order: 4,
      title: '导出首个成片',
      description: 'AI 帮你把素材合成可发布的视频',
      completed: hasExport,
      actionHref: `/merchant/stores/${storeId}/calendar`,
    },
    {
      id: 'first_publish',
      order: 5,
      title: '完成首次发布',
      description: '把成片发布到平台，并回来标记已发布',
      completed: hasPublished,
      actionHref: `/merchant/stores/${storeId}/calendar`,
    },
    {
      id: 'first_review',
      order: 6,
      title: '录入首条数据复盘',
      description: '回填播放与转化数据，解锁优化建议',
      completed: hasMetrics,
      actionHref: `/merchant/stores/${storeId}/calendar`,
    },
  ]

  // 渐进式解锁：仅当之前的全部任务均完成时，当前任务才解锁
  const tasks: OnboardingTask[] = []
  let prevAllCompleted = true
  for (const def of defs) {
    const locked = !prevAllCompleted
    tasks.push({ ...def, locked })
    prevAllCompleted = prevAllCompleted && def.completed
  }

  return tasks
}
