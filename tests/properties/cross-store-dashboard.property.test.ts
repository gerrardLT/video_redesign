// Feature: local-life-depth-enhancements, Property 35: 跨店看板真实聚合
//
// 属性测试：对任意多门店随机数据，getCrossStoreDashboard(userId) 返回的每个门店 KPI
// （本周完成度 weeklyCompletion、最佳视频表现 bestVideo、待办数 todoCount）SHALL 等于
// 对该门店「独立真实聚合查询」的结果，绝不占位 / 伪造：
//   1) weeklyCompletion：本周（period-service 当前周期，左闭右开）排期 brief 的
//      completed(EXPORTED/PUBLISHED)/total；total=0 时 rate=0（不伪造满分）；
//   2) bestVideo：该门店带 metrics 的内容中累计 views 最高者（平局按 conversion 再按 briefId）；
//      无任何带 metrics 的内容时为 null（不占位）；
//   3) todoCount：处于待办状态集合的 brief 计数。
// 同时验证作用域：仅聚合该 userId 名下门店，其它商家门店绝不混入；门店顺序按 createdAt 升序。
//
// 被测：src/lib/cross-store-service.ts 的 getCrossStoreDashboard。
// 对 @/lib/db 的 prisma 做内存桩——store.findMany 按 merchant.userId 过滤并返回
// profile.weeklyCadence；contentBrief.count 按 where（storeId + 可选 scheduledDate 区间 +
// 可选 status.in）真实统计；contentBrief.findMany 按 storeId + metrics.some 返回含 metrics 的项。
// period-service 为纯计算，不 mock，作为周期口径单一真相。fast-check ≥100 次迭代，Node 环境。
//
// **Validates: Requirements 10.3, 10.5**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { resolvePeriods } from '@/lib/merchant/period-service'

// ============================================================
// 内存桩状态（vi.hoisted 在所有 import 之前执行，供 mock 工厂引用）
// ============================================================
const h = vi.hoisted(() => {
  interface MetricRow {
    views: number
    likes: number
    linkClicks: number
    orders: number
    redemptions: number
  }
  interface BriefRow {
    id: string
    storeId: string
    title: string
    scheduledDate: Date
    status: string
    metrics: MetricRow[]
  }
  interface StoreRow {
    id: string
    name: string
    userId: string
    createdAt: Date
    weeklyCadence: unknown
  }
  const state: { stores: StoreRow[]; briefs: BriefRow[] } = { stores: [], briefs: [] }
  return { state }
})

// ============================================================
// prisma 内存桩：忠实复现作用域与聚合查询语义
// ============================================================
vi.mock('@/lib/shared/db', () => {
  const { state } = h
  const prisma = {
    store: {
      // where: { merchant: { userId } }, select: { id, name, profile: { weeklyCadence } }
      findMany: vi.fn(async (args: { where: { merchant: { userId: string } } }) => {
        const userId = args.where.merchant.userId
        return state.stores
          .filter((s) => s.userId === userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((s) => ({
            id: s.id,
            name: s.name,
            // profile 可能不存在（weeklyCadence 为 undefined 表示无 profile）
            profile: s.weeklyCadence === undefined ? null : { weeklyCadence: s.weeklyCadence },
          }))
      }),
    },
    contentBrief: {
      // 三种 where 形态：
      //  - { storeId, scheduledDate: { gte, lt } }                 → 本周 total
      //  - { storeId, scheduledDate: { gte, lt }, status: { in } }  → 本周 completed
      //  - { storeId, status: { in } }                             → todoCount
      count: vi.fn(
        async (args: {
          where: {
            storeId: string
            scheduledDate?: { gte: Date; lt: Date }
            status?: { in: string[] }
          }
        }) => {
          const { storeId, scheduledDate, status } = args.where
          return state.briefs.filter((b) => {
            if (b.storeId !== storeId) return false
            if (scheduledDate) {
              const t = b.scheduledDate.getTime()
              if (!(t >= scheduledDate.gte.getTime() && t < scheduledDate.lt.getTime())) return false
            }
            if (status) {
              if (!status.in.includes(b.status)) return false
            }
            return true
          }).length
        }
      ),
      // where: { storeId, metrics: { some: {} } } → 该门店带 metrics 的内容
      findMany: vi.fn(async (args: { where: { storeId: string; metrics: { some: object } } }) => {
        const { storeId } = args.where
        return state.briefs
          .filter((b) => b.storeId === storeId && b.metrics.length > 0)
          .map((b) => ({
            id: b.id,
            title: b.title,
            metrics: b.metrics.map((m) => ({
              views: m.views,
              likes: m.likes,
              linkClicks: m.linkClicks,
              orders: m.orders,
              redemptions: m.redemptions,
            })),
          }))
      }),
    },
  }
  return { prisma }
})

// 动态导入以确保 mock 生效
const { getCrossStoreDashboard } = await import('@/lib/merchant/cross-store-service')

// ============================================================
// 常量（与被测服务口径保持一致）
// ============================================================
const TODO_STATUSES = [
  'READY_TO_SHOOT',
  'MATERIALS_UPLOADED',
  'RENDERING',
  'GENERATED',
  'COMPLIANCE_REVIEW',
  'READY_TO_EXPORT',
  'EXPORTED',
]
const COMPLETED_STATUSES = ['EXPORTED', 'PUBLISHED']
// 全部可能状态：含待办、已完成、以及不计入任何集合的终态/草稿（用于验证不混入）
const ALL_STATUSES = [
  ...new Set([...TODO_STATUSES, ...COMPLETED_STATUSES, 'DRAFT', 'SCHEDULED', 'FAILED', 'ARCHIVED']),
]
const DAY_MS = 24 * 60 * 60 * 1000

// ============================================================
// Arbitraries
// ============================================================

const metricArb = fc.record({
  views: fc.nat({ max: 2000 }),
  likes: fc.nat({ max: 2000 }),
  linkClicks: fc.nat({ max: 500 }),
  orders: fc.nat({ max: 500 }),
  redemptions: fc.nat({ max: 500 }),
})

// 单条 brief 规格（scheduledDate 在属性体内基于本周窗口具体化）
const briefSpecArb = fc.record({
  // 是否落在「本周」窗口内
  inWeek: fc.boolean(),
  // 本周内的天偏移（0..6，确保 < 7 天，落在 [start, end) 内且远离右边界）
  weekDayOffset: fc.integer({ min: 0, max: 6 }),
  // 本周外的天偏移方向与距离（远离边界 ≥10 天，避免 now 毫秒差导致跨周抖动）
  outsidePast: fc.boolean(),
  outsideDist: fc.integer({ min: 10, max: 40 }),
  status: fc.constantFrom(...ALL_STATUSES),
  metrics: fc.array(metricArb, { maxLength: 3 }),
})

// 单门店规格
const storeSpecArb = fc.record({
  // weeklyCadence：null（默认自然周）或一个含起始星期的配置
  cadence: fc.option(
    fc.array(
      fc.record({ day: fc.integer({ min: 1, max: 7 }), theme: fc.constant('x'), count: fc.constant(1) }),
      { minLength: 1, maxLength: 3 }
    ),
    { nil: null }
  ),
  briefs: fc.array(briefSpecArb, { maxLength: 8 }),
})

// 多门店场景：1..4 个门店
const scenarioArb = fc.array(storeSpecArb, { minLength: 1, maxLength: 4 })

// ============================================================
// 独立聚合 Oracle（与服务实现不同的代码路径，从原始数据直接计算期望值）
// ============================================================
interface MetricLike {
  views: number
  likes: number
  linkClicks: number
  orders: number
  redemptions: number
}
interface BriefLike {
  id: string
  title: string
  scheduledDate: Date
  status: string
  metrics: MetricLike[]
}

function expectedWeeklyCompletion(briefs: BriefLike[], start: Date, end: Date) {
  const inWeek = briefs.filter(
    (b) => b.scheduledDate.getTime() >= start.getTime() && b.scheduledDate.getTime() < end.getTime()
  )
  const total = inWeek.length
  const completed = inWeek.filter((b) => COMPLETED_STATUSES.includes(b.status)).length
  return { total, completed, rate: total > 0 ? completed / total : 0 }
}

function expectedTodoCount(briefs: BriefLike[]) {
  return briefs.filter((b) => TODO_STATUSES.includes(b.status)).length
}

function expectedBestVideo(briefs: BriefLike[]) {
  const withMetrics = briefs.filter((b) => b.metrics.length > 0)
  if (withMetrics.length === 0) return null
  const summaries = withMetrics.map((b) => {
    const agg = b.metrics.reduce(
      (acc, m) => ({
        views: acc.views + m.views,
        likes: acc.likes + m.likes,
        conversion: acc.conversion + m.linkClicks + m.orders + m.redemptions,
      }),
      { views: 0, likes: 0, conversion: 0 }
    )
    return { contentBriefId: b.id, title: b.title, views: agg.views, likes: agg.likes, conversion: agg.conversion }
  })
  summaries.sort((a, b) => {
    if (b.views !== a.views) return b.views - a.views
    if (b.conversion !== a.conversion) return b.conversion - a.conversion
    return a.contentBriefId < b.contentBriefId ? -1 : a.contentBriefId > b.contentBriefId ? 1 : 0
  })
  return summaries[0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 35: 跨店看板真实聚合
// ============================================================
describe('Property 35: 跨店看板真实聚合', () => {
  it('每个门店 KPI 等于对该门店独立真实聚合的结果，无数据时 bestVideo=null、rate=0（不占位）', async () => {
    /**
     * **Validates: Requirements 10.3, 10.5**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { state } = h
        state.stores = []
        state.briefs = []

        const userId = 'user-target'
        const otherUserId = 'user-other'

        // 干扰数据：另一商家的门店与 brief，必须绝不混入目标商家看板（作用域校验）
        state.stores.push({
          id: 'other-store',
          name: '别家门店',
          userId: otherUserId,
          createdAt: new Date(2020, 0, 1),
          weeklyCadence: null,
        })
        state.briefs.push({
          id: 'other-brief',
          storeId: 'other-store',
          title: '别家内容',
          scheduledDate: new Date(),
          status: 'READY_TO_SHOOT',
          metrics: [{ views: 999999, likes: 0, linkClicks: 0, orders: 0, redemptions: 0 }],
        })

        // 期望值表：storeId → 独立聚合结果
        interface Expected {
          storeId: string
          storeName: string
          weekStart: Date
          weekEnd: Date
          briefs: BriefLike[]
        }
        const expectedByStore: Expected[] = []

        scenario.forEach((store, si) => {
          const storeId = `store-${si}`
          const createdAt = new Date(2026, 0, 1 + si) // 升序，验证返回顺序
          state.stores.push({
            id: storeId,
            name: `门店${si}`,
            userId,
            createdAt,
            weeklyCadence: store.cadence,
          })

          // 用与服务一致的周期口径具体化本周窗口（period-service 为纯计算，单一真相）
          const [period] = resolvePeriods({ weeklyCadence: store.cadence, referenceDate: new Date(), count: 1 })
          const weekStart = period.startDate
          const weekEnd = period.endDate

          const storeBriefs: BriefLike[] = []
          store.briefs.forEach((spec, bi) => {
            let scheduledDate: Date
            if (spec.inWeek) {
              // 落在本周窗口内：start + [0,6] 天（远离右边界 end=start+7）
              scheduledDate = new Date(weekStart.getTime() + spec.weekDayOffset * DAY_MS)
            } else if (spec.outsidePast) {
              // 远在本周之前（≥10 天）
              scheduledDate = new Date(weekStart.getTime() - spec.outsideDist * DAY_MS)
            } else {
              // 远在本周之后（end + ≥3 天）
              scheduledDate = new Date(weekEnd.getTime() + spec.outsideDist * DAY_MS)
            }
            const brief: BriefLike = {
              id: `brief-${si}-${bi}`,
              title: `内容${si}-${bi}`,
              scheduledDate,
              status: spec.status,
              metrics: spec.metrics,
            }
            storeBriefs.push(brief)
            state.briefs.push({
              id: brief.id,
              storeId,
              title: brief.title,
              scheduledDate,
              status: spec.status,
              metrics: spec.metrics,
            })
          })

          expectedByStore.push({
            storeId,
            storeName: `门店${si}`,
            weekStart,
            weekEnd,
            briefs: storeBriefs,
          })
        })

        const dashboard = await getCrossStoreDashboard({ userId })

        // ── 断言 0：门店集合与顺序（按 createdAt 升序），不含其它商家门店 ──
        expect(dashboard.map((d) => d.storeId)).toEqual(expectedByStore.map((e) => e.storeId))

        for (const exp of expectedByStore) {
          const actual = dashboard.find((d) => d.storeId === exp.storeId)!
          expect(actual).toBeDefined()
          expect(actual.storeName).toBe(exp.storeName)

          // ── 断言 1：本周完成度等于独立聚合 ──
          const ec = expectedWeeklyCompletion(exp.briefs, exp.weekStart, exp.weekEnd)
          expect(actual.weeklyCompletion.total).toBe(ec.total)
          expect(actual.weeklyCompletion.completed).toBe(ec.completed)
          expect(actual.weeklyCompletion.rate).toBeCloseTo(ec.rate, 10)
          // 不占位：total=0 时 rate 必为 0
          if (ec.total === 0) expect(actual.weeklyCompletion.rate).toBe(0)

          // ── 断言 2：待办数等于独立聚合 ──
          expect(actual.todoCount).toBe(expectedTodoCount(exp.briefs))

          // ── 断言 3：最佳视频等于独立聚合；无 metrics 数据时为 null（不占位）──
          const eb = expectedBestVideo(exp.briefs)
          if (eb === null) {
            expect(actual.bestVideo).toBeNull()
          } else {
            expect(actual.bestVideo).not.toBeNull()
            expect(actual.bestVideo!.contentBriefId).toBe(eb.contentBriefId)
            expect(actual.bestVideo!.title).toBe(eb.title)
            expect(actual.bestVideo!.views).toBe(eb.views)
            expect(actual.bestVideo!.likes).toBe(eb.likes)
            expect(actual.bestVideo!.conversion).toBe(eb.conversion)
          }
        }
      }),
      { numRuns: 150 }
    )
  })

  it('示例：完全无数据的门店返回 rate=0、bestVideo=null、todoCount=0（不占位）', async () => {
    const { state } = h
    state.stores = [
      { id: 's-empty', name: '空门店', userId: 'u1', createdAt: new Date(2026, 0, 1), weeklyCadence: null },
    ]
    state.briefs = []

    const dashboard = await getCrossStoreDashboard({ userId: 'u1' })
    expect(dashboard).toHaveLength(1)
    const kpi = dashboard[0]
    expect(kpi.weeklyCompletion).toMatchObject({ total: 0, completed: 0, rate: 0 })
    expect(kpi.bestVideo).toBeNull()
    expect(kpi.todoCount).toBe(0)
  })

  it('示例：无名下门店时返回空数组（不伪造门店）', async () => {
    const { state } = h
    state.stores = [
      { id: 's-x', name: '他人门店', userId: 'someone-else', createdAt: new Date(2026, 0, 1), weeklyCadence: null },
    ]
    state.briefs = []

    const dashboard = await getCrossStoreDashboard({ userId: 'no-such-merchant' })
    expect(dashboard).toEqual([])
  })
})
