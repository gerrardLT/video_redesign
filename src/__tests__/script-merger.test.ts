/**
 * script-merger 属性化测试
 * 覆盖修复风险10（截断告警）和风险12（genDuration归一）的不变量
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { mergeTimelineScript, type MergeInputShot } from '../lib/script-merger'

describe('mergeTimelineScript 属性化测试', () => {
  // 生成有效的组内分镜输入
  const genGroupShots = () =>
    fc.array(
      fc.record({
        orderIndex: fc.nat({ max: 100 }),
        startTime: fc.float({ min: 0, max: 50, noNaN: true }),
        endTime: fc.float({ min: 0.5, max: 60, noNaN: true }),
        prompt: fc.oneof(
          fc.constant(null),
          fc.string({ minLength: 10, maxLength: 300 })
        ),
      }),
      { minLength: 1, maxLength: 8 }
    ).map(shots => {
      // 确保 endTime > startTime 且 orderIndex 连续
      let t = 0
      return shots.map((s, i) => {
        const duration = Math.max(0.5, s.endTime - s.startTime)
        const start = t
        const end = t + duration
        t = end
        return { orderIndex: i, startTime: start, endTime: end, prompt: s.prompt } as MergeInputShot
      })
    })

  it('P4: 传入 genDuration 时 segments 保留原始时长且 text 为镜头制格式', () => {
    fc.assert(
      fc.property(
        genGroupShots(),
        fc.integer({ min: 4, max: 15 }),
        (shots, genDuration) => {
          const result = mergeTimelineScript(shots, { genDuration })
          // segments 始终保留未归一的原始时间轴：分段数=分镜数，
          // 末段 relEnd=各分镜原始时长之和（归一仅作用于内部渲染，不写回 segments，
          // 也不再以「秒」形式出现在 text 中——改用镜头制）
          expect(result.segments).toHaveLength(shots.length)
          const totalDuration = shots.reduce(
            (sum, s) => sum + (s.endTime - s.startTime),
            0
          )
          const lastSeg = result.segments[result.segments.length - 1]
          expect(lastSeg.relEnd).toBeCloseTo(totalDuration, 10)
          // text 采用镜头制渲染（镜头N：…），且全部分镜完整保留（不再做硬截断丢段）
          expect(result.text).toMatch(/^镜头1：/)
          expect(result.droppedSegmentCount).toBe(0)
          expect(result.truncated).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('P5: text 非空且全部分镜保留（MAX_SCRIPT_LENGTH 为软目标，不做硬截断）', () => {
    fc.assert(
      fc.property(
        genGroupShots(),
        (shots) => {
          const result = mergeTimelineScript(shots)
          // 修复后 MAX_SCRIPT_LENGTH 为软目标：全组分镜完整保留，绝不丢段
          expect(result.text.length).toBeGreaterThan(0)
          expect(result.droppedSegmentCount).toBe(0)
          expect(result.truncated).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('P5: truncated 恒为 false（修复后全组分镜完整保留，绝不丢段）', () => {
    fc.assert(
      fc.property(
        genGroupShots(),
        (shots) => {
          const result = mergeTimelineScript(shots)
          // 修复后恒不丢段
          expect(result.truncated).toBe(false)
          expect(result.droppedSegmentCount).toBe(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不传 genDuration 时行为与原来一致（无归一）', () => {
    const shots: MergeInputShot[] = [
      { orderIndex: 0, startTime: 0, endTime: 3, prompt: '镜头固定，人物站立' },
      { orderIndex: 1, startTime: 3, endTime: 7, prompt: '镜头推，人物走动' },
    ]
    const result = mergeTimelineScript(shots)
    // 镜头制渲染：每段以「镜头N：<运镜>，<动作>」呈现（不再使用 N-N秒 时间码）
    expect(result.text).toContain('镜头1：固定，人物站立')
    expect(result.text).toContain('镜头2：推，人物走动')
    expect(result.truncated).toBe(false)
    expect(result.droppedSegmentCount).toBe(0)
  })
})
