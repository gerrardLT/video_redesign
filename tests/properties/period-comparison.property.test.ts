// Feature: local-life-depth-enhancements, Property 6: 跨周对比差值一致性

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Property 6: 跨周对比差值一致性
 *
 * For any 至少 2 个已结束内容周期（且含数据）的门店，getPeriodComparison 返回的每个
 * delta SHALL 等于「本周期聚合值 − 上周期聚合值」；当已结束（且含数据）周期 <2 时
 * SHALL 返回 available:false，绝不伪造对比。
 *
 * 测试策略：
 * - 对 @/lib/db 的 prisma 读取（storeProfile.findUnique / contentBrief.findMany）做内存桩；
 *   period-service 为纯计算，保持真实实现。
 * - 借助真实 resolvePeriods 计算与被测函数一致的周期窗口（同一自然周内多次取 new Date()
 *   不会跨周），将构造的 brief 排期日固定落在各周期窗口中点，远离边界，保证归属确定。
 *
 * **Validates: Requirements 1.5**
 */

// ========================
// Mock Prisma（仅 getPeriodComparison 用到的读取）
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    storeProfile: { findUnique: vi.fn() },
    contentBrief: { findMany: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { getPeriodComparison } = await import('@/lib/performance-learning-service')
const { resolvePeriods } = await import('@/lib/period-service')

// ========================
// 常量与工具
// ========================

const DAY_MS = 24 * 60 * 60 * 1000

/** PublishMetric 中参与聚合的关键字段（conversion 为派生指标，单独处理） */
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
/** 含派生 conversion 的完整指标键集合（与服务返回的 metrics 记录键一致） */
const ALL_KEYS = [...METRIC_KEYS, 'conversion'] as const

type MetricRecord = Record<MetricKey, number>

/** 单条 PublishMetric 的关键字段生成器（非负整数） */
const metricArb: fc.Arbitrary<MetricRecord> = fc.record({
  views: fc.integer({ min: 0, max: 1000 }),
  likes: fc.integer({ min: 0, max: 1000 }),
  comments: fc.integer({ min: 0, max: 1000 }),
  shares: fc.integer({ min: 0, max: 1000 }),
  saves: fc.integer({ min: 0, max: 1000 }),
  linkClicks: fc.integer({ min: 0, max: 1000 }),
  orders: fc.integer({ min: 0, max: 1000 }),
  redemptions: fc.integer({ min: 0, max: 1000 }),
})

/** weeklyCadence 配置生成器：null（默认自然周）或带 day(1-7) 的条目数组 */
const weeklyCadenceArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.array(
    fc.record({
      day: fc.integer({ min: 1, max: 7 }),
      theme: fc.string(),
      count: fc.integer({ min: 1, max: 5 }),
    }),
    { minLength: 1, maxLength: 5 }
  )
)

/** 零值累加器 */
function zeroSum(): MetricRecord {
  return {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    linkClicks: 0,
    orders: 0,
    redemptions: 0,
  }
}

/** 将基础累加器展开为含 conversion 的完整指标记录（与服务一致） */
function withConversion(sum: MetricRecord): Record<string, number> {
  return {
    ...sum,
    conversion: sum.linkClicks + sum.orders + sum.redemptions,
  }
}

/** 周期窗口中点（周期开始 + 3.5 天），远离左右边界，保证归属确定 */
function periodMidpoint(startDateMs: number): Date {
  return new Date(startDateMs + 3.5 * DAY_MS)
}

interface StubBrief {
  id: string
  scheduledDate: Date
  metrics: MetricRecord[]
}

/** 安装 prisma 桩：storeProfile 返回 weeklyCadence，contentBrief 返回按日期升序的 brief 列表 */
function installStub(weeklyCadence: unknown, briefs: StubBrief[]): void {
  vi.mocked(prisma.storeProfile.findUnique).mockResolvedValue({ weeklyCadence } as never)
  vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(
    [...briefs].sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()) as never
  )
}

describe('跨周对比差值一致性 Property (Property 6)', () => {
  it('已结束周期 ≥2 且含数据时，每个 delta = 本周期聚合 − 上周期聚合', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          weeklyCadence: weeklyCadenceArb,
          // periods[0] → 最近的已结束周期(index -1)，periods[1] → index -2 …；每周期 ≥1 条 brief（即含数据）
          periods: fc.array(
            fc.array(fc.array(metricArb, { minLength: 1, maxLength: 2 }), {
              minLength: 1,
              maxLength: 3,
            }),
            { minLength: 2, maxLength: 4 }
          ),
        }),
        async ({ weeklyCadence, periods }) => {
          const now = new Date()
          const k = periods.length
          const ranges = resolvePeriods({ weeklyCadence, referenceDate: now, count: k + 6 })
          const rangeByIndex = new Map(ranges.map((r) => [r.index, r]))

          const briefs: StubBrief[] = []
          const periodSums: MetricRecord[] = []
          let counter = 0

          periods.forEach((briefsMetrics, p) => {
            const idx = -(p + 1) // periods[0] → -1, periods[1] → -2, …
            const range = rangeByIndex.get(idx)!
            const mid = periodMidpoint(range.startDate.getTime())
            const sum = zeroSum()
            for (const metricsList of briefsMetrics) {
              briefs.push({ id: `b${counter++}`, scheduledDate: mid, metrics: metricsList })
              for (const m of metricsList) {
                for (const key of METRIC_KEYS) sum[key] += m[key]
              }
            }
            periodSums[p] = sum
          })

          installStub(weeklyCadence, briefs)

          const result = await getPeriodComparison({ storeId: 's1' })

          // 已结束且含数据周期 ≥2 → 必为可对比
          expect(result.available).toBe(true)
          if (!result.available) return

          const expectedCurrent = withConversion(periodSums[0]!) // index -1
          const expectedPrev = withConversion(periodSums[1]!) // index -2

          for (const key of ALL_KEYS) {
            // 聚合值一致
            expect(result.current.metrics[key]).toBe(expectedCurrent[key])
            expect(result.previous.metrics[key]).toBe(expectedPrev[key])
            // delta = 本周期 − 上周期
            expect(result.deltas[key]).toBe(expectedCurrent[key]! - expectedPrev[key]!)
          }

          // brief 计数与构造一致
          expect(result.current.briefCount).toBe(periods[0]!.length)
          expect(result.previous.briefCount).toBe(periods[1]!.length)
        }
      ),
      { numRuns: 120 }
    )
  })

  it('已结束（且含数据）周期 <2 时返回 available:false，不伪造对比', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          weeklyCadence: weeklyCadenceArb,
          // empty: 无任何带数据 brief；currentOnly: 仅当前(未结束)周期有数据；oneEnded: 仅 1 个已结束周期有数据
          caseType: fc.constantFrom('empty', 'currentOnly', 'oneEnded'),
          briefsMetrics: fc.array(fc.array(metricArb, { minLength: 1, maxLength: 2 }), {
            minLength: 1,
            maxLength: 3,
          }),
        }),
        async ({ weeklyCadence, caseType, briefsMetrics }) => {
          const now = new Date()
          const ranges = resolvePeriods({ weeklyCadence, referenceDate: now, count: 8 })
          const rangeByIndex = new Map(ranges.map((r) => [r.index, r]))

          const briefs: StubBrief[] = []
          if (caseType !== 'empty') {
            // currentOnly → 当前周期(index 0，未结束)；oneEnded → 唯一已结束周期(index -1)
            const range = caseType === 'currentOnly' ? rangeByIndex.get(0)! : rangeByIndex.get(-1)!
            // 当前周期取窗口起点（必 <= now，落在 index 0）；已结束周期取中点
            const date =
              caseType === 'currentOnly' ? new Date(range.startDate.getTime()) : periodMidpoint(range.startDate.getTime())
            let counter = 0
            for (const metricsList of briefsMetrics) {
              briefs.push({ id: `b${counter++}`, scheduledDate: date, metrics: metricsList })
            }
          }

          installStub(weeklyCadence, briefs)

          const result = await getPeriodComparison({ storeId: 's1' })

          expect(result.available).toBe(false)
          if (!result.available) {
            // 不伪造：必须给出明确的不可对比原因
            expect(typeof result.reason).toBe('string')
            expect(result.reason.length).toBeGreaterThan(0)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
