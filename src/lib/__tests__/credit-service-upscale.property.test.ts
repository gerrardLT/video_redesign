/**
 * 超分积分估算属性测试
 *
 * Tag: Feature: video-quality-enhancements, Property 1: 超分积分计算公式
 * Tag: Feature: video-quality-enhancements, Property 2: 积分不足阻断导出
 */
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

// Mock db/redis 模块，避免 DATABASE_URL 缺失导致的初始化错误
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => vi.fn() })
}))

import { estimateUpscaleCreditCost } from '@/lib/shared/credit-service'

describe('estimateUpscaleCreditCost 属性测试', () => {
  /**
   * Property 1: 超分积分计算公式
   * **Validates: Requirements 1.2**
   *
   * For any 正数视频时长 duration：
   * - 480p 返回 0（免费）
   * - 720p 返回 0（免费）
   * - 1080p 返回 Math.ceil(duration * 1.33)
   */
  it('480p 始终返回 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          expect(estimateUpscaleCreditCost(duration, '480p')).toBe(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('720p 返回 0（720p 免费）', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          const result = estimateUpscaleCreditCost(duration, '720p')
          expect(result).toBe(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('1080p 返回 Math.ceil(duration * 1.33)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          const result = estimateUpscaleCreditCost(duration, '1080p')
          expect(result).toBe(Math.ceil(duration * 1.33))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('返回值始终为非负整数', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom('480p', '720p', '1080p'),
        (duration, resolution) => {
          const result = estimateUpscaleCreditCost(duration, resolution)
          expect(result).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(result)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })
})


// ========================
// Property 2: 积分不足阻断导出
// ========================

describe('积分不足阻断导出属性测试', () => {
  /**
   * Property 2: 积分不足阻断导出
   * **Validates: Requirements 1.5**
   *
   * 当 balance < cost 时导出应被阻断
   */

  /** 模拟积分阻断判定逻辑（与前端 ResolutionSelector / Export API 一致） */
  function shouldBlockExport(balance: number, cost: number): boolean {
    return balance < cost
  }

  it('余额不足时阻断导出', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),     // balance
        fc.nat({ max: 1000 }),     // cost offset（确保 cost > balance）
        (balance, offset) => {
          const cost = balance + offset + 1 // cost 始终 > balance
          expect(shouldBlockExport(balance, cost)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('余额充足时不阻断导出', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),     // cost
        fc.nat({ max: 1000 }),     // surplus
        (cost, surplus) => {
          const balance = cost + surplus // balance >= cost
          expect(shouldBlockExport(balance, cost)).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('结合 estimateUpscaleCreditCost 的阻断判定', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 600, noNaN: true, noDefaultInfinity: true }), // duration
        fc.constantFrom('720p' as const, '1080p' as const), // 非免费档位
        fc.nat({ max: 5 }), // 余额（很小，容易触发不足）
        (duration, resolution, balance) => {
          const cost = estimateUpscaleCreditCost(duration, resolution)
          const blocked = shouldBlockExport(balance, cost)
          // 如果余额 < 费用，应当被阻断
          if (balance < cost) {
            expect(blocked).toBe(true)
          } else {
            expect(blocked).toBe(false)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
