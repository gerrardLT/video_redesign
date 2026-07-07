/**
 * 分镜分组服务（Grouping_Service）属性化测试
 *
 * 使用 fast-check 随机生成有效分镜列表，验证 groupShots 纯函数的通用不变量。
 * 每条属性至少运行 100 次随机迭代。
 *
 * groupShots 语义（见 grouping-service.ts）：
 * - 每个 shot 优先独立成组
 * - 时长 <4s 的 shot 向前合并进上一组，前提是：合并后 rawDuration ≤15s 且组内 shot 数 <3
 * - genDuration = clamp(ceil(rawDuration), 4, 15)
 * - groupIndex 从 0 起连续递增
 *
 * 注意：groupShots 不含「每组脚本字数 ≤N」约束——脚本长度由 script-merger.ts
 * 的 MAX_SCRIPT_LENGTH=250 在合并阶段单独约束，与分组无关。
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  groupShots,
  MAX_GROUP_DURATION,
  MIN_GROUP_DURATION,
  type GroupingInputShot,
} from '@/lib/video/grouping-service'

// 每组最大 shot 数（grouping-service 内部常量，未导出，此处镜像用于断言）
const MAX_SHOTS_PER_GROUP = 3

// ============================================================
// 生成器：生成有效分镜列表
// ============================================================

// 覆盖 <4s（触发向前合并）、4~15s（独立成组）、>15s（单组超限被 clamp）三类时长
const shotDurationArb = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: 0.01, max: 3.99, noNaN: true }) },
  { weight: 5, arbitrary: fc.double({ min: 4, max: 15, noNaN: true }) },
  { weight: 2, arbitrary: fc.double({ min: 15.01, max: 60, noNaN: true }) },
)

/**
 * 生成有效分镜列表：
 * - orderIndex 从 0 起连续递增
 * - startTime < endTime
 * - 允许 shot 之间存在 gap（startTime 不一定紧接上一个 endTime），
 *   以验证组边界基于成员 shot 自身的 startTime/endTime，而非时间轴连续假设
 */
function buildShots(
  specs: Array<{ duration: number; gap: number }>
): GroupingInputShot[] {
  let currentTime = 0
  return specs.map((spec, index) => {
    const startTime = currentTime + spec.gap
    const endTime = startTime + spec.duration
    currentTime = endTime
    return { orderIndex: index, startTime, endTime }
  })
}

const specArb = fc.record({
  duration: shotDurationArb,
  gap: fc.double({ min: 0, max: 5, noNaN: true }),
})

const validShotListArb: fc.Arbitrary<GroupingInputShot[]> = fc
  .array(specArb, { minLength: 0, maxLength: 30 })
  .map(buildShots)

const nonEmptyShotListArb: fc.Arbitrary<GroupingInputShot[]> = fc
  .array(specArb, { minLength: 1, maxLength: 30 })
  .map(buildShots)

describe('Grouping_Service (groupShots) 属性测试', () => {
  // ============================================================
  // Property 1: 分组划分完备性（每个分镜恰好归属一个组）
  // ============================================================

  it('Property 1: 所有组内 orderIndex 的并集等于输入全集，且无重复', () => {
    fc.assert(
      fc.property(validShotListArb, (shots) => {
        const groups = groupShots(shots)
        const allOrderIndexes = groups.flatMap((g) => g.shotOrderIndexes)
        const inputOrderIndexes = shots.map((s) => s.orderIndex)

        expect([...allOrderIndexes].sort((a, b) => a - b)).toEqual(
          [...inputOrderIndexes].sort((a, b) => a - b)
        )
        const uniqueSet = new Set(allOrderIndexes)
        expect(uniqueSet.size).toBe(allOrderIndexes.length)
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 2: 组内连续升序、组间衔接连续、整体升序
  // ============================================================

  it('Property 2: 组内 orderIndex 连续升序、组间衔接连续、整体升序', () => {
    fc.assert(
      fc.property(nonEmptyShotListArb, (shots) => {
        const groups = groupShots(shots)

        for (const group of groups) {
          const indexes = group.shotOrderIndexes
          for (let i = 1; i < indexes.length; i++) {
            expect(indexes[i]).toBe(indexes[i - 1] + 1)
          }
        }

        for (let g = 1; g < groups.length; g++) {
          const prevLast = groups[g - 1].shotOrderIndexes.at(-1)!
          const currFirst = groups[g].shotOrderIndexes[0]
          expect(currFirst).toBe(prevLast + 1)
        }

        const allIndexes = groups.flatMap((g) => g.shotOrderIndexes)
        for (let i = 1; i < allIndexes.length; i++) {
          expect(allIndexes[i]).toBeGreaterThan(allIndexes[i - 1])
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 3: groupIndex 从 0 起连续递增（0..n-1）
  // ============================================================

  it('Property 3: groupIndex 为 0..n-1 连续递增', () => {
    fc.assert(
      fc.property(validShotListArb, (shots) => {
        const groups = groupShots(shots)
        for (let i = 0; i < groups.length; i++) {
          expect(groups[i].groupIndex).toBe(i)
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 4: 每组 shot 数 ≤ 3（MAX_SHOTS_PER_GROUP）
  // ============================================================

  it('Property 4: 每组包含的 shot 数 ≤ 3', () => {
    fc.assert(
      fc.property(nonEmptyShotListArb, (shots) => {
        const groups = groupShots(shots)
        for (const group of groups) {
          expect(group.shotOrderIndexes.length).toBeLessThanOrEqual(MAX_SHOTS_PER_GROUP)
          expect(group.shotOrderIndexes.length).toBeGreaterThanOrEqual(1)
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 5: 生成时长收口（向上取整并约束在 [4,15]）
  // ============================================================

  it('Property 5: genDuration 为整数、落在 [4,15]、等于 clamp(ceil(rawDuration), 4, 15)', () => {
    fc.assert(
      fc.property(nonEmptyShotListArb, (shots) => {
        const groups = groupShots(shots)
        for (const group of groups) {
          expect(Number.isInteger(group.genDuration)).toBe(true)
          expect(group.genDuration).toBeGreaterThanOrEqual(MIN_GROUP_DURATION)
          expect(group.genDuration).toBeLessThanOrEqual(MAX_GROUP_DURATION)
          const expected = Math.min(
            Math.max(Math.ceil(group.rawDuration), MIN_GROUP_DURATION),
            MAX_GROUP_DURATION
          )
          expect(group.genDuration).toBe(expected)
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 6: 组边界与 rawDuration 对齐成员 shot
  // ============================================================

  it('Property 6: 组 startTime/endTime 对齐首末成员 shot，rawDuration 等于成员时长之和', () => {
    fc.assert(
      fc.property(nonEmptyShotListArb, (shots) => {
        const groups = groupShots(shots)
        const byIndex = new Map(shots.map((s) => [s.orderIndex, s]))

        for (const group of groups) {
          const firstShot = byIndex.get(group.shotOrderIndexes[0])!
          const lastShot = byIndex.get(group.shotOrderIndexes.at(-1)!)!

          expect(group.startTime).toBeCloseTo(firstShot.startTime, 10)
          expect(group.endTime).toBeCloseTo(lastShot.endTime, 10)

          const sumDurations = group.shotOrderIndexes.reduce((acc, oi) => {
            const s = byIndex.get(oi)!
            return acc + (s.endTime - s.startTime)
          }, 0)
          expect(group.rawDuration).toBeCloseTo(sumDurations, 10)
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // Property 7: 含 ≥2 分镜的组 rawDuration ≤ 15s
  // （向前合并的硬约束：合并后 rawDuration ≤ MAX_GROUP_DURATION）
  // ============================================================

  it('Property 7: 含 ≥2 分镜的组 rawDuration ≤ 15s', () => {
    fc.assert(
      fc.property(nonEmptyShotListArb, (shots) => {
        const groups = groupShots(shots)
        for (const group of groups) {
          if (group.shotOrderIndexes.length >= 2) {
            expect(group.rawDuration).toBeLessThanOrEqual(MAX_GROUP_DURATION + 1e-9)
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  // ============================================================
  // 空输入示例
  // ============================================================

  it('空输入示例：groupShots([]) 返回 [] 且不抛错', () => {
    expect(groupShots([])).toEqual([])
  })

  // ============================================================
  // 行为示例：<4s 的 shot 向前合并
  // ============================================================

  it('示例：<4s 的 shot 向前合并进上一组', () => {
    const shots: GroupingInputShot[] = [
      { orderIndex: 0, startTime: 0, endTime: 5 }, // 5s，独立
      { orderIndex: 1, startTime: 5, endTime: 7 }, // 2s <4s → 向前合并
    ]
    const groups = groupShots(shots)
    expect(groups).toHaveLength(1)
    expect(groups[0].shotOrderIndexes).toEqual([0, 1])
    expect(groups[0].rawDuration).toBeCloseTo(7, 10)
    expect(groups[0].genDuration).toBe(7)
  })

  it('示例：首个 shot 即使 <4s 也独立成组（无前序组可合并），genDuration clamp 到 4', () => {
    const shots: GroupingInputShot[] = [{ orderIndex: 0, startTime: 0, endTime: 2 }]
    const groups = groupShots(shots)
    expect(groups).toHaveLength(1)
    expect(groups[0].shotOrderIndexes).toEqual([0])
    expect(groups[0].genDuration).toBe(MIN_GROUP_DURATION)
  })

  it('示例：合并会使 rawDuration >15s 时不合并，<4s shot 独立成组', () => {
    const shots: GroupingInputShot[] = [
      { orderIndex: 0, startTime: 0, endTime: 14 }, // 14s
      { orderIndex: 1, startTime: 14, endTime: 17 }, // 3s <4s，但 14+3=17>15 → 独立
    ]
    const groups = groupShots(shots)
    expect(groups).toHaveLength(2)
    expect(groups[0].shotOrderIndexes).toEqual([0])
    expect(groups[1].shotOrderIndexes).toEqual([1])
  })

  it('示例：上一组已含 3 个 shot 时不再合并', () => {
    const shots: GroupingInputShot[] = [
      { orderIndex: 0, startTime: 0, endTime: 5 }, // 5s
      { orderIndex: 1, startTime: 5, endTime: 7 }, // 2s → 合并 (count=2)
      { orderIndex: 2, startTime: 7, endTime: 9 }, // 2s → 合并 (count=3)
      { orderIndex: 3, startTime: 9, endTime: 11 }, // 2s → 组已满 → 独立
    ]
    const groups = groupShots(shots)
    expect(groups).toHaveLength(2)
    expect(groups[0].shotOrderIndexes).toEqual([0, 1, 2])
    expect(groups[1].shotOrderIndexes).toEqual([3])
  })

  it('示例：每个 ≥4s 的 shot 各自独立成组', () => {
    const shots: GroupingInputShot[] = [
      { orderIndex: 0, startTime: 0, endTime: 5 },
      { orderIndex: 1, startTime: 5, endTime: 11 },
      { orderIndex: 2, startTime: 11, endTime: 18 },
    ]
    const groups = groupShots(shots)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.shotOrderIndexes)).toEqual([[0], [1], [2]])
  })
})
