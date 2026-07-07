/**
 * ProgressPublisher 单元测试
 *
 * 测试进度事件发布器的核心逻辑：
 * - publish 调用 redis.publish 时 channel 名称格式正确
 * - publish 失败时不抛异常，仅记录 warn 日志
 * - publishStateChange/publishCompleted/publishFailed 生成正确的 eventType
 * - publishChainProgress 的 metadata 包含 totalGroups、currentGroup、completedGroups
 *
 * Requirements: 4.1, 5.1, 5.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/redis', () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(0),
  },
}))

vi.mock('@/lib/shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  publish,
  publishStateChange,
  publishCompleted,
  publishFailed,
  publishChainProgress,
} from '@/lib/shared/progress-publisher'
import { redis } from '@/lib/shared/redis'
import { logger } from '@/lib/shared/logger'
import type { ProgressEventPayload, ChainMetadata } from '@/lib/sse/types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProgressPublisher', () => {
  describe('publish 调用 redis.publish 时 channel 名称格式正确', () => {
    it('channel 格式为 progress:{userId}:{taskType}:{taskId}', async () => {
      const event: ProgressEventPayload = {
        taskId: 'job-456',
        taskType: 'generation',
        eventType: 'state_change',
        timestamp: '2024-01-15T10:00:00Z',
        progress: 30,
      }

      await publish('user-123', 'generation', 'job-456', event)

      expect(redis.publish).toHaveBeenCalledTimes(1)
      expect(redis.publish).toHaveBeenCalledWith(
        'progress:user-123:generation:job-456',
        JSON.stringify(event)
      )
    })

    it('不同 taskType 生成不同 channel', async () => {
      const event: ProgressEventPayload = {
        taskId: 'task-789',
        taskType: 'parse',
        eventType: 'progress_update',
        timestamp: '2024-01-15T10:00:00Z',
      }

      await publish('user-abc', 'parse', 'task-789', event)

      expect(redis.publish).toHaveBeenCalledWith(
        'progress:user-abc:parse:task-789',
        JSON.stringify(event)
      )
    })
  })

  describe('publish 失败时不抛异常，仅记录 warn 日志', () => {
    it('redis.publish 抛出异常时 publish 不向外传播异常', async () => {
      vi.mocked(redis.publish).mockRejectedValueOnce(new Error('Redis connection lost'))

      const event: ProgressEventPayload = {
        taskId: 'job-fail',
        taskType: 'generation',
        eventType: 'state_change',
        timestamp: '2024-01-15T10:00:00Z',
      }

      // 不应抛出异常
      await expect(
        publish('user-1', 'generation', 'job-fail', event)
      ).resolves.toBeUndefined()

      // 应记录 warn 日志
      expect(logger.warn).toHaveBeenCalledWith(
        '进度事件发布失败',
        expect.objectContaining({
          userId: 'user-1',
          taskType: 'generation',
          taskId: 'job-fail',
          error: 'Redis connection lost',
        })
      )
    })

    it('非 Error 类型异常也能正确处理', async () => {
      vi.mocked(redis.publish).mockRejectedValueOnce('string error')

      const event: ProgressEventPayload = {
        taskId: 'job-x',
        taskType: 'merge',
        eventType: 'failed',
        timestamp: '2024-01-15T10:00:00Z',
      }

      await expect(
        publish('user-2', 'merge', 'job-x', event)
      ).resolves.toBeUndefined()

      expect(logger.warn).toHaveBeenCalledWith(
        '进度事件发布失败',
        expect.objectContaining({
          error: 'string error',
        })
      )
    })
  })

  describe('publishStateChange/publishCompleted/publishFailed 生成正确的 eventType', () => {
    it('publishStateChange 生成 eventType 为 state_change', async () => {
      await publishStateChange('user-1', 'generation', 'job-1', 'GENERATING', 45, 120)

      expect(redis.publish).toHaveBeenCalledTimes(1)
      const [channel, json] = vi.mocked(redis.publish).mock.calls[0]
      expect(channel).toBe('progress:user-1:generation:job-1')

      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('state_change')
      expect(event.taskId).toBe('job-1')
      expect(event.taskType).toBe('generation')
      expect(event.stage).toBe('GENERATING')
      expect(event.progress).toBe(45)
      expect(event.estimatedRemainingSeconds).toBe(120)
      expect(event.timestamp).toBeDefined()
    })

    it('publishStateChange 不传 progress 和 eta 时事件中不包含这些字段', async () => {
      await publishStateChange('user-1', 'parse', 'task-1', 'SPLITTING')

      const [, json] = vi.mocked(redis.publish).mock.calls[0]
      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('state_change')
      expect(event.stage).toBe('SPLITTING')
      expect(event).not.toHaveProperty('progress')
      expect(event).not.toHaveProperty('estimatedRemainingSeconds')
    })

    it('publishCompleted 生成 eventType 为 completed，progress 为 100', async () => {
      await publishCompleted('user-1', 'character', 'char-001')

      const [channel, json] = vi.mocked(redis.publish).mock.calls[0]
      expect(channel).toBe('progress:user-1:character:char-001')

      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('completed')
      expect(event.progress).toBe(100)
      expect(event.taskId).toBe('char-001')
      expect(event.taskType).toBe('character')
    })

    it('publishFailed 生成 eventType 为 failed', async () => {
      await publishFailed('user-1', 'merge', 'merge-002', 'ffmpeg process crashed')

      const [channel, json] = vi.mocked(redis.publish).mock.calls[0]
      expect(channel).toBe('progress:user-1:merge:merge-002')

      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('failed')
      expect(event.taskId).toBe('merge-002')
      expect(event.taskType).toBe('merge')
      expect(event.metadata).toEqual({ reason: 'ffmpeg process crashed' })
    })

    it('publishFailed 不传 reason 时 metadata 不存在', async () => {
      await publishFailed('user-1', 'generation', 'job-err')

      const [, json] = vi.mocked(redis.publish).mock.calls[0]
      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('failed')
      expect(event).not.toHaveProperty('metadata')
    })
  })

  describe('publishChainProgress metadata 包含 totalGroups、currentGroup、completedGroups', () => {
    it('链式进度事件包含完整的 ChainMetadata', async () => {
      const chainMetadata: ChainMetadata = {
        totalGroups: 5,
        currentGroup: 3,
        completedGroups: 2,
        currentJobStatus: 'GENERATING',
      }

      await publishChainProgress('user-1', 'proj-001', chainMetadata)

      const [channel, json] = vi.mocked(redis.publish).mock.calls[0]
      expect(channel).toBe('progress:user-1:chain:proj-001')

      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.taskType).toBe('chain')
      expect(event.taskId).toBe('proj-001')
      expect(event.eventType).toBe('progress_update')
      expect(event.progress).toBe(40) // 2/5 * 100 = 40

      // 验证 metadata 包含所有 ChainMetadata 字段
      expect(event.metadata).toBeDefined()
      expect(event.metadata!.totalGroups).toBe(5)
      expect(event.metadata!.currentGroup).toBe(3)
      expect(event.metadata!.completedGroups).toBe(2)
      expect(event.metadata!.currentJobStatus).toBe('GENERATING')
    })

    it('当 completedGroups >= totalGroups 时 eventType 为 completed', async () => {
      const chainMetadata: ChainMetadata = {
        totalGroups: 3,
        currentGroup: 3,
        completedGroups: 3,
      }

      await publishChainProgress('user-2', 'proj-002', chainMetadata)

      const [, json] = vi.mocked(redis.publish).mock.calls[0]
      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.eventType).toBe('completed')
      expect(event.progress).toBe(100) // 3/3 * 100 = 100
      expect(event.metadata!.totalGroups).toBe(3)
      expect(event.metadata!.completedGroups).toBe(3)
    })

    it('progress 百分比正确计算并四舍五入', async () => {
      const chainMetadata: ChainMetadata = {
        totalGroups: 3,
        currentGroup: 2,
        completedGroups: 1,
      }

      await publishChainProgress('user-3', 'proj-003', chainMetadata)

      const [, json] = vi.mocked(redis.publish).mock.calls[0]
      const event = JSON.parse(json as string) as ProgressEventPayload
      expect(event.progress).toBe(33) // Math.round(1/3 * 100) = 33
    })
  })
})
