/**
 * 转场引擎属性测试
 *
 * Tag: Feature: video-quality-enhancements
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeTransitionPlan, type SegmentInfo } from '@/lib/transition-engine'
import { normScene } from '@/lib/frame-continuity'

// ========================
// 辅助生成器
// ========================

/** 生成合理的段时长（0.5 ~ 30 秒） */
const segmentDurationArb = fc.double({ min: 0.5, max: 30, noNaN: true, noDefaultInfinity: true })

/** 生成场景名（可能相同以触发同场景转场） */
const sceneArb = fc.oneof(
  fc.constant('室内'),
  fc.constant('室外'),
  fc.constant('办公室'),
  fc.constant(null)
)

/** 生成单个 SegmentInfo */
const segmentInfoArb = fc.record({
  groupIndex: fc.nat({ max: 100 }),
  duration: segmentDurationArb,
  scene: sceneArb,
})

/** 生成分镜组序列（2~10 段） */
const segmentsArb = fc.array(segmentInfoArb, { minLength: 2, maxLength: 10 })

// ========================
// Property 3: 同场景 crossfade 时长约束
// ========================

describe('Property 3: 同场景 crossfade 时长约束', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * 相邻两个满足 normScene(a.scene) === normScene(b.scene) 且时长均 ≥ 2 × transitionDuration
   * 的分镜组，computeTransitionPlan 应输出类型为 crossfade 且时长在 [0.3, 0.5] 秒范围内
   */
  it('同场景且非短段时使用 crossfade，时长在 [0.3, 0.5]', () => {
    const sameScenePairArb = fc.record({
      scene: fc.constantFrom('室内', '办公室', '街道'),
      durationA: fc.double({ min: 1.0, max: 30, noNaN: true, noDefaultInfinity: true }),
      durationB: fc.double({ min: 1.0, max: 30, noNaN: true, noDefaultInfinity: true }),
    })

    fc.assert(
      fc.property(sameScenePairArb, ({ scene, durationA, durationB }) => {
        const segments: SegmentInfo[] = [
          { groupIndex: 0, duration: durationA, scene },
          { groupIndex: 1, duration: durationB, scene },
        ]
        const plan = computeTransitionPlan(segments)

        // 只检查非短段的情况
        const transition = plan.transitions[0]
        if (transition.type === 'none') {
          // 短段被跳过是正确行为
          expect(durationA < 2 * 0.4 || durationB < 2 * 0.4).toBe(true)
        } else {
          expect(transition.type).toBe('crossfade')
          expect(transition.duration).toBeGreaterThanOrEqual(0.3)
          expect(transition.duration).toBeLessThanOrEqual(0.5)
        }
      }),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 4: 转场重叠分配
// ========================

describe('Property 4: 转场重叠分配', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * 对于所有类型非 none 的转场配置，offsetA + offsetB 应等于 duration
   */
  it('offsetA + offsetB === duration', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const plan = computeTransitionPlan(segments)
        for (const t of plan.transitions) {
          if (t.type !== 'none') {
            expect(t.offsetA + t.offsetB).toBeCloseTo(t.duration, 10)
          }
        }
      }),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 5: 跨场景 fade 时长约束
// ========================

describe('Property 5: 跨场景 fade 时长约束', () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * 相邻两个满足 normScene 不等且时长均 ≥ 2 × transitionDuration 的分镜组，
   * computeTransitionPlan 应输出类型为 fade 且时长在 [0.5, 1.0] 秒范围内
   */
  it('跨场景且非短段时使用 fade，时长在 [0.5, 1.0]', () => {
    const crossScenePairArb = fc.record({
      sceneA: fc.constantFrom('室内', '办公室'),
      sceneB: fc.constantFrom('室外', '街道'),
      durationA: fc.double({ min: 1.5, max: 30, noNaN: true, noDefaultInfinity: true }),
      durationB: fc.double({ min: 1.5, max: 30, noNaN: true, noDefaultInfinity: true }),
    })

    fc.assert(
      fc.property(crossScenePairArb, ({ sceneA, sceneB, durationA, durationB }) => {
        // 确保跨场景
        if (normScene(sceneA) === normScene(sceneB)) return

        const segments: SegmentInfo[] = [
          { groupIndex: 0, duration: durationA, scene: sceneA },
          { groupIndex: 1, duration: durationB, scene: sceneB },
        ]
        const plan = computeTransitionPlan(segments)
        const transition = plan.transitions[0]

        if (transition.type === 'none') {
          // 短段跳过
          expect(durationA < 2 * 0.7 || durationB < 2 * 0.7).toBe(true)
        } else {
          expect(transition.type).toBe('fade')
          expect(transition.duration).toBeGreaterThanOrEqual(0.5)
          expect(transition.duration).toBeLessThanOrEqual(1.0)
        }
      }),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 6: 跨场景时长大于同场景时长
// ========================

describe('Property 6: 跨场景时长大于同场景时长', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * 在同一 TransitionPlan 中，所有跨场景转场的 duration 应严格大于所有同场景转场的 duration
   */
  it('fade duration > crossfade duration', () => {
    // 构造含同场景和跨场景的序列
    const mixedSegmentsArb = fc.tuple(
      fc.double({ min: 2.0, max: 30, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 2.0, max: 30, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 2.0, max: 30, noNaN: true, noDefaultInfinity: true })
    ).map(([d1, d2, d3]) => [
      { groupIndex: 0, duration: d1, scene: '室内' },
      { groupIndex: 1, duration: d2, scene: '室内' }, // 同场景
      { groupIndex: 2, duration: d3, scene: '室外' }, // 跨场景
    ] as SegmentInfo[])

    fc.assert(
      fc.property(mixedSegmentsArb, (segments) => {
        const plan = computeTransitionPlan(segments)
        const crossfades = plan.transitions.filter((t) => t.type === 'crossfade')
        const fades = plan.transitions.filter((t) => t.type === 'fade')

        if (crossfades.length > 0 && fades.length > 0) {
          const maxCrossfade = Math.max(...crossfades.map((t) => t.duration))
          const minFade = Math.min(...fades.map((t) => t.duration))
          expect(minFade).toBeGreaterThan(maxCrossfade)
        }
      }),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 8: 短段跳过转场
// ========================

describe('Property 8: 短段跳过转场', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * 分镜组序列中某段视频时长 d < 2 × transitionDuration，
   * 该段与其相邻段之间的转场类型应为 none
   */
  it('短段（duration < 2 × transitionDuration）相邻转场为 none', () => {
    // 生成一个短段 + 正常段的序列
    const shortSegmentArb = fc.record({
      shortDuration: fc.double({ min: 0.1, max: 0.7, noNaN: true, noDefaultInfinity: true }), // < 2 * 0.4
      normalDuration: fc.double({ min: 3.0, max: 30, noNaN: true, noDefaultInfinity: true }),
      scene: fc.constantFrom('室内', '室外'),
    })

    fc.assert(
      fc.property(shortSegmentArb, ({ shortDuration, normalDuration, scene }) => {
        // 短段在前
        const segments: SegmentInfo[] = [
          { groupIndex: 0, duration: shortDuration, scene },
          { groupIndex: 1, duration: normalDuration, scene },
        ]
        const plan = computeTransitionPlan(segments)
        expect(plan.transitions[0].type).toBe('none')

        // 短段在后
        const segments2: SegmentInfo[] = [
          { groupIndex: 0, duration: normalDuration, scene },
          { groupIndex: 1, duration: shortDuration, scene },
        ]
        const plan2 = computeTransitionPlan(segments2)
        expect(plan2.transitions[0].type).toBe('none')
      }),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 9: 合并总时长不变量
// ========================

describe('Property 9: 合并总时长不变量', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * plan.totalDuration === sum(segments.duration) - sum(有效转场的 duration)
   */
  it('totalDuration = 各段时长之和 - 有效转场重叠时长之和', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const plan = computeTransitionPlan(segments)
        const sumDurations = segments.reduce((acc, s) => acc + s.duration, 0)
        const sumOverlaps = plan.transitions
          .filter((t) => t.type !== 'none')
          .reduce((acc, t) => acc + t.duration, 0)
        const expected = sumDurations - sumOverlaps

        expect(plan.totalDuration).toBeCloseTo(expected, 5)
      }),
      { numRuns: 200 }
    )
  })

  it('单段时 totalDuration 等于该段时长', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 60, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          const segments: SegmentInfo[] = [{ groupIndex: 0, duration, scene: '室内' }]
          const plan = computeTransitionPlan(segments)
          expect(plan.transitions).toHaveLength(0)
          expect(plan.totalDuration).toBeCloseTo(duration, 10)
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ========================
// Property 7: 音视频转场同步
// ========================

import { buildTransitionFilters } from '@/lib/transition-engine'

describe('Property 7: 音视频转场同步', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * 所有类型非 none 的转场配置，应同时生成对应的 acrossfade 音频过渡，
   * 且音频过渡时长与视觉过渡时长相等
   */
  it('有视觉转场时必有对应音频过渡，时长一致', () => {
    const longSegmentsArb = fc.array(
      fc.record({
        groupIndex: fc.nat({ max: 100 }),
        duration: fc.double({ min: 2.0, max: 30, noNaN: true, noDefaultInfinity: true }),
        scene: fc.oneof(
          fc.constant('室内'),
          fc.constant('室外'),
          fc.constant('办公室')
        ),
      }),
      { minLength: 2, maxLength: 8 }
    )

    fc.assert(
      fc.property(longSegmentsArb, (segments) => {
        const plan = computeTransitionPlan(segments)
        const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)

        const activeTransitions = plan.transitions.filter((t) => t.type !== 'none')

        if (activeTransitions.length === 0) {
          // 无有效转场时，filter 应为空
          expect(videoFilter).toBe('')
          expect(audioFilter).toBe('')
        } else {
          // 有转场时，video 和 audio filter 都不为空
          expect(videoFilter.length).toBeGreaterThan(0)
          expect(audioFilter.length).toBeGreaterThan(0)

          // 验证 acrossfade 时长与 xfade 时长一致
          for (const t of activeTransitions) {
            // 音频 filter 中应包含 d=<duration> 的 acrossfade
            expect(audioFilter).toContain(`acrossfade=d=${t.duration}`)
          }
        }
      }),
      { numRuns: 200 }
    )
  })
})
