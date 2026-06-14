import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { groupShots, type GroupingInputShot } from '@/lib/grouping-service'
import { estimateGroupCreditCost } from '@/lib/credit-service'

/**
 * 属性测试文件：音频切片区间对齐 + 按组计费公式
 * 覆盖 Property 8 与 Property 9
 */

// ============================================================
// 生成器：有效分镜列表（orderIndex 连续升序、startTime < endTime）
// ============================================================

/**
 * 生成有效的 GroupingInputShot 列表
 * - orderIndex 从 0 起连续升序
 * - 每个 shot 的 startTime < endTime
 * - 时间轴不要求连续（允许 gap），但 startTime 按 orderIndex 递增
 * - duration 取 [0.5, 25]，覆盖 <4s（触发向前合并）与 ≥4s（独立成组）两种情况
 */
const validShotListArb = fc
  .array(
    fc.record({
      duration: fc.double({ min: 0.5, max: 25, noNaN: true }),
      gap: fc.double({ min: 0, max: 5, noNaN: true }),
    }),
    { minLength: 1, maxLength: 20 }
  )
  .map((items) => {
    const shots: GroupingInputShot[] = []
    let currentTime = 0
    for (let i = 0; i < items.length; i++) {
      const startTime = currentTime + items[i].gap
      const endTime = startTime + items[i].duration
      shots.push({ orderIndex: i, startTime, endTime })
      currentTime = endTime
    }
    return shots
  })

// ============================================================
// Property 8: 音频切片区间对齐组边界
// Feature: multi-shot-merge-generation, Property 8: 音频切片区间对齐组边界
// ============================================================

describe('Property 8: 音频切片区间对齐组边界', () => {
  /**
   * 对任意非空分镜组，计算出的音频切片区间起点等于组内首个 Shot 的 startTime，
   * 终点等于末个 Shot 的 endTime。
   *
   * 验证方式：调用 groupShots 后，每个 ShotGroupPlan 的 startTime 等于组内首 shot 的 startTime，
   * endTime 等于末 shot 的 endTime（这就是 extractGroupAudio 使用的切片区间）。
   *
   * **Validates: Requirements 4.2**
   */
  it('每组的 startTime 等于组内首 shot 的 startTime，endTime 等于末 shot 的 endTime', () => {
    fc.assert(
      fc.property(validShotListArb, (shots) => {
        const plans = groupShots(shots)

        // 非空输入产出非空分组
        expect(plans.length).toBeGreaterThan(0)

        // 按 orderIndex 排序后的 shots 方便按 orderIndex 查找
        const sortedShots = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

        for (const plan of plans) {
          // 组内 Shot orderIndexes
          const groupOrderIndexes = plan.shotOrderIndexes
          expect(groupOrderIndexes.length).toBeGreaterThan(0)

          // 找到组内首 shot 和末 shot
          const firstOrderIndex = groupOrderIndexes[0]
          const lastOrderIndex = groupOrderIndexes[groupOrderIndexes.length - 1]

          const firstShot = sortedShots.find((s) => s.orderIndex === firstOrderIndex)!
          const lastShot = sortedShots.find((s) => s.orderIndex === lastOrderIndex)!

          // 音频切片区间 = [plan.startTime, plan.endTime]
          // 必须对齐组边界：起点 = 首 shot startTime，终点 = 末 shot endTime
          expect(plan.startTime).toBeCloseTo(firstShot.startTime, 10)
          expect(plan.endTime).toBeCloseTo(lastShot.endTime, 10)
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 9: 按组时长计费公式
// Feature: multi-shot-merge-generation, Property 9: 按组时长计费公式
// ============================================================

describe('Property 9: 按组时长计费公式', () => {
  /**
   * 对任意落在 [4,15] 的组时长与受支持的分辨率（'480p'|'720p'），
   * estimateGroupCreditCost 返回值等于 ceil(groupDuration × (resolution==='720p' ? 1.5 : 1.0))，
   * 且恒为正整数。
   *
   * **Validates: Requirements 8.1, 8.7**
   */
  it('返回值等于 ceil(groupDuration × multiplier) 且为正整数', () => {
    fc.assert(
      fc.property(
        // groupDuration ∈ [4, 15]，包括整数和浮点
        fc.double({ min: 4, max: 15, noNaN: true }),
        // resolution ∈ ['480p', '720p']
        fc.constantFrom('480p', '720p'),
        (groupDuration, resolution) => {
          const cost = estimateGroupCreditCost(groupDuration, resolution)
          const multiplier = resolution === '720p' ? 1.5 : 1.0
          const expected = Math.ceil(groupDuration * multiplier)

          // 返回值等于公式计算结果
          expect(cost).toBe(expected)

          // 恒为正整数
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('整数组时长也满足公式', () => {
    fc.assert(
      fc.property(
        // 整数版本 groupDuration ∈ [4, 15]
        fc.integer({ min: 4, max: 15 }),
        fc.constantFrom('480p', '720p'),
        (groupDuration, resolution) => {
          const cost = estimateGroupCreditCost(groupDuration, resolution)
          const multiplier = resolution === '720p' ? 1.5 : 1.0
          const expected = Math.ceil(groupDuration * multiplier)

          expect(cost).toBe(expected)
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})
