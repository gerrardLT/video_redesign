/**
 * 表现学习服务 — 基于发布数据生成优化建议
 *
 * 分析门店历史发布数据，通过规则引擎生成内容优化建议、推荐复用/避免的剧本、
 * 以及下一周期的推荐内容目标。
 *
 * 学习规则引擎逻辑：
 * - views TOP 30% + conversion BOTTOM 30% → 强化 CTA + 优惠表达
 * - saves/comments TOP 30% → 复用该 Playbook 结构
 * - 同一 Playbook 连续 3+ 低播放(< 50% avg) → 换钩子和封面风格
 * - linkClicks TOP 30% → 复用标题和优惠结构
 * - 数据不足 (< 3 条有 metrics) → 返回空建议
 *
 * Requirements: 12.1-12.7
 *
 * 本地生活深化改造（需求 1）扩充：在既有「只读」洞察之上补齐反馈控制回路所需的服务能力：
 * - getInsightsUnlockGate：复盘解锁门控，带 metrics 的 brief 数 <3 时返回 { unlocked:false, remaining:N }，不渲染建议、不伪造（需求 1.1, 1.6）
 * - applyInsights：将采纳的复盘建议固化为下一轮内容计划生成输入（写入 PlanGenerationInput，纯写库不消耗积分）（需求 1.3）
 * - getMetricTrend：按 date 升序返回门店各 brief 在指定指标上的时间序列，每个含该指标的 brief 恰出现一次（需求 1.4）
 * - getPeriodComparison：按 period-service 周期聚合关键指标，比较两个最近的已结束周期；已结束周期 <2 时返回 available:false，不伪造（需求 1.5）
 */

import { prisma } from '@/lib/shared/db'
import type { PlanGenerationInput } from '@/generated/prisma'
import type { PerformanceInsights, Suggestion, ContentGoal } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'
import { resolvePeriods, periodIndexOf, type PeriodRange } from './period-service'

/**
 * 复盘解锁门槛：门店需累计 ≥3 条带 metrics 的 ContentBrief 才解锁优化建议与复盘视图。
 * generatePerformanceInsights（数据不足返回空建议）与 getInsightsUnlockGate（门控）共用此阈值。
 */
const MIN_METRICS_BRIEFS = 3

/**
 * 指标趋势 / 跨周对比可用的指标键。
 * 除 conversion 为派生指标（linkClicks + orders + redemptions）外，其余均直接对应 PublishMetric 字段。
 */
export type TrendMetric =
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'linkClicks'
  | 'orders'
  | 'redemptions'
  | 'conversion'

/** 趋势序列中的单点：某条 brief 在指定指标上的聚合值 */
export interface MetricTrendPoint {
  /** 内容任务 ID */
  briefId: string
  /** 该 brief 的排期日期（趋势横轴） */
  date: Date
  /** 该 brief 在指定指标上的聚合值（跨该 brief 所有 metrics 求和） */
  value: number
}

/** 单个内容周期的关键指标聚合摘要（跨周对比用） */
export interface PeriodMetricSummary {
  /** 周期相对序号（0=本周，-1=上周…），由 period-service 提供 */
  periodIndex: number
  /** 周期通俗标签，如 "上周(1.6-1.12)" */
  label: string
  /** 周期开始（含） */
  startDate: Date
  /** 周期结束（不含） */
  endDate: Date
  /** 落入该周期的 brief 数量 */
  briefCount: number
  /** 关键指标聚合值（周期内所有 brief 的 metrics 求和，conversion 为派生） */
  metrics: Record<TrendMetric, number>
}

/**
 * 每个 ContentBrief 聚合后的表现数据
 */
interface BriefMetrics {
  contentBriefId: string
  playbookId: string | null
  goal: string
  hook: string | null
  scheduledDate: Date
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  linkClicks: number
  orders: number
  redemptions: number
  /** 转化指标 = linkClicks + orders + redemptions */
  conversion: number
}

/**
 * 生成表现学习分析洞察
 *
 * 从门店历史 PublishMetric 中提取规律，通过规则引擎生成优化建议。
 * 当有效数据不足 3 条时返回空建议（Req 12.7）。
 *
 * @param input.storeId - 门店 ID
 * @param input.contentBriefId - 可选，指定分析某个具体的内容任务
 * @returns 优化建议、推荐目标、复用/避免剧本列表
 */
export async function generatePerformanceInsights(input: {
  storeId: string
  contentBriefId?: string
}): Promise<PerformanceInsights> {
  const { storeId } = input

  // 查询该门店所有有 metrics 的 ContentBrief（通过 contentBrief.storeId 过滤）
  const briefsWithMetrics = await prisma.contentBrief.findMany({
    where: {
      storeId,
      metrics: { some: {} },
    },
    include: {
      metrics: true,
    },
    orderBy: { scheduledDate: 'asc' },
  })

  // Req 12.7: 数据不足 (< 3 条有 metrics) → 返回空建议
  if (briefsWithMetrics.length < MIN_METRICS_BRIEFS) {
    return {
      suggestions: [],
      recommendedNextGoals: [],
      playbooksToReuse: [],
      playbooksToAvoid: [],
    }
  }

  // 聚合每个 ContentBrief 的所有 metrics（可能有多平台/多次录入）
  const aggregatedMetrics: BriefMetrics[] = briefsWithMetrics.map((brief) => {
    const totals = brief.metrics.reduce(
      (acc, m) => ({
        views: acc.views + m.views,
        likes: acc.likes + m.likes,
        comments: acc.comments + m.comments,
        shares: acc.shares + m.shares,
        saves: acc.saves + m.saves,
        linkClicks: acc.linkClicks + m.linkClicks,
        orders: acc.orders + m.orders,
        redemptions: acc.redemptions + m.redemptions,
      }),
      { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, linkClicks: 0, orders: 0, redemptions: 0 }
    )

    return {
      contentBriefId: brief.id,
      playbookId: brief.playbookId,
      goal: brief.goal,
      hook: brief.hook,
      scheduledDate: brief.scheduledDate,
      ...totals,
      conversion: totals.linkClicks + totals.orders + totals.redemptions,
    }
  })

  // 计算门店历史平均值
  const avgViews = average(aggregatedMetrics.map((m) => m.views))

  // 计算 TOP 30%（70th 百分位）和 BOTTOM 30%（30th 百分位）阈值
  const viewsTop30 = percentile(aggregatedMetrics.map((m) => m.views), 70)
  const viewsBottom50Pct = avgViews * 0.5 // 低于平均值 50% 视为低播放
  const conversionBottom30 = percentile(aggregatedMetrics.map((m) => m.conversion), 30)
  const savesTop30 = percentile(aggregatedMetrics.map((m) => m.saves), 70)
  const commentsTop30 = percentile(aggregatedMetrics.map((m) => m.comments), 70)
  const linkClicksTop30 = percentile(aggregatedMetrics.map((m) => m.linkClicks), 70)

  const suggestions: Suggestion[] = []
  const playbooksToReuse = new Set<string>()
  const playbooksToAvoid = new Set<string>()

  // 规则 1: views TOP 30% + conversion BOTTOM 30% → CTA 建议
  for (const m of aggregatedMetrics) {
    if (m.views >= viewsTop30 && m.conversion <= conversionBottom30) {
      suggestions.push({
        category: 'CTA',
        action: '下次强化 CTA 表达和优惠信息展示，使用更直接的行动引导',
        evidence: `内容「${briefLabel(m)}」播放量 ${m.views} 属于 TOP 30%，但转化(点击+下单+核销)仅 ${m.conversion} 属于 BOTTOM 30%`,
      })
      break // 同一规则只产生一条建议
    }
  }

  // 规则 2: saves/comments TOP 30% → structure 建议，复用 Playbook
  for (const m of aggregatedMetrics) {
    if (m.saves >= savesTop30 || m.comments >= commentsTop30) {
      if (m.playbookId) {
        playbooksToReuse.add(m.playbookId)
      }
      if (!suggestions.some((s) => s.category === 'structure')) {
        suggestions.push({
          category: 'structure',
          action: '复用该内容的 Playbook 结构和叙事节奏',
          evidence: `内容「${briefLabel(m)}」收藏 ${m.saves}、评论 ${m.comments} 均属 TOP 30%（阈值: 收藏≥${savesTop30}, 评论≥${commentsTop30}）`,
        })
      }
    }
  }

  // 规则 3: 同一 Playbook 连续 3+ 低播放(< 50% avg) → hook 建议
  const consecutiveLowByPlaybook = findConsecutiveLowViews(aggregatedMetrics, viewsBottom50Pct)
  for (const [playbookId, count] of consecutiveLowByPlaybook) {
    if (count >= 3 && playbookId) {
      playbooksToAvoid.add(playbookId)
      if (!suggestions.some((s) => s.category === 'hook')) {
        suggestions.push({
          category: 'hook',
          action: '更换钩子文案和封面风格，当前使用的 Playbook 连续表现不佳',
          evidence: `Playbook(${playbookId}) 连续 ${count} 次播放量低于平均值 50%（平均播放 ${Math.round(avgViews)}，阈值 ${Math.round(viewsBottom50Pct)}）`,
        })
      }
    }
  }

  // 规则 4: linkClicks TOP 30% → offer 建议，复用标题和优惠结构
  for (const m of aggregatedMetrics) {
    if (m.linkClicks >= linkClicksTop30) {
      if (m.playbookId) {
        playbooksToReuse.add(m.playbookId)
      }
      if (!suggestions.some((s) => s.category === 'offer')) {
        suggestions.push({
          category: 'offer',
          action: '复用该内容的标题和优惠结构，链接点击表现优秀',
          evidence: `内容「${briefLabel(m)}」链接点击 ${m.linkClicks} 属于 TOP 30%（阈值≥${linkClicksTop30}）`,
        })
      }
      break
    }
  }

  // 限制建议数量为 1-5 条
  const finalSuggestions = suggestions.slice(0, 5)

  // 推荐下周期目标（Req 12.4: 需 ≥3 条有 metrics 的数据）
  const recommendedNextGoals = generateRecommendedGoals(aggregatedMetrics)

  return {
    suggestions: finalSuggestions,
    recommendedNextGoals,
    playbooksToReuse: [...playbooksToReuse],
    playbooksToAvoid: [...playbooksToAvoid],
  }
}

// ========================
// 内部工具函数
// ========================

/**
 * 计算数值数组平均值
 */
function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * 计算指定百分位数值（线性插值法）
 * @param values - 数值数组
 * @param p - 百分位数 (0-100)
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const weight = index - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

/**
 * 查找同一 Playbook 连续低播放的最大连续次数
 * @returns Map<playbookId, maxConsecutiveLowCount>
 */
function findConsecutiveLowViews(
  metrics: BriefMetrics[],
  lowThreshold: number
): Map<string, number> {
  const result = new Map<string, number>()

  // 按时间排序后遍历，跟踪每个 playbook 的连续低播放计数
  const sorted = [...metrics].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()
  )

  // 按 playbookId 分组（保持时间顺序）
  const byPlaybook = new Map<string, BriefMetrics[]>()
  for (const m of sorted) {
    if (!m.playbookId) continue
    const list = byPlaybook.get(m.playbookId) ?? []
    list.push(m)
    byPlaybook.set(m.playbookId, list)
  }

  for (const [playbookId, items] of byPlaybook) {
    let maxConsecutive = 0
    let currentConsecutive = 0
    for (const item of items) {
      if (item.views < lowThreshold) {
        currentConsecutive++
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive)
      } else {
        currentConsecutive = 0
      }
    }
    if (maxConsecutive >= 3) {
      result.set(playbookId, maxConsecutive)
    }
  }

  return result
}

/**
 * 生成推荐的下一周期内容目标
 * 按各 ContentGoal 的历史转化率排名，返回 TOP 3
 */
function generateRecommendedGoals(metrics: BriefMetrics[]): ContentGoal[] {
  // 按 goal 分组统计转化表现
  const goalStats = new Map<string, { totalConversion: number; count: number }>()

  for (const m of metrics) {
    const existing = goalStats.get(m.goal) ?? { totalConversion: 0, count: 0 }
    existing.totalConversion += m.conversion
    existing.count++
    goalStats.set(m.goal, existing)
  }

  // 按平均转化率降序排列
  const ranked = [...goalStats.entries()]
    .map(([goal, stats]) => ({
      goal: goal as ContentGoal,
      avgConversion: stats.count > 0 ? stats.totalConversion / stats.count : 0,
    }))
    .sort((a, b) => b.avgConversion - a.avgConversion)

  // 返回 TOP 3
  return ranked.slice(0, 3).map((r) => r.goal)
}

/**
 * 生成 ContentBrief 简短标签（用于建议证据描述）
 */
function briefLabel(m: BriefMetrics): string {
  const dateStr = m.scheduledDate.toISOString().slice(0, 10)
  return `${dateStr}/${m.goal}`
}

// ========================
// 需求 1 扩充：解锁门控 / 应用建议 / 趋势 / 跨周对比
// ========================

/** PublishMetric 各指标字段的求和累加器 */
interface MetricTotals {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  linkClicks: number
  orders: number
  redemptions: number
}

/** 空累加器 */
function emptyTotals(): MetricTotals {
  return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, linkClicks: 0, orders: 0, redemptions: 0 }
}

/** 将一条 PublishMetric 的关键字段累加进累加器 */
function accumulate(acc: MetricTotals, m: {
  views: number; likes: number; comments: number; shares: number; saves: number
  linkClicks: number; orders: number; redemptions: number
}): MetricTotals {
  return {
    views: acc.views + m.views,
    likes: acc.likes + m.likes,
    comments: acc.comments + m.comments,
    shares: acc.shares + m.shares,
    saves: acc.saves + m.saves,
    linkClicks: acc.linkClicks + m.linkClicks,
    orders: acc.orders + m.orders,
    redemptions: acc.redemptions + m.redemptions,
  }
}

/** 从累加器中取出指定指标值（conversion 为派生指标） */
function extractMetricValue(totals: MetricTotals, metric: TrendMetric): number {
  if (metric === 'conversion') {
    return totals.linkClicks + totals.orders + totals.redemptions
  }
  return totals[metric]
}

/** 将累加器展开为含 conversion 的完整指标记录 */
function totalsToMetricRecord(totals: MetricTotals): Record<TrendMetric, number> {
  return {
    views: totals.views,
    likes: totals.likes,
    comments: totals.comments,
    shares: totals.shares,
    saves: totals.saves,
    linkClicks: totals.linkClicks,
    orders: totals.orders,
    redemptions: totals.redemptions,
    conversion: totals.linkClicks + totals.orders + totals.redemptions,
  }
}

/**
 * 复盘解锁门控（需求 1.1, 1.6）。
 *
 * 统计门店带 metrics 的 ContentBrief 数量：
 * - 不足 MIN_METRICS_BRIEFS（3）条时返回 { unlocked:false, remaining:N }，前端据此显式提示
 *   「再录入 N 条即可解锁优化建议」，不渲染建议、不伪造。
 * - 达标时返回 { unlocked:true, insights }，其中 insights 为既有规则引擎产出的完整洞察。
 *
 * 纯读库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function getInsightsUnlockGate(input: {
  storeId: string
}): Promise<
  | { unlocked: false; remaining: number }
  | { unlocked: true; insights: PerformanceInsights }
> {
  const { storeId } = input

  // 统计该门店带 metrics 的 brief 数量（与解锁阈值比较）
  const count = await prisma.contentBrief.count({
    where: { storeId, metrics: { some: {} } },
  })

  if (count < MIN_METRICS_BRIEFS) {
    return { unlocked: false, remaining: MIN_METRICS_BRIEFS - count }
  }

  const insights = await generatePerformanceInsights({ storeId })
  return { unlocked: true, insights }
}

/**
 * 将商家采纳的复盘建议固化为下一轮内容计划的生成输入（可反哺，需求 1.3）。
 *
 * 写入 PlanGenerationInput 新表，供 content-calendar-service 一次性消费（consumedAt 由消费方置位）。
 * 写入内容与采纳集合逐项一致（无丢失、无新增），数组按原序原样保存（Property 4）。
 * 纯写库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 * @param input.acceptedNextGoals 采纳的「推荐下周目标」（来自 recommendedNextGoals）
 * @param input.reusePlaybookIds 采纳复用的剧本 ID（来自 playbooksToReuse → 提升复用权重）
 * @param input.avoidPlaybookIds 采纳规避的剧本 ID（来自 playbooksToAvoid → 规避名单）
 * @param input.acceptedSuggestionSummaries 采纳建议摘要，用于计划上的「已采纳上轮复盘建议」标注
 */
export async function applyInsights(input: {
  storeId: string
  acceptedNextGoals?: ContentGoal[]
  reusePlaybookIds?: string[]
  avoidPlaybookIds?: string[]
  acceptedSuggestionSummaries: string[]
}): Promise<PlanGenerationInput> {
  const { storeId, acceptedNextGoals, reusePlaybookIds, avoidPlaybookIds, acceptedSuggestionSummaries } = input

  // 校验门店存在，避免写入指向不存在门店的孤儿输入（不静默吞错）
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })
  if (!store) {
    throw new ApiError('NOT_FOUND', `门店不存在: ${storeId}`, 404)
  }

  // acceptedSummaries 为必填 Json 列，无采纳摘要时存空数组（不允许 null）
  const created = await prisma.planGenerationInput.create({
    data: {
      storeId,
      // 未采纳的可选项写入 null（不伪造默认值）；采纳项原样保存
      acceptedNextGoals: acceptedNextGoals && acceptedNextGoals.length > 0 ? acceptedNextGoals : undefined,
      reusePlaybookIds: reusePlaybookIds && reusePlaybookIds.length > 0 ? reusePlaybookIds : undefined,
      avoidPlaybookIds: avoidPlaybookIds && avoidPlaybookIds.length > 0 ? avoidPlaybookIds : undefined,
      acceptedSummaries: acceptedSuggestionSummaries,
    },
  })

  return created
}

/**
 * 指标趋势查询（需求 1.4）。
 *
 * 返回门店所有带 metrics 的 brief 在指定指标上的时间序列：
 * - 每个含该指标的 brief 在序列中恰出现一次（跨该 brief 所有 metrics 记录求和）；
 * - 序列按 date（brief 排期日）升序排列，同日按 briefId 升序保证确定性（Property 5）。
 *
 * 纯读库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 * @param input.metric 指标键（views/likes/.../conversion）
 */
export async function getMetricTrend(input: {
  storeId: string
  metric: TrendMetric
}): Promise<MetricTrendPoint[]> {
  const { storeId, metric } = input

  const briefs = await prisma.contentBrief.findMany({
    where: { storeId, metrics: { some: {} } },
    include: { metrics: true },
  })

  const points: MetricTrendPoint[] = briefs.map((brief) => {
    const totals = brief.metrics.reduce((acc, m) => accumulate(acc, m), emptyTotals())
    return {
      briefId: brief.id,
      date: brief.scheduledDate,
      value: extractMetricValue(totals, metric),
    }
  })

  // 按日期升序；同日按 briefId 升序，保证序列确定且每个 brief 恰一次
  points.sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime()
    if (diff !== 0) return diff
    return a.briefId < b.briefId ? -1 : a.briefId > b.briefId ? 1 : 0
  })

  return points
}

/**
 * 跨周对比（需求 1.5）。
 *
 * 按 period-service 周期口径将门店带 metrics 的 brief 归入各内容周期，比较两个最近的
 * 「已结束且含数据」的内容周期（current = 较近，previous = 较早）：
 * - 每个 delta = 本周期聚合值 − 上周期聚合值；
 * - 已结束且含数据的周期 <2 时返回 { available:false }，不伪造对比（Property 6）。
 *
 * 「已结束」判定：周期右开边界 endDate <= 当前时间（当前进行中的周期不计入）。
 * 「含数据」判定：周期内至少落入一条带 metrics 的 brief（仅按日历窗口空转的历史周期不计）。
 *
 * 纯读库，不消耗积分。
 *
 * @param input.storeId 门店 ID
 */
export async function getPeriodComparison(input: {
  storeId: string
}): Promise<
  | { available: false; reason: string }
  | { available: true; current: PeriodMetricSummary; previous: PeriodMetricSummary; deltas: Record<string, number> }
> {
  const { storeId } = input

  // 读取门店画像的 weeklyCadence 作为周期口径输入（缺失时 period-service 回退默认自然周）
  const profile = await prisma.storeProfile.findUnique({
    where: { storeId },
    select: { weeklyCadence: true },
  })

  const briefs = await prisma.contentBrief.findMany({
    where: { storeId, metrics: { some: {} } },
    include: { metrics: true },
    orderBy: { scheduledDate: 'asc' },
  })

  if (briefs.length === 0) {
    return { available: false, reason: '暂无带数据的内容，无法进行跨周对比' }
  }

  const now = new Date()

  // 计算需回溯的周期数：覆盖最早一条 brief 至今的跨度，并留出缓冲
  const earliest = briefs[0]!.scheduledDate
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksSpan = Math.max(1, Math.ceil((now.getTime() - earliest.getTime()) / msPerWeek) + 2)

  const ranges: PeriodRange[] = resolvePeriods({
    weeklyCadence: profile?.weeklyCadence ?? null,
    referenceDate: now,
    count: weeksSpan,
  })

  // 按周期序号聚合各周期的指标累加器与 brief 数
  const totalsByPeriod = new Map<number, MetricTotals>()
  const briefCountByPeriod = new Map<number, number>()
  for (const brief of briefs) {
    const idx = periodIndexOf(brief.scheduledDate, ranges)
    if (idx === null) continue // 超出回溯范围或未来周期，不臆造归属
    const acc = totalsByPeriod.get(idx) ?? emptyTotals()
    const merged = brief.metrics.reduce((a, m) => accumulate(a, m), acc)
    totalsByPeriod.set(idx, merged)
    briefCountByPeriod.set(idx, (briefCountByPeriod.get(idx) ?? 0) + 1)
  }

  // 已结束（endDate <= now）且含数据的周期序号，按时间从近到远排序
  const endedRanges = ranges
    .filter((r) => r.endDate.getTime() <= now.getTime() && totalsByPeriod.has(r.index))
    .sort((a, b) => b.index - a.index)

  if (endedRanges.length < 2) {
    return { available: false, reason: '已结束的内容周期不足 2 个，暂无法进行跨周对比' }
  }

  const currentRange = endedRanges[0]!
  const previousRange = endedRanges[1]!

  const currentSummary = buildPeriodSummary(currentRange, totalsByPeriod, briefCountByPeriod)
  const previousSummary = buildPeriodSummary(previousRange, totalsByPeriod, briefCountByPeriod)

  // 逐指标计算增减：本周期 − 上周期
  const deltas: Record<string, number> = {}
  for (const key of Object.keys(currentSummary.metrics) as TrendMetric[]) {
    deltas[key] = currentSummary.metrics[key] - previousSummary.metrics[key]
  }

  return { available: true, current: currentSummary, previous: previousSummary, deltas }
}

/** 由周期窗口与聚合结果构造 PeriodMetricSummary */
function buildPeriodSummary(
  range: PeriodRange,
  totalsByPeriod: Map<number, MetricTotals>,
  briefCountByPeriod: Map<number, number>
): PeriodMetricSummary {
  const totals = totalsByPeriod.get(range.index) ?? emptyTotals()
  return {
    periodIndex: range.index,
    label: range.label,
    startDate: range.startDate,
    endDate: range.endDate,
    briefCount: briefCountByPeriod.get(range.index) ?? 0,
    metrics: totalsToMetricRecord(totals),
  }
}
