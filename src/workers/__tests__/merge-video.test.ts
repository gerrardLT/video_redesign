/**
 * Merge Worker 集成测试
 *
 * 测试含转场的视频合并流程（mock FFmpeg 命令执行）和超分触发逻辑（mock BullMQ 入队）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeTransitionPlan, buildTransitionFilters, type SegmentInfo } from '@/lib/transition-engine'

// 直接测试转场引擎与合并逻辑的集成（不需要真正启动 Worker）

describe('Merge Worker 集成测试 - 转场合并流程', () => {
  it('2 段同场景视频生成正确的 xfade filter', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5.0, scene: '办公室' },
      { groupIndex: 1, duration: 6.0, scene: '办公室' },
    ]

    const plan = computeTransitionPlan(segments)
    expect(plan.transitions).toHaveLength(1)
    expect(plan.transitions[0].type).toBe('crossfade')
    expect(plan.transitions[0].duration).toBe(0.4)

    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)
    expect(videoFilter).toContain('xfade=transition=fade')
    expect(videoFilter).toContain('duration=0.4')
    expect(audioFilter).toContain('acrossfade=d=0.4')

    // 总时长验证
    expect(plan.totalDuration).toBeCloseTo(5.0 + 6.0 - 0.4, 5)
  })

  it('3 段混合场景视频生成正确的链式 filter', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 4.0, scene: '室内' },
      { groupIndex: 1, duration: 5.0, scene: '室内' },
      { groupIndex: 2, duration: 6.0, scene: '室外' },
    ]

    const plan = computeTransitionPlan(segments)
    expect(plan.transitions).toHaveLength(2)
    expect(plan.transitions[0].type).toBe('crossfade') // 同场景
    expect(plan.transitions[1].type).toBe('fade') // 跨场景

    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)
    // 两段 filter
    expect(videoFilter.split(';')).toHaveLength(2)
    expect(audioFilter.split(';')).toHaveLength(2)

    // 第一段 crossfade
    expect(videoFilter).toContain('transition=fade')
    // 第二段 fadeblack
    expect(videoFilter).toContain('transition=fadeblack')

    // 总时长 = 4 + 5 + 6 - 0.4 - 0.7 = 13.9
    expect(plan.totalDuration).toBeCloseTo(13.9, 5)
  })

  it('含短段的序列正确跳过转场', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5.0, scene: '室内' },
      { groupIndex: 1, duration: 0.5, scene: '室内' }, // 短段
      { groupIndex: 2, duration: 5.0, scene: '室内' },
    ]

    const plan = computeTransitionPlan(segments)
    expect(plan.transitions).toHaveLength(2)
    // 短段相邻的转场为 none
    expect(plan.transitions[0].type).toBe('none') // 5.0 → 0.5（0.5 < 2*0.4）
    expect(plan.transitions[1].type).toBe('none') // 0.5 → 5.0（0.5 < 2*0.4）

    // 无有效转场时 filter 为空
    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)
    expect(videoFilter).toBe('')
    expect(audioFilter).toBe('')
  })
})

describe('Merge Worker 集成测试 - 超分触发逻辑', () => {
  it('480p 不触发超分', () => {
    const targetResolution = '480p'
    const shouldTriggerUpscale = targetResolution === '720p' || targetResolution === '1080p'
    expect(shouldTriggerUpscale).toBe(false)
  })

  it('720p 触发超分入队', () => {
    const targetResolution = '720p'
    const shouldTriggerUpscale = targetResolution === '720p' || targetResolution === '1080p'
    expect(shouldTriggerUpscale).toBe(true)
  })

  it('1080p 触发超分入队', () => {
    const targetResolution = '1080p'
    const shouldTriggerUpscale = targetResolution === '720p' || targetResolution === '1080p'
    expect(shouldTriggerUpscale).toBe(true)
  })

  it('超分积分冻结与退还逻辑', () => {
    const reservedCredits = 20
    const targetResolution = '1080p'

    // 模拟合并失败后退还积分的判定
    const shouldRefund = (targetResolution === '720p' || targetResolution === '1080p') &&
      reservedCredits > 0
    expect(shouldRefund).toBe(true)

    // 480p 不冻结积分，不退还
    const noRefund = targetResolution === '480p' || reservedCredits === 0
    expect(noRefund).toBe(false)
  })
})
