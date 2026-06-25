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
 */

import { prisma } from '@/lib/db'
import type { PerformanceInsights, Suggestion, ContentGoal } from '@/types/merchant'

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
  if (briefsWithMetrics.length < 3) {
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
