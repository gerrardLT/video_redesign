/**
 * 简单内存速率限制器
 * 用于 API 端点保护，每用户每分钟 N 次请求限制
 */

interface RateLimitEntry {
  count: number
  resetTime: number
}

const store = new Map<string, RateLimitEntry>()

// 定期清理过期条目，避免内存泄漏
const CLEANUP_INTERVAL = 60 * 1000 // 1 分钟
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key)
    }
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
}

/**
 * 检查是否允许请求
 * @param key 限制键（通常是 userId 或 userId:endpoint）
 * @param maxRequests 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒），默认 60000（1 分钟）
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 5,
  windowMs: number = 60 * 1000
): RateLimitResult {
  cleanup()

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetTime) {
    // 新窗口或已过期
    store.set(key, { count: 1, resetTime: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs }
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetTime: entry.resetTime }
}

/**
 * 速率限制中间件辅助
 * 用于 API Route 中快速判断是否超限
 */
export function isRateLimited(userId: string, endpoint: string = 'generate'): boolean {
  const key = `${userId}:${endpoint}`
  const result = checkRateLimit(key, 5, 60 * 1000)
  return !result.allowed
}
