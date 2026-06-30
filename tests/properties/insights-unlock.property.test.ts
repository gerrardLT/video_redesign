// Feature: local-life-depth-enhancements, Property 7: 复盘解锁门槛
//
// 属性测试：带 metrics 的 brief 数量 n，当 n<3 时系统返回空建议并提示剩余 3-n 条，绝不伪造建议。
// 被测：src/lib/performance-learning-service.ts 的 getInsightsUnlockGate
// 解锁阈值 MIN_METRICS_BRIEFS = 3；n<3 时返回 { unlocked:false, remaining:3-n }，不渲染建议。
// 对 prisma.contentBrief.count 做内存桩返回 n∈[0,2]，断言 unlocked=false 且 remaining=3-n。
//
// **Validates: Requirements 1.6**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ============================================================
// 内存桩：拦截 @/lib/db 的 prisma.contentBrief.count
// 用可变变量 stubbedCount 控制每次迭代返回的「带 metrics 的 brief 数量」
// ============================================================
const { countMock } = vi.hoisted(() => ({ countMock: vi.fn() }))

vi.mock('@/lib/db', () => ({
  prisma: {
    contentBrief: {
      count: countMock,
    },
  },
}))

import { getInsightsUnlockGate } from '@/lib/performance-learning-service'

const MIN_METRICS_BRIEFS = 3

describe('Property 7: 复盘解锁门槛', () => {
  beforeEach(() => {
    countMock.mockReset()
  })

  /**
   * 对任意 n ∈ [0, 2]（带 metrics 的 brief 数量不足解锁阈值 3 条）：
   * - getInsightsUnlockGate 必返回 unlocked=false
   * - remaining 必恰等于 3 - n（提示「再录入 N 条即可解锁」）
   * - 结果中不得出现 insights 字段（绝不伪造建议）
   *
   * **Validates: Requirements 1.6**
   */
  it('n<3 时返回 unlocked=false 且 remaining=3-n，不伪造建议', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: MIN_METRICS_BRIEFS - 1 }), async (n) => {
        // 内存桩：本门店带 metrics 的 brief 数量为 n
        countMock.mockResolvedValue(n)

        const result = await getInsightsUnlockGate({ storeId: 'store-test' })

        // 未解锁
        expect(result.unlocked).toBe(false)
        // 剩余条数恰为 3 - n
        expect((result as { unlocked: false; remaining: number }).remaining).toBe(
          MIN_METRICS_BRIEFS - n
        )
        // 绝不伪造建议：未解锁结果不得携带 insights
        expect('insights' in result).toBe(false)
      }),
      { numRuns: 100 }
    )
  })
})
