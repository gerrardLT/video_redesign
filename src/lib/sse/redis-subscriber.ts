/**
 * Redis Subscriber Manager — Redis 订阅管理器
 *
 * 管理 Redis Pub/Sub 订阅，为每个用户维护一个共享的 PSUBSCRIBE 频道模式。
 * 使用独立的 ioredis 实例（Redis 要求 subscribe 模式下的连接不能执行其他命令）。
 *
 * 核心特性：
 * - 懒初始化：首次 subscribe 时才建立 Redis 连接
 * - 同一用户的多个 SSE 连接共享一个 Redis 订阅
 * - 用户所有连接关闭后才取消 Redis 订阅
 * - 连接断开后自动重连并重新订阅所有活跃频道
 * - 消息解析失败时记录错误日志并丢弃，不影响后续消息
 */

import Redis from 'ioredis'
import type { ProgressEventPayload } from './types'
import { logger } from '@/lib/shared/logger'

/** 消息回调类型 */
type MessageCallback = (event: ProgressEventPayload) => void

/**
 * Redis Subscriber Manager 实现类
 *
 * 使用独立的 ioredis 实例专用于 PSUBSCRIBE 操作。
 * 通过 callbacks Map 管理每个用户的消息回调集合，
 * 同一用户的多个 SSE 连接共享一个 Redis 订阅。
 */
class RedisSubscriberManagerImpl {
  /** 独立的 Redis 订阅连接实例（懒初始化） */
  private subscriber: Redis | null = null
  /** 用户消息回调映射：userId → 回调函数集合 */
  private callbacks = new Map<string, Set<MessageCallback>>()
  /** 当前已订阅的 Redis pattern 集合 */
  private subscribedPatterns = new Set<string>()

  /**
   * 获取或创建 Redis 订阅连接实例（懒初始化）
   *
   * 首次调用时创建独立的 ioredis 实例，配置：
   * - maxRetriesPerRequest: null（ioredis subscribe 模式要求）
   * - lazyConnect: false（立即连接）
   *
   * 监听 ready 事件实现断线重连后重新订阅所有活跃频道。
   *
   * @returns Redis 订阅实例
   */
  private getSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      })

      // 监听 pmessage 事件处理模式匹配消息
      this.subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
        this.handleMessage(pattern, channel, message)
      })

      // 断线重连后重新订阅所有活跃频道
      this.subscriber.on('ready', () => {
        if (this.subscribedPatterns.size > 0) {
          logger.info('Redis subscriber 重连成功，重新订阅活跃频道', {
            patterns: Array.from(this.subscribedPatterns),
          })
          for (const pattern of this.subscribedPatterns) {
            this.subscriber!.psubscribe(pattern).catch((err) => {
              logger.error('Redis 重连后重新订阅失败', { pattern, error: String(err) })
            })
          }
        }
      })

      this.subscriber.on('error', (err) => {
        logger.error('Redis subscriber 连接错误', { error: String(err) })
      })
    }

    return this.subscriber
  }

  /**
   * 处理从 Redis 接收到的 pmessage
   *
   * 从 pattern 中解析出 userId，将消息 JSON 解析为 ProgressEventPayload，
   * 然后分发给该用户注册的所有回调函数。
   * 解析失败时记录错误日志并丢弃消息。
   *
   * @param pattern - 匹配的订阅模式（如 progress:user123:*）
   * @param channel - 实际频道名（如 progress:user123:generation:job456）
   * @param message - 消息内容（JSON 字符串）
   */
  private handleMessage(pattern: string, _channel: string, message: string): void {
    // 从 pattern 中提取 userId: "progress:{userId}:*" → userId
    const patternMatch = pattern.match(/^progress:(.+):\*$/)
    if (!patternMatch) {
      logger.error('Redis subscriber 收到无法解析的 pattern', { pattern })
      return
    }

    const userId = patternMatch[1]
    const userCallbacks = this.callbacks.get(userId)
    if (!userCallbacks || userCallbacks.size === 0) {
      return
    }

    // 解析 JSON 消息为 ProgressEventPayload
    let event: ProgressEventPayload
    try {
      event = JSON.parse(message) as ProgressEventPayload
    } catch (err) {
      logger.error('Redis subscriber 消息 JSON 解析失败，丢弃该消息', {
        pattern,
        message: message.substring(0, 200),
        error: String(err),
      })
      return
    }

    // 分发给该用户的所有回调
    for (const callback of userCallbacks) {
      try {
        callback(event)
      } catch (err) {
        logger.error('Redis subscriber 消息回调执行异常', {
          userId,
          error: String(err),
        })
      }
    }
  }

  /**
   * 为用户订阅进度频道
   *
   * 使用 PSUBSCRIBE progress:{userId}:* 订阅该用户所有进度事件。
   * 如已存在该用户的订阅则复用，仅注册新的消息回调。
   *
   * @param userId - 用户 ID
   * @param onMessage - 消息回调函数，接收解析后的 ProgressEventPayload
   */
  subscribe(userId: string, onMessage: MessageCallback): void {
    // 获取或创建该用户的回调集合
    let userCallbacks = this.callbacks.get(userId)
    if (!userCallbacks) {
      userCallbacks = new Set()
      this.callbacks.set(userId, userCallbacks)
    }

    // 注册回调
    userCallbacks.add(onMessage)

    // 如果该用户的 pattern 尚未订阅，则执行 PSUBSCRIBE
    const pattern = `progress:${userId}:*`
    if (!this.subscribedPatterns.has(pattern)) {
      this.subscribedPatterns.add(pattern)
      const subscriber = this.getSubscriber()
      subscriber.psubscribe(pattern).catch((err) => {
        logger.error('Redis PSUBSCRIBE 失败', { pattern, error: String(err) })
        // 订阅失败时清理状态
        this.subscribedPatterns.delete(pattern)
      })
    }
  }

  /**
   * 取消用户订阅
   *
   * 移除指定用户的所有消息回调。当该用户无活跃回调时，
   * 执行 PUNSUBSCRIBE 取消 Redis 订阅并清理相关状态。
   *
   * @param userId - 用户 ID
   */
  unsubscribe(userId: string): void {
    this.callbacks.delete(userId)

    const pattern = `progress:${userId}:*`
    if (this.subscribedPatterns.has(pattern)) {
      this.subscribedPatterns.delete(pattern)
      if (this.subscriber) {
        this.subscriber.punsubscribe(pattern).catch((err) => {
          logger.error('Redis PUNSUBSCRIBE 失败', { pattern, error: String(err) })
        })
      }
    }
  }

  /**
   * 移除用户的单个回调
   *
   * 仅移除指定的回调函数，如果该用户仍有其他回调则保留订阅。
   * 当该用户所有回调都被移除后，自动取消 Redis 订阅。
   *
   * @param userId - 用户 ID
   * @param onMessage - 要移除的回调函数
   */
  removeCallback(userId: string, onMessage: MessageCallback): void {
    const userCallbacks = this.callbacks.get(userId)
    if (!userCallbacks) return

    userCallbacks.delete(onMessage)

    // 如果该用户已无活跃回调，取消订阅
    if (userCallbacks.size === 0) {
      this.unsubscribe(userId)
    }
  }

  /**
   * 获取当前活跃订阅数量
   *
   * @returns 当前已订阅的 Redis pattern 数量
   */
  getActiveSubscriptionCount(): number {
    return this.subscribedPatterns.size
  }

  /**
   * 销毁订阅管理器，断开 Redis 连接
   *
   * 用于进程退出时清理资源。
   */
  async destroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit()
      this.subscriber = null
    }
    this.callbacks.clear()
    this.subscribedPatterns.clear()
  }
}

/** Redis Subscriber Manager 单例 */
export const redisSubscriber = new RedisSubscriberManagerImpl()
