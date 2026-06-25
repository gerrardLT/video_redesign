import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

/**
 * 延迟初始化 Redis 连接
 * 仅在首次访问 redis 时才创建连接，避免 Next.js 模块加载时即连接 Redis
 *
 * P3 修复：添加连接优化配置（keepAlive、重连策略、连接池化就绪）
 */
let _redis: Redis | undefined

export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    if (!_redis) {
      _redis = globalForRedis.redis ?? new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null, // Required for BullMQ
        // P3 优化：连接健壮性配置
        enableReadyCheck: true,
        keepAlive: 30000, // 30秒 TCP keepalive，防止空闲连接被防火墙/代理断开
        connectTimeout: 10000, // 连接超时 10s
        retryStrategy(times) {
          // 指数退避重连：最大间隔 30 秒
          const delay = Math.min(times * 200, 30000)
          return delay
        },
        reconnectOnError(err) {
          // 仅对特定网络错误自动重连（READONLY = Redis 故障转移期间的只读从节点）
          const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED']
          return targetErrors.some(e => err.message.includes(e))
        },
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
