// Feature: local-life-depth-enhancements, Property 36: 连续创作计算正确

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Property 36: 连续创作计算正确
 *
 * For any 发布日期集合（按 period-service 口径），computeStreak 返回的 days/weeks SHALL
 * 等于「以当前周期为终点的最大连续发布段长度」；统计 SHALL 仅基于真实发布数据。
 * 空集合 SHALL 返回 { days:0, weeks:0 }。
 *
 * 测试策略：
 * - 被测纯函数为 engagement-service.computeStreak（已抽出，便于测试）；该函数不访问数据库，
 *   但其所在模块顶层 import 了 @/lib/db（无 DATABASE_URL 时会抛错），故对 @/lib/db 做最小内存桩。
 * - period-service 为周期口径单点真源（自带单元测试），本测试将其作为可信 oracle：
 *   参考实现复用 resolvePeriods / periodIndexOf 确定「周」的归属，再用与被测实现「不同的
 *   计数写法」（按日期键排序逐日回溯 / 按相对序号逐周回溯）独立推导期望的最大连续段长度，
 *   从而能捕获 computeStreak 在去重、跨度计算、回溯计数上的偏差。
 * - 生成器以「相对基准日的天偏移」构造发布日期（含乱序 / 重复 / 间断 / 未来日），
 *   覆盖连续、断裂、跨周等形态。
 *
 * **Validates: Requirements 11.1, 11.5**
 */

// ========================
// Mock Prisma（computeStreak 不使用 prisma，仅为规避模块顶层 import 副作用）
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {},
}))

const { computeStreak } = await import('@/lib/merchant/engagement-service')
const { resolvePeriods, periodIndexOf } = await import('@/lib/merchant/period-service')

// ========================
// 纯日期工具（测试自带，保持与被测实现独立）
// ========================

const DAY_MS = 24 * 60 * 60 * 1000

/** 某日期所在本地自然日的 00:00 */
function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/** 在本地 00:00 基础上偏移若干天（自动处理跨月 / 跨年 / 夏令时） */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0)
}

/** 以某本地自然日为基础，叠加时分构造具体时刻（保证 localMidnight 仍归一到该日） */
function withTime(mid: Date, hour: number, minute: number): Date {
  return new Date(mid.getFullYear(), mid.getMonth(), mid.getDate(), hour, minute, 0, 0)
}

// ========================
// 参考实现（oracle）—— 与被测实现采用不同的计数写法
// ========================

function referenceStreak(input: {
  publishDates: Date[]
  weeklyCadence: unknown
  referenceDate: Date
}): { days: number; weeks: number } {
  const { publishDates, weeklyCadence, referenceDate } = input

  if (publishDates.length === 0) {
    return { days: 0, weeks: 0 }
  }

  const refMid = localMidnight(referenceDate)

  // ─── days：去重后的发布自然日按时间「降序」排列，从基准日逐日回溯，缺一即止 ───
  const uniqueDayMs = [...new Set(publishDates.map((d) => localMidnight(d).getTime()))].sort(
    (a, b) => b - a,
  )
  let days = 0
  let expectedMs = refMid.getTime()
  for (const dms of uniqueDayMs) {
    if (dms > expectedMs) continue // 未来日（晚于当前游标），跳过
    if (dms === expectedMs) {
      days++
      expectedMs = addDays(new Date(expectedMs), -1).getTime()
    } else {
      break // 出现缺口（期望日无发布），连续天数终止
    }
  }

  // ─── weeks：按 period-service 口径把每个发布日归入周期序号，再从 index 0 逐周回溯 ───
  let earliestMs = Number.POSITIVE_INFINITY
  for (const d of publishDates) {
    const ms = localMidnight(d).getTime()
    if (ms < earliestMs) earliestMs = ms
  }
  const span = Math.max(1, Math.ceil((refMid.getTime() - earliestMs) / (7 * DAY_MS)) + 5)
  const ranges = resolvePeriods({ weeklyCadence, referenceDate, count: span })

  const activeIndices = new Set<number>()
  for (const d of publishDates) {
    const idx = periodIndexOf(localMidnight(d), ranges)
    if (idx !== null) activeIndices.add(idx)
  }

  let weeks = 0
  while (activeIndices.has(-weeks)) {
    weeks++
  }

  return { days, weeks }
}

// ========================
// 生成器
// ========================

/** 固定锚点（本地时间），基准日 = 锚点 + 随机天偏移，避开极端历史 */
const ANCHOR = new Date(2021, 5, 15, 0, 0, 0, 0)

/** weeklyCadence 配置：null（默认自然周）或带 day(1-7) 的条目数组 */
const weeklyCadenceArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant('非法配置'),
  fc.array(
    fc.record({
      day: fc.integer({ min: 1, max: 7 }),
      theme: fc.string(),
      count: fc.integer({ min: 1, max: 5 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
)

/** 单条发布记录的「相对基准日天偏移 + 时分」：负偏移=未来日，正偏移=过去日 */
const offsetEntryArb = fc.record({
  offset: fc.integer({ min: -3, max: 70 }),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
})

const scenarioArb = fc.record({
  refOffsetDays: fc.integer({ min: 0, max: 4000 }),
  refHour: fc.integer({ min: 0, max: 23 }),
  refMinute: fc.integer({ min: 0, max: 59 }),
  weeklyCadence: weeklyCadenceArb,
  entries: fc.array(offsetEntryArb, { maxLength: 40 }),
})

/** 由场景构造 referenceDate 与（可乱序 / 重复的）publishDates */
function buildInputs(s: {
  refOffsetDays: number
  refHour: number
  refMinute: number
  weeklyCadence: unknown
  entries: { offset: number; hour: number; minute: number }[]
}): { publishDates: Date[]; weeklyCadence: unknown; referenceDate: Date } {
  const refMid = addDays(ANCHOR, s.refOffsetDays)
  const referenceDate = withTime(refMid, s.refHour, s.refMinute)

  const publishDates = s.entries.map((e) => {
    const dayMid = addDays(refMid, -e.offset)
    return withTime(dayMid, e.hour, e.minute)
  })

  return { publishDates, weeklyCadence: s.weeklyCadence, referenceDate }
}

// ========================
// 属性
// ========================

describe('连续创作计算正确 Property (Property 36)', () => {
  it('computeStreak 的 days/weeks 等于以当前周期为终点的最大连续发布段（参考实现一致）', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const input = buildInputs(s)
        const actual = computeStreak(input)
        const expected = referenceStreak(input)

        expect(actual.days).toBe(expected.days)
        expect(actual.weeks).toBe(expected.weeks)
      }),
      { numRuns: 250 },
    )
  })

  it('对发布日期集合乱序 / 重复不敏感（结果仅取决于集合本身）', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        fc.array(fc.integer({ min: 0 }), { maxLength: 10 }),
        (s, shufflePicks) => {
          const input = buildInputs(s)
          const base = computeStreak(input)

          // 通过追加重复项并旋转顺序构造等价集合
          const dup = [...input.publishDates]
          for (const p of shufflePicks) {
            if (input.publishDates.length > 0) {
              dup.push(input.publishDates[p % input.publishDates.length]!)
            }
          }
          const rotate = dup.length > 1 ? dup.slice(1).concat(dup.slice(0, 1)) : dup
          const permuted = computeStreak({ ...input, publishDates: rotate.reverse() })

          expect(permuted.days).toBe(base.days)
          expect(permuted.weeks).toBe(base.weeks)
        },
      ),
      { numRuns: 150 },
    )
  })

  it('空集合返回 { days:0, weeks:0 }', () => {
    fc.assert(
      fc.property(
        fc.record({
          refOffsetDays: fc.integer({ min: 0, max: 4000 }),
          refHour: fc.integer({ min: 0, max: 23 }),
          refMinute: fc.integer({ min: 0, max: 59 }),
          weeklyCadence: weeklyCadenceArb,
        }),
        (s) => {
          const refMid = addDays(ANCHOR, s.refOffsetDays)
          const result = computeStreak({
            publishDates: [],
            weeklyCadence: s.weeklyCadence,
            referenceDate: withTime(refMid, s.refHour, s.refMinute),
          })
          expect(result).toEqual({ days: 0, weeks: 0 })
        },
      ),
      { numRuns: 100 },
    )
  })

  it('基准日当日无发布时连续天数为 0', () => {
    fc.assert(
      fc.property(
        fc.record({
          refOffsetDays: fc.integer({ min: 0, max: 4000 }),
          weeklyCadence: weeklyCadenceArb,
          // 仅过去日（offset >= 1），保证基准日当日（offset 0）一定无发布
          entries: fc.array(
            fc.record({
              offset: fc.integer({ min: 1, max: 70 }),
              hour: fc.integer({ min: 0, max: 23 }),
              minute: fc.integer({ min: 0, max: 59 }),
            }),
            { minLength: 1, maxLength: 30 },
          ),
        }),
        (s) => {
          const input = buildInputs({ ...s, refHour: 12, refMinute: 0 })
          const result = computeStreak(input)
          expect(result.days).toBe(0)
        },
      ),
      { numRuns: 120 },
    )
  })
})
