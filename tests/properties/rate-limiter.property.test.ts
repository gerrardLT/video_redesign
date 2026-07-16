import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'

// Mock Redis：使用内存 Map 模拟 Redis INCR + EXPIRE 行为
const mockStore = new Map<string, { value: number; expireAt: number }>()

vi.mock('@/lib/shared/redis', () => ({
  redis: {
    get: async (key: string) => {
      const entry = mockStore.get(key)
      if (!entry) return null
      if (Date.now() >= entry.expireAt) {
        mockStore.delete(key)
        return null
      }
      return String(entry.value)
    },
    set: async (key: string, value: string, mode: string, ttl: number) => {
      mockStore.set(key, {
        value: parseInt(value, 10),
        expireAt: Date.now() + ttl * 1000,
      })
      return 'OK'
    },
    incr: async (key: string) => {
      const entry = mockStore.get(key)
      if (!entry || Date.now() >= entry.expireAt) {
        // 不存在时不应被调用（业务逻辑保证），但兜底处理
        mockStore.set(key, { value: 1, expireAt: Date.now() + 60000 })
        return 1
      }
      entry.value++
      return entry.value
    },
    ttl: async (key: string) => {
      const entry = mockStore.get(key)
      if (!entry) return -2
      const remaining = Math.ceil((entry.expireAt - Date.now()) / 1000)
      return remaining > 0 ? remaining : -2
    },
  },
}))

import { checkRateLimit, isRateLimited } from '@/lib/shared/rate-limiter'

// ============================================================
// 生成器
// ============================================================

/** 每次运行生成唯一前缀，避免 store 状态污染 */
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

describe('rate-limiter 属性测试（Redis 版）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockStore.clear()
    runId = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // --------------------------------------------------------
  // Property 1: 窗口内限流 — 请求数 > maxRequests 时被拒绝
  // --------------------------------------------------------
  describe('Property 1: 窗口内限流', () => {
    it('在窗口期内请求数超过 maxRequests 时，后续请求被拒绝', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()

          // 消耗全部配额
          for (let i = 0; i < maxReqs; i++) {
            const result = await checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
          }

          // 超额请求应被拒绝
          const rejected = await checkRateLimit(key, maxReqs, windowMs)
          expect(rejected.allowed).toBe(false)
          expect(rejected.remaining).toBe(0)
        }),
        { numRuns: 50 }
      )
    })

    it('超额后持续请求仍被拒绝（不会意外放行）', async () => {
      await fc.assert(
        fc.asyncProperty(
          maxRequestsArb,
          windowMsArb,
          fc.integer({ min: 1, max: 10 }),
          async (maxReqs, windowMs, extraCalls) => {
            const key = uniqueKey()

            for (let i = 0; i < maxReqs; i++) {
              await checkRateLimit(key, maxReqs, windowMs)
            }

            for (let i = 0; i < extraCalls; i++) {
              const result = await checkRateLimit(key, maxReqs, windowMs)
              expect(result.allowed).toBe(false)
              expect(result.remaining).toBe(0)
            }
          }
        ),
        { numRuns: 30 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 2: 窗口重置 — 窗口过期后请求重新允许
  // --------------------------------------------------------
  describe('Property 2: 窗口重置', () => {
    it('窗口过期后，相同 key 的请求重新被允许', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()

          for (let i = 0; i < maxReqs; i++) {
            await checkRateLimit(key, maxReqs, windowMs)
          }

          const blocked = await checkRateLimit(key, maxReqs, windowMs)
          expect(blocked.allowed).toBe(false)

          // 推进时间超过窗口
          vi.advanceTimersByTime(windowMs + 1000)

          const afterReset = await checkRateLimit(key, maxReqs, windowMs)
          expect(afterReset.allowed).toBe(true)
          expect(afterReset.remaining).toBe(maxReqs - 1)
        }),
        { numRuns: 50 }
      )
    })

    it('窗口未过期时请求仍被限制', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()

          for (let i = 0; i < maxReqs; i++) {
            await checkRateLimit(key, maxReqs, windowMs)
          }

          vi.advanceTimersByTime(Math.floor(windowMs / 2))

          const stillBlocked = await checkRateLimit(key, maxReqs, windowMs)
          expect(stillBlocked.allowed).toBe(false)
        }),
        { numRuns: 30 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 3: 不同 key 隔离
  // --------------------------------------------------------
  describe('Property 3: 不同 key 隔离', () => {
    it('不同 key 的限流计数完全独立', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const keyA = uniqueKey()
          const keyB = uniqueKey()

          for (let i = 0; i < maxReqs; i++) {
            await checkRateLimit(keyA, maxReqs, windowMs)
          }

          expect((await checkRateLimit(keyA, maxReqs, windowMs)).allowed).toBe(false)

          const resultB = await checkRateLimit(keyB, maxReqs, windowMs)
          expect(resultB.allowed).toBe(true)
          expect(resultB.remaining).toBe(maxReqs - 1)
        }),
        { numRuns: 50 }
      )
    })

    it('isRateLimited 对不同 userId 互相隔离', async () => {
      await fc.assert(
        fc.asyncProperty(userIdArb, userIdArb, endpointArb, async (userA, userB, endpoint) => {
          fc.pre(userA !== userB)

          for (let i = 0; i < 5; i++) {
            await checkRateLimit(`${userA}:${endpoint}`, 5, 60_000)
          }

          expect(await isRateLimited(userA, endpoint)).toBe(true)
          expect(await isRateLimited(userB, endpoint)).toBe(false)
        }),
        { numRuns: 30 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 4: 单调递减
  // --------------------------------------------------------
  describe('Property 4: 单调递减', () => {
    it('窗口内每次允许的请求，remaining 严格递减', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()
          const remainings: number[] = []

          for (let i = 0; i < maxReqs; i++) {
            const result = await checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
            remainings.push(result.remaining)
          }

          for (let i = 1; i < remainings.length; i++) {
            expect(remainings[i]).toBeLessThan(remainings[i - 1])
          }

          expect(remainings[0]).toBe(maxReqs - 1)
          expect(remainings[remainings.length - 1]).toBe(0)
        }),
        { numRuns: 50 }
      )
    })

    it('remaining 每次恰好递减 1', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()
          const remainings: number[] = []

          for (let i = 0; i < maxReqs; i++) {
            const result = await checkRateLimit(key, maxReqs, windowMs)
            remainings.push(result.remaining)
          }

          for (let i = 1; i < remainings.length; i++) {
            expect(remainings[i - 1] - remainings[i]).toBe(1)
          }
        }),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 5: 边界正确
  // --------------------------------------------------------
  describe('Property 5: 边界正确', () => {
    it('恰好第 maxRequests 次请求被允许（remaining=0）', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()

          for (let i = 0; i < maxReqs - 1; i++) {
            const result = await checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
            expect(result.remaining).toBeGreaterThan(0)
          }

          const boundary = await checkRateLimit(key, maxReqs, windowMs)
          expect(boundary.allowed).toBe(true)
          expect(boundary.remaining).toBe(0)
        }),
        { numRuns: 50 }
      )
    })

    it('第 maxRequests+1 次请求被拒绝', async () => {
      await fc.assert(
        fc.asyncProperty(maxRequestsArb, windowMsArb, async (maxReqs, windowMs) => {
          const key = uniqueKey()

          for (let i = 0; i < maxReqs; i++) {
            const result = await checkRateLimit(key, maxReqs, windowMs)
            expect(result.allowed).toBe(true)
          }

          const overLimit = await checkRateLimit(key, maxReqs, windowMs)
          expect(overLimit.allowed).toBe(false)
          expect(overLimit.remaining).toBe(0)
        }),
        { numRuns: 50 }
      )
    })

    it('maxRequests=1 时只允许 1 次请求', async () => {
      await fc.assert(
        fc.asyncProperty(windowMsArb, async (windowMs) => {
          const key = uniqueKey()

          const first = await checkRateLimit(key, 1, windowMs)
          expect(first.allowed).toBe(true)
          expect(first.remaining).toBe(0)

          const second = await checkRateLimit(key, 1, windowMs)
          expect(second.allowed).toBe(false)
          expect(second.remaining).toBe(0)
        }),
        { numRuns: 30 }
      )
    })
  })
})
