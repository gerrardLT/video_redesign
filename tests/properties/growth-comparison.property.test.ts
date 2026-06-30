// Feature: local-life-depth-enhancements, Property 38: 效果对比取真实最佳
/**
 * 属性测试：留存激励服务「效果对比取真实最佳」（Property 38）
 *
 * **Validates: Requirements 11.3**
 *
 * 不变式：getGrowthComparison 的 thisBest / lastBest 分别等于「本月 / 上月」排期窗口内
 * 按所选指标（播放量 views，跨该 brief 全部 metrics 求和）取真实最佳的内容；
 * 当任一侧历史不足（该窗口内无含数据内容）时返回 { available:false }，不制造虚假成长感。
 *
 * 隔离策略：getGrowthComparison 仅经 prisma.contentBrief.findMany 读库（已按本月/上月排期 +
 * metrics:{some:{}} 过滤），其余为纯计算（pickBest 按 views 求和取最大）。参照既有属性测试约定
 *（tests/properties/performance-learning.property.test.ts），对 @/lib/db 做内存桩，仅参数化
 * 注入「本月/上月含 metrics 的 brief 数据集」，从而隔离纯断言逻辑——不 mock 任何关键业务逻辑。
 * fast-check 运行 ≥100 次迭代，Node 环境。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ========================
// Mock Prisma：仅替换 DB 读取，隔离纯计算逻辑
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    contentBrief: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { getGrowthComparison } from '@/lib/engagement-service'

// ========================
// 周期口径：与被测函数一致（基于真实 new Date() 的自然月）
// ========================

const NOW = new Date()
const THIS_MONTH_START = new Date(NOW.getFullYear(), NOW.getMonth(), 1, 0, 0, 0, 0)
const LAST_MONTH_START = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1, 0, 0, 0, 0)

/** 一日的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000

// ========================
// 生成器：构造本月/上月含 metrics 的 brief 数据集
// ========================

/** 单条 metrics 的播放量（覆盖 0 与较大值，使最大值判定有意义） */
const viewsArb = fc.nat({ max: 1_000_000 })

/**
 * 构造一个落在指定月窗口内、含 1-3 条 metrics 的 brief。
 * 形如 prisma.contentBrief.findMany(select:{id,title,scheduledDate,metrics:{views}}) 的返回项。
 *
 * dayOffset ∈ [0,27]：保证 scheduledDate 始终落在该自然月内（任意月份均 ≥28 天），
 * 既 < 下月起始也 ≥ 本月起始，从而与被测函数的窗口划分严格一致。
 */
const briefInMonthArb = (windowStart: Date, id: string) =>
  fc
    .record({
      dayOffset: fc.nat({ max: 27 }),
      title: fc.string({ minLength: 1, maxLength: 12 }),
      metrics: fc.array(fc.record({ views: viewsArb }), { minLength: 1, maxLength: 3 }),
    })
    .map((b) => ({
      id,
      title: b.title,
      scheduledDate: new Date(windowStart.getTime() + b.dayOffset * DAY_MS),
      metrics: b.metrics,
    }))

/** 某月的 brief 列表（可能为空，用于覆盖 available:false 分支） */
const monthBriefsArb = (windowStart: Date, prefix: string) =>
  fc
    .integer({ min: 0, max: 6 })
    .chain((n) =>
      fc.tuple(...Array.from({ length: n }, (_, i) => briefInMonthArb(windowStart, `${prefix}-${i}`))),
    )

/** 同时生成本月、上月数据集（两侧均可能为空） */
const datasetArb = fc.record({
  thisMonth: monthBriefsArb(THIS_MONTH_START, 'this'),
  lastMonth: monthBriefsArb(LAST_MONTH_START, 'last'),
})

// ========================
// 期望计算：窗口内 views 求和的最大值
// ========================

type FixtureBrief = { id: string; title: string; scheduledDate: Date; metrics: { views: number }[] }

/** 计算某 brief 的真实指标值：跨全部 metrics 的 views 求和（与被测 pickBest 一致） */
function sumViews(brief: FixtureBrief): number {
  return brief.metrics.reduce((acc, m) => acc + m.views, 0)
}

/** 窗口内 views 求和的最大值（空集合返回 null） */
function maxViews(briefs: FixtureBrief[]): number | null {
  if (briefs.length === 0) return null
  return Math.max(...briefs.map(sumViews))
}

// ========================
// 属性测试
// ========================

describe('Property 38: 效果对比取真实最佳 (Validates: Requirements 11.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('thisBest/lastBest 取各月 views 求和最大者；任一月无数据时 available:false', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, async ({ thisMonth, lastMonth }) => {
        // findMany 在被测函数中已按「上月~本月 + 含 metrics」过滤，这里直接注入两窗口并集
        const all = [...thisMonth, ...lastMonth]
        vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(all as never)

        const result = await getGrowthComparison({ storeId: 'store-1' })

        const expectedThisMax = maxViews(thisMonth)
        const expectedLastMax = maxViews(lastMonth)

        if (expectedThisMax === null || expectedLastMax === null) {
          // 任一月无含数据内容 → 不伪造对比
          expect(result.available).toBe(false)
          return
        }

        // 两侧均有真实数据 → 返回各自最佳
        expect(result.available).toBe(true)
        if (!result.available) return // 类型收窄

        expect(result.thisBest.metric).toBe('views')
        expect(result.lastBest.metric).toBe('views')
        expect(result.thisBest.periodLabel).toBe('本月')
        expect(result.lastBest.periodLabel).toBe('上月')

        // 取真实最佳：值等于对应窗口 views 求和的最大值
        expect(result.thisBest.value).toBe(expectedThisMax)
        expect(result.lastBest.value).toBe(expectedLastMax)

        // 返回的最佳内容确实来自对应窗口，且其值与重算一致
        const thisPick = thisMonth.find((b) => b.id === result.thisBest.briefId)
        const lastPick = lastMonth.find((b) => b.id === result.lastBest.briefId)
        expect(thisPick).toBeDefined()
        expect(lastPick).toBeDefined()
        expect(sumViews(thisPick as FixtureBrief)).toBe(expectedThisMax)
        expect(sumViews(lastPick as FixtureBrief)).toBe(expectedLastMax)
      }),
      { numRuns: 100 },
    )
  })

  it('示例：本月最佳明显高于上月，按 views 取真实最佳并标注本月/上月', async () => {
    const all = [
      // 上月两条，最佳为 b-last-1（views 求和 30）
      { id: 'b-last-0', title: '上月A', scheduledDate: new Date(LAST_MONTH_START.getTime() + 1 * DAY_MS), metrics: [{ views: 10 }] },
      { id: 'b-last-1', title: '上月B', scheduledDate: new Date(LAST_MONTH_START.getTime() + 5 * DAY_MS), metrics: [{ views: 20 }, { views: 10 }] },
      // 本月两条，最佳为 b-this-1（views 求和 500）
      { id: 'b-this-0', title: '本月A', scheduledDate: new Date(THIS_MONTH_START.getTime() + 2 * DAY_MS), metrics: [{ views: 100 }] },
      { id: 'b-this-1', title: '本月B', scheduledDate: new Date(THIS_MONTH_START.getTime() + 8 * DAY_MS), metrics: [{ views: 300 }, { views: 200 }] },
    ]
    vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(all as never)

    const result = await getGrowthComparison({ storeId: 'store-1' })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.thisBest.briefId).toBe('b-this-1')
    expect(result.thisBest.value).toBe(500)
    expect(result.lastBest.briefId).toBe('b-last-1')
    expect(result.lastBest.value).toBe(30)
    expect(result.evidence.length).toBeGreaterThan(0)
  })

  it('示例：上月无含数据内容时返回 available:false', async () => {
    const all = [
      { id: 'b-this-0', title: '本月A', scheduledDate: new Date(THIS_MONTH_START.getTime() + 3 * DAY_MS), metrics: [{ views: 100 }] },
    ]
    vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(all as never)

    const result = await getGrowthComparison({ storeId: 'store-1' })
    expect(result.available).toBe(false)
  })
})
