/**
 * Property-Based Test: repairTimeline 输出不变量
 * Feature: production-reliability, Property 6: 时间线修正后不变量
 *
 * Validates: Requirements 10.4, 10.5
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { repairTimeline } from '@/lib/shot-schema'

// 生成具有有效 endTime > startTime 的 shot 数组
const validShotsArb = fc.array(
  fc.record({
    orderIndex: fc.nat({ max: 100 }),
    startTime: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
    endTime: fc.double({ min: 0.1, max: 600, noNaN: true, noDefaultInfinity: true }),
  }).filter(s => s.endTime > s.startTime),
  { minLength: 1, maxLength: 20 }
).map(shots => {
  // 确保 orderIndex 唯一且递增
  return shots
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s, i) => ({ ...s, orderIndex: i }))
})

describe('repairTimeline 输出不变量属性测试', () => {
  it('Property 6.1: 输出按 orderIndex 严格升序排列', () => {
    fc.assert(
      fc.property(validShotsArb, (shots) => {
        const repaired = repairTimeline(shots)
        for (let i = 1; i < repaired.length; i++) {
          expect(repaired[i].orderIndex).toBeGreaterThan(repaired[i - 1].orderIndex)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('Property 6.2: 每个 shot 的 endTime > startTime', () => {
    fc.assert(
      fc.property(validShotsArb, (shots) => {
        const repaired = repairTimeline(shots)
        for (const shot of repaired) {
          expect(shot.endTime).toBeGreaterThan(shot.startTime)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('Property 6.3: 从第二个 shot 开始，每个 startTime 等于前一个 shot 的 endTime', () => {
    fc.assert(
      fc.property(validShotsArb, (shots) => {
        const repaired = repairTimeline(shots)
        for (let i = 1; i < repaired.length; i++) {
          expect(repaired[i].startTime).toBe(repaired[i - 1].endTime)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('Property 6.4: 第一个 shot 的 startTime 保持原值', () => {
    fc.assert(
      fc.property(validShotsArb, (shots) => {
        const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)
        const repaired = repairTimeline(shots)
        if (repaired.length > 0 && sorted.length > 0) {
          expect(repaired[0].startTime).toBe(sorted[0].startTime)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('Property 6.5: shots 数量与输入相同', () => {
    fc.assert(
      fc.property(validShotsArb, (shots) => {
        const repaired = repairTimeline(shots)
        expect(repaired.length).toBe(shots.length)
      }),
      { numRuns: 100 }
    )
  })

  it('空数组返回空数组', () => {
    expect(repairTimeline([])).toEqual([])
  })
})
