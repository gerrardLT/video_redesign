// Feature: local-life-depth-enhancements, Property 37: 里程碑触发等价
//
// 属性：For any 周期完成度数据，checkMilestones 返回某里程碑 当且仅当 其达成条件成立。
//
// 达成条件（与 src/lib/engagement-service.ts 一致）：
//   - 连续天数里程碑 streak_days_{t}（t ∈ {3,7,14,30}）：当且仅当 连续发布天数 days >= t；
//   - 连续周数里程碑 streak_weeks_{t}（t ∈ {2,4,8,12}）：当且仅当 连续发布周数 weeks >= t；
//   - 本周完成里程碑 week_completed_{周起始日}：当且仅当 当前周期内有内容任务且全部处于完成终态
//     （EXPORTED / PUBLISHED / ARCHIVED）。
//
// 被测：src/lib/engagement-service.ts 的 checkMilestones。
// 隔离策略：连续天/周由真实发布数据（publishQueueItem.publishedPlatforms / publishMetric.capturedAt）
//   经真实 computeStreak 派生（其正确性由 Property 36 单独保证），本属性只校验「streak/周完成 → 里程碑集合」
//   的等价映射。对 @/lib/db 的 prisma 做内存桩——storeProfile.findUnique 返回 weeklyCadence，
//   publishQueueItem/publishMetric.findMany 返回构造的真实发布日期，contentBrief.findMany 返回
//   当前周期的内容任务状态列表，streakRecord.findUnique/upsert 与 storeNotification.create 为
//   不影响返回值的副作用空桩。period-service（resolvePeriods/periodIndexOf）与 computeStreak 保持真实实现。
//   fast-check 运行 ≥100 次迭代，Node 环境。
//
// **Validates: Requirements 11.2**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ============================================================
// 内存桩状态（vi.hoisted 在所有 import 之前执行，供 mock 工厂引用）
// ============================================================
const h = vi.hoisted(() => {
  const state: {
    weeklyCadence: unknown
    queueRows: Array<{ publishedPlatforms: Array<{ platform: string; publishedAt: string }> }>
    metricRows: Array<{ capturedAt: Date }>
    briefRows: Array<{ status: string }>
  } = {
    weeklyCadence: null,
    queueRows: [],
    metricRows: [],
    briefRows: [],
  }
  return { state }
})

// ============================================================
// prisma 内存桩：返回构造数据；副作用方法为不影响返回值的空桩
// ============================================================
vi.mock('@/lib/shared/db', () => {
  const { state } = h
  const prisma = {
    storeProfile: {
      findUnique: vi.fn(async () => ({ weeklyCadence: state.weeklyCadence })),
    },
    publishQueueItem: {
      findMany: vi.fn(async () => state.queueRows),
    },
    publishMetric: {
      findMany: vi.fn(async () => state.metricRows),
    },
    contentBrief: {
      findMany: vi.fn(async () => state.briefRows),
    },
    streakRecord: {
      // 返回值不影响 checkMilestones 的里程碑集合，仅影响通知去重副作用
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    storeNotification: {
      create: vi.fn(async () => ({})),
    },
  }
  return { prisma }
})

// 动态导入以确保 mock 生效
const { checkMilestones, computeStreak } = await import('@/lib/merchant/engagement-service')
const { resolvePeriods } = await import('@/lib/merchant/period-service')

// ============================================================
// 常量（与 engagement-service 内部常量一致）
// ============================================================
const STREAK_DAY_THRESHOLDS = [3, 7, 14, 30]
const STREAK_WEEK_THRESHOLDS = [2, 4, 8, 12]
const DONE_BRIEF_STATUSES = ['EXPORTED', 'PUBLISHED', 'ARCHIVED']
const NOT_DONE_BRIEF_STATUSES = ['DRAFT', 'SCHEDULED', 'READY_TO_SHOOT', 'RENDERING', 'FAILED']

// ============================================================
// 工具
// ============================================================

/** YYYY-MM-DD（复刻 engagement-service 内部 dateKey，用于 week_completed 里程碑 id） */
function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 某日期所在本地自然日的中午（远离日界，避免边界归一化抖动） */
function dayNoon(base: Date, dayOffset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 12, 0, 0, 0)
}

/** weeklyCadence 生成器：null（默认自然周）或带 day(1-7) 的配置数组 */
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

beforeEach(() => {
  vi.clearAllMocks()
  h.state.weeklyCadence = null
  h.state.queueRows = []
  h.state.metricRows = []
  h.state.briefRows = []
})

// ============================================================
// Property 37: 里程碑触发等价
// ============================================================

describe('Property 37: 里程碑触发等价', () => {
  it('checkMilestones 返回的里程碑集合 恰等于 达成条件成立的里程碑集合', async () => {
    /**
     * **Validates: Requirements 11.2**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          weeklyCadence: weeklyCadenceArb,
          // 以「今天」为终点的连续发布天数（覆盖 3/7/14/30 阈值两侧）
          runDays: fc.integer({ min: 0, max: 35 }),
          // 以「当前周期」为终点的连续发布周数（覆盖 2/4/8/12 阈值两侧）
          runWeeks: fc.integer({ min: 0, max: 14 }),
          // 久远的噪声发布日期（不影响以当下为终点的连续段，但增强 computeStreak 输入多样性）
          noiseDaysAgo: fc.array(fc.integer({ min: 40, max: 160 }), { maxLength: 5 }),
          // 当前周期内的内容任务状态列表（混合完成终态/非终态，空数组=本周无任务）
          briefStatuses: fc.array(
            fc.constantFrom(...DONE_BRIEF_STATUSES, ...NOT_DONE_BRIEF_STATUSES),
            { maxLength: 6 }
          ),
        }),
        async ({ weeklyCadence, runDays, runWeeks, noiseDaysAgo, briefStatuses }) => {
          // 在调用前捕获基准时刻；checkMilestones 内部取 new Date()，与此同处同一本地自然日
          const ref = new Date()

          // ── 构造真实发布日期集合 ──
          const publishDates: Date[] = []
          // 连续天数段：今天、昨天 … 共 runDays 天
          for (let i = 0; i < runDays; i++) {
            publishDates.push(dayNoon(ref, -i))
          }
          // 连续周数段：当前周期及往前 runWeeks-1 个周期，各放一条（取周期中点，远离边界）
          if (runWeeks > 0) {
            const ranges = resolvePeriods({ weeklyCadence, referenceDate: ref, count: runWeeks + 4 })
            const byIndex = new Map(ranges.map((r) => [r.index, r]))
            for (let i = 0; i < runWeeks; i++) {
              const range = byIndex.get(-i)
              if (range) {
                publishDates.push(new Date(range.startDate.getTime() + 3.5 * 24 * 60 * 60 * 1000))
              }
            }
          }
          // 噪声发布日期
          for (const d of noiseDaysAgo) {
            publishDates.push(dayNoon(ref, -d))
          }

          // ── 将发布日期按奇偶分流到两个真实来源，覆盖 collectPublishDates 的并集逻辑 ──
          h.state.weeklyCadence = weeklyCadence
          h.state.queueRows = []
          h.state.metricRows = []
          publishDates.forEach((d, idx) => {
            if (idx % 2 === 0) {
              h.state.queueRows.push({
                publishedPlatforms: [{ platform: 'DOUYIN', publishedAt: d.toISOString() }],
              })
            } else {
              h.state.metricRows.push({ capturedAt: d })
            }
          })
          h.state.briefRows = briefStatuses.map((status) => ({ status }))

          // ── 独立推导达成条件 ──
          // 连续天/周经真实 computeStreak 派生（其正确性由 Property 36 保证）
          const streak = computeStreak({ publishDates, weeklyCadence, referenceDate: ref })
          // 本周完成：当前周期有任务且全部为完成终态
          const weekCompleted =
            briefStatuses.length > 0 && briefStatuses.every((s) => DONE_BRIEF_STATUSES.includes(s))

          // 期望里程碑 id 集合
          const expectedIds = new Set<string>()
          for (const t of STREAK_DAY_THRESHOLDS) {
            if (streak.days >= t) expectedIds.add(`streak_days_${t}`)
          }
          for (const t of STREAK_WEEK_THRESHOLDS) {
            if (streak.weeks >= t) expectedIds.add(`streak_weeks_${t}`)
          }
          if (weekCompleted) {
            const [currentPeriod] = resolvePeriods({ weeklyCadence, referenceDate: ref, count: 1 })
            expectedIds.add(`week_completed_${dateKey(currentPeriod.startDate)}`)
          }

          // ── 执行被测函数 ──
          const milestones = await checkMilestones({ storeId: 'store-1' })
          const actualIds = new Set(milestones.map((m) => m.id))

          // ── 断言：返回集合 恰等于 达成条件成立的集合（双向蕴含：成立则返回、返回则成立）──
          expect(actualIds).toEqual(expectedIds)
          // id 不重复（每个里程碑至多一次）
          expect(milestones.length).toBe(expectedIds.size)

          // ── 逐项强化：每个返回里程碑的 achievedValue 与其种类的真实进度一致 ──
          for (const m of milestones) {
            if (m.kind === 'STREAK_DAYS') {
              const t = Number(m.id.replace('streak_days_', ''))
              expect(streak.days).toBeGreaterThanOrEqual(t)
              expect(m.achievedValue).toBe(streak.days)
            } else if (m.kind === 'STREAK_WEEKS') {
              const t = Number(m.id.replace('streak_weeks_', ''))
              expect(streak.weeks).toBeGreaterThanOrEqual(t)
              expect(m.achievedValue).toBe(streak.weeks)
            } else {
              expect(m.kind).toBe('WEEK_COMPLETED')
              expect(weekCompleted).toBe(true)
            }
          }
        }
      ),
      { numRuns: 150 }
    )
  })
})
