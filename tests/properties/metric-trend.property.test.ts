// Feature: local-life-depth-enhancements, Property 5: 指标趋势有序且完整

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 5: 指标趋势有序且完整
 *
 * For any 门店与任一指标，performance-learning-service.getMetricTrend 返回的序列
 * SHALL 按 date 升序排列，且该门店每个含该指标的 brief 在序列中恰出现一次；
 * 每个点的 value SHALL 等于该 brief 所有 metrics 在该指标上的求和
 * （conversion 为派生指标 = linkClicks + orders + redemptions 之和）。
 *
 * **Validates: Requirements 1.4**
 *
 * 测试手段：对 @/lib/db 的 prisma.contentBrief.findMany 做内存桩，
 * 返回随机 brief（含乱序日期、同名日期、同一 brief 多条 metrics），
 * 不依赖真实数据库。
 */

// ========================
// Mock Prisma（仅 getMetricTrend 用到的读取）
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    contentBrief: { findMany: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { getMetricTrend } = await import('@/lib/performance-learning-service')

// ========================
// 常量与工具
// ========================

const DAY_MS = 24 * 60 * 60 * 1000

/** PublishMetric 中参与求和的关键字段（conversion 为派生指标，由这些字段计算） */
const METRIC_KEYS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'linkClicks',
  'orders',
  'redemptions',
] as const
type MetricKey = (typeof METRIC_KEYS)[number]

/** getMetricTrend 支持的全部指标键（含派生 conversion） */
const TREND_METRICS = [...METRIC_KEYS, 'conversion'] as const
type TrendMetric = (typeof TREND_METRICS)[number]

type MetricRecord = Record<MetricKey, number>

/** 单条 PublishMetric 的关键字段生成器（非负整数） */
const metricArb: fc.Arbitrary<MetricRecord> = fc.record({
  views: fc.integer({ min: 0, max: 100000 }),
  likes: fc.integer({ min: 0, max: 100000 }),
  comments: fc.integer({ min: 0, max: 100000 }),
  shares: fc.integer({ min: 0, max: 100000 }),
  saves: fc.integer({ min: 0, max: 100000 }),
  linkClicks: fc.integer({ min: 0, max: 100000 }),
  orders: fc.integer({ min: 0, max: 100000 }),
  redemptions: fc.integer({ min: 0, max: 100000 }),
})

/**
 * 单条 brief 生成器：
 * - dayOffset 用整数偏移构造日期，故意允许乱序与同日（重复）以检验排序稳定性；
 * - metrics 至少 1 条，可能多条（验证同一 brief 多条 metrics 求和）。
 */
const briefShapeArb = fc.record({
  dayOffset: fc.integer({ min: -120, max: 120 }),
  metrics: fc.array(metricArb, { minLength: 1, maxLength: 4 }),
})

interface StubBrief {
  id: string
  scheduledDate: Date
  metrics: MetricRecord[]
}

/** 计算某 brief 在指定指标上的期望聚合值（与服务实现口径一致） */
function expectedValue(metrics: MetricRecord[], metric: TrendMetric): number {
  if (metric === 'conversion') {
    return metrics.reduce((s, m) => s + m.linkClicks + m.orders + m.redemptions, 0)
  }
  return metrics.reduce((s, m) => s + m[metric], 0)
}

describe('指标趋势有序且完整 Property (Property 5)', () => {
  it('返回序列按 date 升序、每个含该指标的 brief 恰出现一次、value 为该指标求和', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          metric: fc.constantFrom(...TREND_METRICS),
          // 至少 1 条 brief；id 由索引派生保证唯一
          shapes: fc.array(briefShapeArb, { minLength: 1, maxLength: 12 }),
          baseTime: fc.integer({ min: 0, max: 1_000_000 }),
        }),
        async ({ metric, shapes, baseTime }) => {
          const base = baseTime * DAY_MS
          const briefs: StubBrief[] = shapes.map((s, i) => ({
            id: `brief-${i}`,
            scheduledDate: new Date(base + s.dayOffset * DAY_MS),
            metrics: s.metrics,
          }))

          // 桩按任意（乱序）顺序返回，服务内部应自行排序
          vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(briefs as never)

          const result = await getMetricTrend({ storeId: 's1', metric })

          // 完整性：输出数量与输入 brief 数一致
          expect(result.length).toBe(briefs.length)

          // 每个 brief 恰出现一次：briefId 集合与输入完全一致，无重复、无缺失、无新增
          const resultIds = result.map((p) => p.briefId)
          expect(new Set(resultIds).size).toBe(resultIds.length) // 无重复
          expect(new Set(resultIds)).toStrictEqual(new Set(briefs.map((b) => b.id)))

          // 有序性：date 非降序（升序）
          for (let i = 1; i < result.length; i++) {
            expect(result[i]!.date.getTime()).toBeGreaterThanOrEqual(result[i - 1]!.date.getTime())
          }

          // 取值正确：每个点 value = 该 brief 所有 metrics 在该指标上的求和
          const briefById = new Map(briefs.map((b) => [b.id, b]))
          for (const point of result) {
            const src = briefById.get(point.briefId)!
            expect(point.value).toBe(expectedValue(src.metrics, metric))
            expect(point.date.getTime()).toBe(src.scheduledDate.getTime())
          }
        }
      ),
      { numRuns: 150 }
    )
  })

  it('空门店（无含该指标的 brief）返回空序列，不伪造数据', async () => {
    vi.mocked(prisma.contentBrief.findMany).mockResolvedValue([] as never)
    const result = await getMetricTrend({ storeId: 's-empty', metric: 'views' })
    expect(result).toStrictEqual([])
  })
})
