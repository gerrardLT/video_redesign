/**
 * Redis Subscriber Manager 单元测试
 *
 * 测试 RedisSubscriberManager 的核心逻辑：
 * - 同用户多次 subscribe 只创建一个 Redis 订阅
 * - unsubscribe 后 getActiveSubscriptionCount 正确减少
 * - 无效 JSON 消息被丢弃而非抛出异常
 *
 * Requirements: 1.3, 1.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 保存 pmessage handler 引用，供测试调用
let pmessageHandler: ((...args: unknown[]) => void) | null = null

const mockPsubscribe = vi.fn().mockResolvedValue(undefined)
const mockPunsubscribe = vi.fn().mockResolvedValue(undefined)
const mockQuit = vi.fn().mockResolvedValue(undefined)

vi.mock('ioredis', () => {
  // 必须返回一个 class（构造函数），因为源码使用 new Redis(...)
  const MockRedis = function (this: Record<string, unknown>) {
    this.psubscribe = mockPsubscribe
    this.punsubscribe = mockPunsubscribe
    this.quit = mockQuit
    this.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'pmessage') {
        pmessageHandler = handler
      }
    })
  } as unknown as new (...args: unknown[]) => unknown
  return { default: MockRedis }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '@/lib/logger'

// 每个测试需要一个全新的 redisSubscriber 实例
let redisSubscriber: Awaited<typeof import('../redis-subscriber')>['redisSubscriber']

beforeEach(async () => {
  vi.clearAllMocks()
  pmessageHandler = null
  // 重置模块缓存，获取全新单例实例
  vi.resetModules()

  vi.doMock('ioredis', () => {
    const MockRedis = function (this: Record<string, unknown>) {
      this.psubscribe = mockPsubscribe
      this.punsubscribe = mockPunsubscribe
      this.quit = mockQuit
      this.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'pmessage') {
          pmessageHandler = handler
        }
      })
    } as unknown as new (...args: unknown[]) => unknown
    return { default: MockRedis }
  })

  vi.doMock('@/lib/logger', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }))

  const mod = await import('../redis-subscriber')
  redisSubscriber = mod.redisSubscriber
})

afterEach(async () => {
  await redisSubscriber.destroy()
})

describe('RedisSubscriberManager', () => {
  describe('同用户多次 subscribe 只创建一个 Redis 订阅', () => {
    it('同一用户调用 subscribe 两次，psubscribe 只调用一次', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      redisSubscriber.subscribe('user-1', callback1)
      redisSubscriber.subscribe('user-1', callback2)

      // psubscribe 只应被调用一次（相同 pattern 复用）
      expect(mockPsubscribe).toHaveBeenCalledTimes(1)
      expect(mockPsubscribe).toHaveBeenCalledWith('progress:user-1:*')
    })

    it('不同用户各调用 subscribe，各自创建独立订阅', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      redisSubscriber.subscribe('user-A', callback1)
      redisSubscriber.subscribe('user-B', callback2)

      expect(mockPsubscribe).toHaveBeenCalledTimes(2)
      expect(mockPsubscribe).toHaveBeenCalledWith('progress:user-A:*')
      expect(mockPsubscribe).toHaveBeenCalledWith('progress:user-B:*')
    })

    it('getActiveSubscriptionCount 返回正确的订阅数', () => {
      redisSubscriber.subscribe('user-1', vi.fn())
      redisSubscriber.subscribe('user-1', vi.fn())
      redisSubscriber.subscribe('user-2', vi.fn())

      // 两个不同用户 = 2 个活跃订阅
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(2)
    })
  })

  describe('unsubscribe 后 getActiveSubscriptionCount 正确减少', () => {
    it('取消订阅后活跃数量减少', () => {
      redisSubscriber.subscribe('user-1', vi.fn())
      redisSubscriber.subscribe('user-2', vi.fn())
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(2)

      redisSubscriber.unsubscribe('user-1')
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(1)

      redisSubscriber.unsubscribe('user-2')
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(0)
    })

    it('unsubscribe 调用 punsubscribe 清理 Redis 订阅', () => {
      redisSubscriber.subscribe('user-1', vi.fn())
      redisSubscriber.unsubscribe('user-1')

      expect(mockPunsubscribe).toHaveBeenCalledWith('progress:user-1:*')
    })

    it('removeCallback 移除单个回调，最后一个回调移除后自动取消订阅', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      redisSubscriber.subscribe('user-1', cb1)
      redisSubscriber.subscribe('user-1', cb2)
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(1)

      // 移除一个回调，仍有另一个在，不应取消订阅
      redisSubscriber.removeCallback('user-1', cb1)
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(1)
      expect(mockPunsubscribe).not.toHaveBeenCalled()

      // 移除最后一个回调，自动取消订阅
      redisSubscriber.removeCallback('user-1', cb2)
      expect(redisSubscriber.getActiveSubscriptionCount()).toBe(0)
      expect(mockPunsubscribe).toHaveBeenCalledWith('progress:user-1:*')
    })
  })

  describe('无效 JSON 消息被丢弃而非抛出异常', () => {
    it('收到无效 JSON 时不抛异常，记录错误日志', async () => {
      const { logger: loggerMock } = await import('@/lib/logger')
      const callback = vi.fn()

      redisSubscriber.subscribe('user-1', callback)

      // pmessageHandler 应在 subscribe 触发 getSubscriber 后被注册
      expect(pmessageHandler).not.toBeNull()

      // 调用 pmessage handler 传入无效 JSON
      expect(() => {
        pmessageHandler!('progress:user-1:*', 'progress:user-1:generation:job1', 'not valid json {{{')
      }).not.toThrow()

      // 回调不应被调用（消息被丢弃）
      expect(callback).not.toHaveBeenCalled()

      // 应记录错误日志
      expect(loggerMock.error).toHaveBeenCalledWith(
        'Redis subscriber 消息 JSON 解析失败，丢弃该消息',
        expect.objectContaining({
          pattern: 'progress:user-1:*',
        })
      )
    })

    it('收到有效 JSON 时正确分发给回调', () => {
      const callback = vi.fn()

      redisSubscriber.subscribe('user-1', callback)
      expect(pmessageHandler).not.toBeNull()

      const validEvent = {
        taskId: 'job-123',
        taskType: 'generation',
        eventType: 'state_change',
        timestamp: '2024-01-01T00:00:00Z',
        progress: 50,
      }

      // 调用 pmessage handler 传入有效 JSON
      pmessageHandler!(
        'progress:user-1:*',
        'progress:user-1:generation:job-123',
        JSON.stringify(validEvent)
      )

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(validEvent)
    })
  })
})
