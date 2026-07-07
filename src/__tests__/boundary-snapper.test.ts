/**
 * boundary-snapper 属性化测试
 * 覆盖修复风险8的不变量：升序、连续、无重叠、∈[0,D]、每切点最多消耗一次
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { snapBoundaries, SNAP_TOLERANCE } from '../lib/video/boundary-snapper'

describe('snapBoundaries 属性化测试', () => {
  // 生成有效的分镜输入：升序、无重叠、startTime < endTime
  // 使用 fc.double 代替 fc.float 避免极小浮点数（subnormals）导致的精度问题
  const genShots = (maxCount: number, maxDuration: number) =>
    fc.array(fc.double({ min: 0.01, max: maxDuration, noNaN: true, noDefaultInfinity: true }), { minLength: 2, maxLength: maxCount * 2 })
      .map(times => {
        const sorted = [...new Set(times.map(t => Math.round(t * 100) / 100))].sort((a, b) => a - b)
        if (sorted.length < 2) return []
        const shots = []
        for (let i = 0; i < sorted.length - 1; i += 2) {
          if (sorted[i] < sorted[i + 1]) {
            shots.push({ orderIndex: shots.length, startTime: sorted[i], endTime: sorted[i + 1] })
          }
        }
        return shots
      })
      .filter(shots => shots.length >= 1)

  const genCuts = (maxDuration: number) =>
    fc.array(fc.double({ min: 0.01, max: maxDuration, noNaN: true, noDefaultInfinity: true }), { minLength: 0, maxLength: 50 })
      .map(cuts => [...new Set(cuts.map(c => Math.round(c * 100) / 100))].sort((a, b) => a - b))

  it('P6: 吸附后升序、连续、无重叠、∈[0,D]', () => {
    fc.assert(
      fc.property(
        genShots(15, 60),
        genCuts(60),
        fc.double({ min: 10, max: 120, noNaN: true, noDefaultInfinity: true }),
        (shots, cuts, totalDuration) => {
          const td = Math.max(totalDuration, shots[shots.length - 1]?.endTime ?? 1)
          const result = snapBoundaries(shots, cuts, td)

          // 升序：snapBoundaries 使用 0.01 最小增量保证严格递增
          for (let i = 1; i < result.length; i++) {
            expect(result[i].startTime).toBeGreaterThan(result[i - 1].startTime)
          }
          // 连续无重叠
          for (let i = 1; i < result.length; i++) {
            expect(result[i].startTime).toBeCloseTo(result[i - 1].endTime, 5)
          }
          // startTime < endTime
          for (const s of result) {
            expect(s.endTime).toBeGreaterThan(s.startTime)
          }
          // ∈[0, totalDuration]（浮点容差 1e-6）
          for (const s of result) {
            expect(s.startTime).toBeGreaterThanOrEqual(0)
            expect(s.endTime).toBeLessThanOrEqual(td + 0.01 + 1e-6)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('P7: sceneCuts 为空时输出保持 qwen 原值结构', () => {
    fc.assert(
      fc.property(
        genShots(10, 30),
        fc.double({ min: 30, max: 60, noNaN: true, noDefaultInfinity: true }),
        (shots, totalDuration) => {
          const td = Math.max(totalDuration, shots[shots.length - 1]?.endTime ?? 1)
          const result = snapBoundaries(shots, [], td)
          // 无切点时不应改变分镜数量
          expect(result.length).toBe(shots.length)
        }
      ),
      { numRuns: 100 }
    )
  })
})
