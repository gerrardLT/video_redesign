/**
 * Redis 分布式速率限制器
 *
 * 基于 Redis INCR + EXPIRE 原子操作实现，支持多实例部署共享限流计数。
 * 替代原内存 Map 方案，解决多实例部署下计数不共享和长运行进程内存泄漏问题。
 *
 * 每个限流键对应一个 Redis key，值为窗口内请求次数，TTL 为窗口时长。
 * 首次请求时 SET key 1 EX windowSeconds，后续请求 INCR key。
 */

import { redis } from './redis'

/** Redis 速率限制键前缀，与项目其他 Redis key 隔离 */
const RATE_LIMIT_PREFIX = 'ratelimit:'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
}

/**
 * 异步检查是否允许请求（基于 Redis 原子操作）
 *
 * @param key 限制键（通常是 userId 或 userId:endpoint）
 * @param maxRequests 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒），默认 60000（1 分钟）
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number = 5,
  windowMs: number = 60 * 1000
): Promise<RateLimitResult> {
  const redisKey = `${RATE_LIMIT_PREFIX}${key}`
  const windowSeconds = Math.ceil(windowMs / 1000)
  const now = Date.now()

  // 获取当前计数
  const current = await redis.get(redisKey)

  if (current === null) {
    // 新窗口：设置计数为 1，TTL 为窗口秒数
    await redis.set(redisKey, '1', 'EX', windowSeconds)
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs,
    }
  }

  const count = parseInt(current, 10)

  if (count >= maxRequests) {
    // 已超限：获取剩余 TTL 计算重置时间
    const ttl = await redis.ttl(redisKey)
    const resetTime = ttl > 0 ? now + ttl * 1000 : now + windowMs
    return { allowed: false, remaining: 0, resetTime }
  }

  // 未超限：原子递增计数
  const newCount = await redis.incr(redisKey)
  const ttl = await redis.ttl(redisKey)
  const resetTime = ttl > 0 ? now + ttl * 1000 : now + windowMs

  return {
    allowed: newCount <= maxRequests,
    remaining: Math.max(0, maxRequests - newCount),
    resetTime,
  }
}

/**
 * 速率限制中间件辅助（异步版）
 * 用于 API Route 中快速判断是否超限
 */
export async function isRateLimited(
  userId: string,
  endpoint: string = 'generate'
): Promise<boolean> {
  const key = `${userId}:${endpoint}`
  const result = await checkRateLimit(key, 5, 60 * 1000)
  return !result.allowed
}
