/**
 * useSSEProgress Hook 单元测试
 *
 * 由于 vitest 使用 node 环境，无法测试浏览器 EventSource API，
 * 因此聚焦测试底层 Zustand store（sse-progress-store）的行为：
 * - updateProgress 正确添加到 progressMap
 * - completed/failed 事件在 5 秒后自动移除
 * - setConnected 更新 isConnected
 * - clearTask 移除指定任务
 * - resetAll 清空所有状态
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useSSEProgressStore } from '@/stores/sse-progress-store'
import type { ProgressEventPayload } from '@/lib/sse/types'

/** 辅助函数：创建模拟进度事件 */
function createMockEvent(overrides: Partial<ProgressEventPayload> = {}): ProgressEventPayload {
  return {
    taskId: 'task-001',
    taskType: 'generation',
    eventType: 'progress_update',
    timestamp: new Date().toISOString(),
    progress: 50,
    ...overrides,
  }
}

describe('SSE Progress Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 重置 store 到初始状态
    useSSEProgressStore.getState().resetAll()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('updateProgress', () => {
    it('应正确将事件添加到 progressMap', () => {
      const event = createMockEvent({ taskId: 'task-abc', progress: 30 })

      useSSEProgressStore.getState().updateProgress(event)

      const { progressMap } = useSSEProgressStore.getState()
      expect(progressMap.get('task-abc')).toEqual(event)
      expect(progressMap.size).toBe(1)
    })

    it('应能存储多个不同 taskId 的事件', () => {
      const event1 = createMockEvent({ taskId: 'task-1', progress: 20 })
      const event2 = createMockEvent({ taskId: 'task-2', taskType: 'parse', progress: 80 })

      useSSEProgressStore.getState().updateProgress(event1)
      useSSEProgressStore.getState().updateProgress(event2)

      const { progressMap } = useSSEProgressStore.getState()
      expect(progressMap.size).toBe(2)
      expect(progressMap.get('task-1')).toEqual(event1)
      expect(progressMap.get('task-2')).toEqual(event2)
    })

    it('同一 taskId 的新事件应覆盖旧事件', () => {
      const event1 = createMockEvent({ taskId: 'task-x', progress: 30 })
      const event2 = createMockEvent({ taskId: 'task-x', progress: 70 })

      useSSEProgressStore.getState().updateProgress(event1)
      useSSEProgressStore.getState().updateProgress(event2)

      const { progressMap } = useSSEProgressStore.getState()
      expect(progressMap.size).toBe(1)
      expect(progressMap.get('task-x')!.progress).toBe(70)
    })
  })

  describe('终态事件自动移除 (5 秒延迟)', () => {
    it('completed 事件应在 5 秒后从 progressMap 移除', () => {
      const event = createMockEvent({
        taskId: 'task-done',
        eventType: 'completed',
        progress: 100,
      })

      useSSEProgressStore.getState().updateProgress(event)
      expect(useSSEProgressStore.getState().progressMap.get('task-done')).toBeDefined()

      // 4.9 秒后仍存在
      vi.advanceTimersByTime(4900)
      expect(useSSEProgressStore.getState().progressMap.get('task-done')).toBeDefined()

      // 5 秒后被移除
      vi.advanceTimersByTime(100)
      expect(useSSEProgressStore.getState().progressMap.get('task-done')).toBeUndefined()
    })

    it('failed 事件应在 5 秒后从 progressMap 移除', () => {
      const event = createMockEvent({
        taskId: 'task-fail',
        eventType: 'failed',
        progress: 40,
      })

      useSSEProgressStore.getState().updateProgress(event)
      expect(useSSEProgressStore.getState().progressMap.get('task-fail')).toBeDefined()

      vi.advanceTimersByTime(5000)
      expect(useSSEProgressStore.getState().progressMap.get('task-fail')).toBeUndefined()
    })

    it('非终态事件 (progress_update) 不应自动移除', () => {
      const event = createMockEvent({
        taskId: 'task-ongoing',
        eventType: 'progress_update',
        progress: 60,
      })

      useSSEProgressStore.getState().updateProgress(event)

      vi.advanceTimersByTime(10000)
      expect(useSSEProgressStore.getState().progressMap.get('task-ongoing')).toBeDefined()
    })
  })

  describe('setConnected', () => {
    it('应将 isConnected 更新为 true', () => {
      expect(useSSEProgressStore.getState().isConnected).toBe(false)

      useSSEProgressStore.getState().setConnected(true)

      expect(useSSEProgressStore.getState().isConnected).toBe(true)
    })

    it('应将 isConnected 更新为 false', () => {
      useSSEProgressStore.getState().setConnected(true)
      useSSEProgressStore.getState().setConnected(false)

      expect(useSSEProgressStore.getState().isConnected).toBe(false)
    })
  })

  describe('clearTask', () => {
    it('应移除指定 taskId 的进度', () => {
      const event1 = createMockEvent({ taskId: 'keep-me' })
      const event2 = createMockEvent({ taskId: 'remove-me' })

      useSSEProgressStore.getState().updateProgress(event1)
      useSSEProgressStore.getState().updateProgress(event2)

      useSSEProgressStore.getState().clearTask('remove-me')

      const { progressMap } = useSSEProgressStore.getState()
      expect(progressMap.size).toBe(1)
      expect(progressMap.get('keep-me')).toBeDefined()
      expect(progressMap.get('remove-me')).toBeUndefined()
    })

    it('清除不存在的 taskId 时不抛异常', () => {
      const event = createMockEvent({ taskId: 'only-one' })
      useSSEProgressStore.getState().updateProgress(event)

      expect(() => {
        useSSEProgressStore.getState().clearTask('non-existent')
      }).not.toThrow()

      expect(useSSEProgressStore.getState().progressMap.size).toBe(1)
    })
  })

  describe('resetAll', () => {
    it('应清空所有状态回到初始值', () => {
      // 先设置一些状态
      useSSEProgressStore.getState().setConnected(true)
      useSSEProgressStore.getState().updateProgress(createMockEvent({ taskId: 'a' }))
      useSSEProgressStore.getState().updateProgress(createMockEvent({ taskId: 'b' }))
      useSSEProgressStore.setState({ lastEventId: 42 })

      // 验证有数据
      expect(useSSEProgressStore.getState().isConnected).toBe(true)
      expect(useSSEProgressStore.getState().progressMap.size).toBe(2)
      expect(useSSEProgressStore.getState().lastEventId).toBe(42)

      // 执行 resetAll
      useSSEProgressStore.getState().resetAll()

      // 验证所有状态已重置
      const state = useSSEProgressStore.getState()
      expect(state.isConnected).toBe(false)
      expect(state.progressMap.size).toBe(0)
      expect(state.lastEventId).toBe(0)
    })
  })
})
