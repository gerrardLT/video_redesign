import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

/**
 * 延迟初始化 Redis 连接
 * 仅在首次访问 redis 时才创建连接，避免 Next.js 模块加载时即连接 Redis
 */
let _redis: Redis | undefined

export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    if (!_redis) {
      _redis = globalForRedis.redis ?? new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null, // Required for BullMQ
      })
      if (process.env.NODE_ENV !== 'production') {
        globalForRedis.redis = _redis
      }
    }
    const value = (_redis as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') {
      return value.bind(_redis)
    }
    return value
  },
})
