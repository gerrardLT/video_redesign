/**
 * 转场引擎单元测试
 *
 * 测试 buildTransitionFilters 在不同段数场景下的 xfade/acrossfade filter 字符串正确性
 */
import { describe, it, expect, vi } from 'vitest'

// Mock db 模块，避免 DATABASE_URL 缺失导致的初始化错误（frame-continuity 间接 import db）
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))

import {
  computeTransitionPlan,
  buildTransitionFilters,
  type SegmentInfo,
} from '@/lib/video/transition-engine'

describe('buildTransitionFilters 单元测试', () => {
  it('2 段同场景：生成一个 xfade + 一个 acrossfade', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5, scene: '室内' },
      { groupIndex: 1, duration: 5, scene: '室内' },
    ]
    const plan = computeTransitionPlan(segments)
    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)

    // 应包含 xfade transition=fade（crossfade 用 fade 类型）
    expect(videoFilter).toContain('xfade=transition=fade')
    expect(videoFilter).toContain('duration=0.4')
    // 音频应包含 acrossfade
    expect(audioFilter).toContain('acrossfade=d=0.4')
  })

  it('2 段跨场景：生成一个 fadeblack xfade + 一个 acrossfade', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5, scene: '室内' },
      { groupIndex: 1, duration: 5, scene: '室外' },
    ]
    const plan = computeTransitionPlan(segments)
    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)

    expect(videoFilter).toContain('xfade=transition=fadeblack')
    expect(videoFilter).toContain('duration=0.7')
    expect(audioFilter).toContain('acrossfade=d=0.7')
  })

  it('3 段混合场景：生成正确的链式 filter', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5, scene: '室内' },
      { groupIndex: 1, duration: 5, scene: '室内' },
      { groupIndex: 2, duration: 5, scene: '室外' },
    ]
    const plan = computeTransitionPlan(segments)
    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)

    // 应有两段 xfade 用分号分隔
    const videoparts = videoFilter.split(';')
    expect(videoparts).toHaveLength(2)
    // 第一段：crossfade（同场景）
    expect(videoparts[0]).toContain('transition=fade')
    expect(videoparts[0]).toContain('duration=0.4')
    // 第二段：fadeblack（跨场景）
    expect(videoparts[1]).toContain('transition=fadeblack')
    expect(videoparts[1]).toContain('duration=0.7')

    // 音频也有两段
    const audioparts = audioFilter.split(';')
    expect(audioparts).toHaveLength(2)
    expect(audioparts[0]).toContain('acrossfade=d=0.4')
    expect(audioparts[1]).toContain('acrossfade=d=0.7')
  })

  it('5 段全同场景：4 个 crossfade', () => {
    const segments: SegmentInfo[] = Array.from({ length: 5 }, (_, i) => ({
      groupIndex: i,
      duration: 6,
      scene: '办公室',
    }))
    const plan = computeTransitionPlan(segments)
    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)

    // 4 个转场
    const videoparts = videoFilter.split(';')
    expect(videoparts).toHaveLength(4)
    // 每段都是 fade（crossfade 类型）
    for (const part of videoparts) {
      expect(part).toContain('transition=fade')
      expect(part).toContain('duration=0.4')
    }

    const audioparts = audioFilter.split(';')
    expect(audioparts).toHaveLength(4)
    for (const part of audioparts) {
      expect(part).toContain('acrossfade=d=0.4')
    }
  })

  it('全部为 none 转场时返回空 filter', () => {
    // 所有段都太短
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 0.3, scene: '室内' },
      { groupIndex: 1, duration: 0.3, scene: '室内' },
      { groupIndex: 2, duration: 0.3, scene: '室外' },
    ]
    const plan = computeTransitionPlan(segments)

    // 所有转场应为 none（短段）
    expect(plan.transitions.every((t) => t.type === 'none')).toBe(true)

    const { videoFilter, audioFilter } = buildTransitionFilters(segments, plan)
    expect(videoFilter).toBe('')
    expect(audioFilter).toBe('')
  })

  it('xfade offset 计算正确（3 段同场景 5s 时长）', () => {
    const segments: SegmentInfo[] = [
      { groupIndex: 0, duration: 5, scene: '室内' },
      { groupIndex: 1, duration: 5, scene: '室内' },
      { groupIndex: 2, duration: 5, scene: '室内' },
    ]
    const plan = computeTransitionPlan(segments)
    const { videoFilter } = buildTransitionFilters(segments, plan)

    // 第一个 xfade offset = 5 - 0.4 = 4.6
    expect(videoFilter).toContain('offset=4.600')
    // 第二个 xfade offset = 4.6 + (5 - 0.4) = 9.2
    expect(videoFilter).toContain('offset=9.200')
  })
})
