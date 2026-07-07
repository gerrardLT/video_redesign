import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'

import { checkRateLimit, isRateLimited } from '@/lib/shared/rate-limiter'

// ============================================================
// 生成器
// ============================================================

/** 每次运行生成唯一前缀，避免模块级 store 状态污染 */
let runId = 0
function uniqueKey(): string {
  return `prop-test:${Date.now()}:${++runId}`
}

/** 合法 maxRequests 范围（最少 1，最多 100） */
const maxRequestsArb = fc.integer({ min: 1, max: 100 })

/** 合法窗口时间范围（1 秒 ~ 5 分钟） */
const windowMsArb = fc.integer({ min: 1000, max: 300_000 })

/** 用户 ID 生成器 */
const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,12}$/)

/** endpoint 生成器 */
const endpointArb = fc.stringMatching(/^[a-z]{3,10}$/)

// ============================================================
// 属性测试
// ============================================================

describe('rate-limiter 属性测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runId = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // --------------------------------------------------------
  // Property 1: 窗口内限流 — 请求数 > maxRequests 时被拒绝
  // --------------------------------------------------------
  describe('Property 1: 窗口内限流', () => {
    it('在窗口期内请求数超过 maxRequests 时，后续请求被拒绝', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()

          // 消耗全部配额
          for (let i = 0; i < maxReqs; i++) {
            const result = checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
          }

          // 超额请求应被拒绝
          const rejected = checkRateLimit(key, maxReqs, windowMs)
          expect(rejected.allowed).toBe(false)
          expect(rejected.remaining).toBe(0)
        }),
        { numRuns: 100 }
      )
    })

    it('超额后持续请求仍被拒绝（不会意外放行）', () => {
      fc.assert(
        fc.property(
          maxRequestsArb,
          windowMsArb,
          fc.integer({ min: 1, max: 10 }), // 超额次数
          (maxReqs, windowMs, extraCalls) => {
            const key = uniqueKey()

            // 消耗全部配额
            for (let i = 0; i < maxReqs; i++) {
              checkRateLimit(key, maxReqs, windowMs)
            }

            // 超额后再调 extraCalls 次，每次都应被拒绝
            for (let i = 0; i < extraCalls; i++) {
              const result = checkRateLimit(key, maxReqs, windowMs)
              expect(result.allowed).toBe(false)
              expect(result.remaining).toBe(0)
            }
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 2: 窗口重置 — 窗口过期后请求重新允许
  // --------------------------------------------------------
  describe('Property 2: 窗口重置', () => {
    it('窗口过期后，相同 key 的请求重新被允许', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()

          // 消耗全部配额
          for (let i = 0; i < maxReqs; i++) {
            checkRateLimit(key, maxReqs, windowMs)
          }

          // 确认被限制
          const blocked = checkRateLimit(key, maxReqs, windowMs)
          expect(blocked.allowed).toBe(false)

          // 推进时间超过窗口
          vi.advanceTimersByTime(windowMs + 1)

          // 窗口过期后请求应重新被允许
          const afterReset = checkRateLimit(key, maxReqs, windowMs)
          expect(afterReset.allowed).toBe(true)
          expect(afterReset.remaining).toBe(maxReqs - 1)
        }),
        { numRuns: 100 }
      )
    })

    it('窗口未过期时请求仍被限制', () => {
      fc.assert(
        fc.property(
          maxRequestsArb,
          windowMsArb,
          (maxReqs, windowMs) => {
            const key = uniqueKey()

            // 消耗全部配额
            for (let i = 0; i < maxReqs; i++) {
              checkRateLimit(key, maxReqs, windowMs)
            }

            // 推进不足窗口时间（窗口的一半）
            vi.advanceTimersByTime(Math.floor(windowMs / 2))

            // 仍被限制
            const stillBlocked = checkRateLimit(key, maxReqs, windowMs)
            expect(stillBlocked.allowed).toBe(false)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 3: 不同 key 隔离 — 不同用户/IP 的限流计数互不影响
  // --------------------------------------------------------
  describe('Property 3: 不同 key 隔离', () => {
    it('不同 key 的限流计数完全独立', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const keyA = uniqueKey()
          const keyB = uniqueKey()

          // A 消耗全部配额
          for (let i = 0; i < maxReqs; i++) {
            checkRateLimit(keyA, maxReqs, windowMs)
          }

          // A 被限制
          expect(checkRateLimit(keyA, maxReqs, windowMs).allowed).toBe(false)

          // B 不受影响，仍然可以请求
          const resultB = checkRateLimit(keyB, maxReqs, windowMs)
          expect(resultB.allowed).toBe(true)
          expect(resultB.remaining).toBe(maxReqs - 1)
        }),
        { numRuns: 100 }
      )
    })

    it('isRateLimited 对不同 userId 互相隔离', () => {
      fc.assert(
        fc.property(userIdArb, userIdArb, endpointArb, (userA, userB, endpoint) => {
          fc.pre(userA !== userB)

          // 模拟 userA 被限制（默认 5 次/分钟）
          for (let i = 0; i < 5; i++) {
            checkRateLimit(`${userA}:${endpoint}`, 5, 60_000)
          }

          // userA 被限制
          expect(isRateLimited(userA, endpoint)).toBe(true)
          // userB 不受影响
          expect(isRateLimited(userB, endpoint)).toBe(false)
        }),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 4: 单调递减 — 窗口内连续请求，剩余配额单调递减
  // --------------------------------------------------------
  describe('Property 4: 单调递减', () => {
    it('窗口内每次允许的请求，remaining 严格递减', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()
          const remainings: number[] = []

          for (let i = 0; i < maxReqs; i++) {
            const result = checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
            remainings.push(result.remaining)
          }

          // 验证 remaining 严格递减
          for (let i = 1; i < remainings.length; i++) {
            expect(remainings[i]).toBeLessThan(remainings[i - 1])
          }

          // 第一次 remaining = maxReqs - 1，最后一次 remaining = 0
          expect(remainings[0]).toBe(maxReqs - 1)
          expect(remainings[remainings.length - 1]).toBe(0)
        }),
        { numRuns: 100 }
      )
    })

    it('remaining 每次恰好递减 1', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()
          const remainings: number[] = []

          for (let i = 0; i < maxReqs; i++) {
            const result = checkRateLimit(key, maxReqs, windowMs)
            remainings.push(result.remaining)
          }

          // 相邻两次 remaining 差值恰好为 1
          for (let i = 1; i < remainings.length; i++) {
            expect(remainings[i - 1] - remainings[i]).toBe(1)
          }
        }),
        { numRuns: 100 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 5: 边界正确 — 恰好 maxRequests 次允许，第 maxRequests+1 次拒绝
  // --------------------------------------------------------
  describe('Property 5: 边界正确', () => {
    it('恰好第 maxRequests 次请求被允许（remaining=0）', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()

          // 前 maxReqs-1 次
          for (let i = 0; i < maxReqs - 1; i++) {
            const result = checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
            expect(result.remaining).toBeGreaterThan(0)
          }

          // 第 maxReqs 次：允许，remaining = 0
          const boundary = checkRateLimit(key, maxReqs, windowMs)
          expect(boundary.allowed).toBe(true)
          expect(boundary.remaining).toBe(0)
        }),
        { numRuns: 100 }
      )
    })

    it('第 maxRequests+1 次请求被拒绝', () => {
      fc.assert(
        fc.property(maxRequestsArb, windowMsArb, (maxReqs, windowMs) => {
          const key = uniqueKey()

          // 消耗全部 maxReqs 次
          for (let i = 0; i < maxReqs; i++) {
            const result = checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
          }

          // 第 maxReqs+1 次：拒绝
          const overLimit = checkRateLimit(key, maxReqs, windowMs)
          expect(overLimit.allowed).toBe(false)
          expect(overLimit.remaining).toBe(0)
        }),
        { numRuns: 100 }
      )
    })

    it('maxRequests=1 时只允许 1 次请求', () => {
      fc.assert(
        fc.property(windowMsArb, (windowMs) => {
          const key = uniqueKey()

          // 第 1 次：允许
          const first = checkRateLimit(key, 1, windowMs)
          expect(first.allowed).toBe(true)
          expect(first.remaining).toBe(0)

          // 第 2 次：拒绝
          const second = checkRateLimit(key, 1, windowMs)
          expect(second.allowed).toBe(false)
          expect(second.remaining).toBe(0)
        }),
        { numRuns: 50 }
      )
    })
  })
})
