// Feature: local-life-depth-enhancements, Property 26: 抓取频率门控
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

// Mock db/redis 模块，避免 DATABASE_URL 缺失导致的初始化错误
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => vi.fn() })
}))

import {
  isCrawlAllowed,
  clampCrawlIntervalHours,
  MIN_CRAWL_INTERVAL_HOURS,
  MAX_CRAWL_INTERVAL_HOURS,
  DEFAULT_CRAWL_INTERVAL_HOURS,
} from '@/lib/merchant/platform-metrics-crawler'

/**
 * Property 26: 抓取频率门控
 * Validates: Requirements 7.5
 *
 * 验证 platform-metrics-crawler 的两个纯函数：
 *  - clampCrawlIntervalHours：把任意配置间隔夹紧到系统允许区间 [6,24] 小时；
 *  - isCrawlAllowed：当且仅当 (now - lastCrawledAt) >= 夹紧后的间隔毫秒数 时允许抓取；
 *    lastCrawledAt 为 null（从未抓取）时恒允许。
 *
 * 直接导入生产代码，纯函数不依赖 DB/外部服务，无 mock；fast-check ≥100 次迭代，Node 环境。
 */

const HOUR_MS = 60 * 60 * 1000

describe('Property 26: 抓取频率门控（crawl throttle gating）', () => {
  // 任意整数小时（含越界值），用于覆盖夹紧逻辑
  const arbIntervalH = fc.integer({ min: -100, max: 200 })
  // 基准时间戳：选取一个合理的近现代区间，避免无意义极端值
  const arbBaseEpoch = fc.integer({ min: 0, max: 4_102_444_800_000 }) // 0 ~ 2100-01-01

  it('lastCrawledAt 为 null 时恒允许抓取', () => {
    fc.assert(
      fc.property(arbIntervalH, arbBaseEpoch, (intervalH, nowEpoch) => {
        const allowed = isCrawlAllowed({
          lastCrawledAt: null,
          intervalH,
          now: new Date(nowEpoch),
        })
        expect(allowed).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it('允许 当且仅当 now - lastCrawledAt >= clampCrawlIntervalHours(intervalH)*3600*1000', () => {
    fc.assert(
      fc.property(
        arbBaseEpoch,
        arbIntervalH,
        // 相对 lastCrawledAt 的时间偏移（毫秒），覆盖临界点附近与远端
        fc.integer({ min: -50 * HOUR_MS, max: 50 * HOUR_MS }),
        (lastEpoch, intervalH, deltaMs) => {
          const lastCrawledAt = new Date(lastEpoch)
          const now = new Date(lastEpoch + deltaMs)
          const intervalMs = clampCrawlIntervalHours(intervalH) * HOUR_MS

          const allowed = isCrawlAllowed({ lastCrawledAt, intervalH, now })
          const expected = now.getTime() - lastCrawledAt.getTime() >= intervalMs

          expect(allowed).toBe(expected)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('恰在间隔边界处（now - last === interval）允许抓取', () => {
    fc.assert(
      fc.property(arbBaseEpoch, arbIntervalH, (lastEpoch, intervalH) => {
        const lastCrawledAt = new Date(lastEpoch)
        const intervalMs = clampCrawlIntervalHours(intervalH) * HOUR_MS
        const now = new Date(lastEpoch + intervalMs) // 恰好等于间隔
        expect(isCrawlAllowed({ lastCrawledAt, intervalH, now })).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it('恰差 1 毫秒未到间隔时拒绝抓取', () => {
    fc.assert(
      fc.property(arbBaseEpoch, arbIntervalH, (lastEpoch, intervalH) => {
        const lastCrawledAt = new Date(lastEpoch)
        const intervalMs = clampCrawlIntervalHours(intervalH) * HOUR_MS
        const now = new Date(lastEpoch + intervalMs - 1) // 差 1ms 未到
        expect(isCrawlAllowed({ lastCrawledAt, intervalH, now })).toBe(false)
      }),
      { numRuns: 200 }
    )
  })

  it('clampCrawlIntervalHours 将间隔夹紧到 [6,24] 小时', () => {
    fc.assert(
      fc.property(arbIntervalH, (intervalH) => {
        const clamped = clampCrawlIntervalHours(intervalH)
        // 结果必落在系统允许的上下界内
        expect(clamped).toBeGreaterThanOrEqual(MIN_CRAWL_INTERVAL_HOURS)
        expect(clamped).toBeLessThanOrEqual(MAX_CRAWL_INTERVAL_HOURS)
        // 与显式边界保持一致
        expect(MIN_CRAWL_INTERVAL_HOURS).toBe(6)
        expect(MAX_CRAWL_INTERVAL_HOURS).toBe(24)
        // 区间内（截断后）的值应原样保留
        const truncated = Math.trunc(intervalH)
        if (truncated >= MIN_CRAWL_INTERVAL_HOURS && truncated <= MAX_CRAWL_INTERVAL_HOURS) {
          expect(clamped).toBe(truncated)
        } else if (truncated < MIN_CRAWL_INTERVAL_HOURS) {
          expect(clamped).toBe(MIN_CRAWL_INTERVAL_HOURS)
        } else {
          expect(clamped).toBe(MAX_CRAWL_INTERVAL_HOURS)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('非有限间隔值回退为默认间隔并仍落在 [6,24]', () => {
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity), (bad) => {
        const clamped = clampCrawlIntervalHours(bad)
        expect(clamped).toBe(DEFAULT_CRAWL_INTERVAL_HOURS)
        expect(clamped).toBeGreaterThanOrEqual(MIN_CRAWL_INTERVAL_HOURS)
        expect(clamped).toBeLessThanOrEqual(MAX_CRAWL_INTERVAL_HOURS)
      }),
      { numRuns: 100 }
    )
  })
})
