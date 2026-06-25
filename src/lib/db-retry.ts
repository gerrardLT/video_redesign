/**
 * 数据库操作重试辅助函数（PostgreSQL 版）
 *
 * PostgreSQL 使用 MVCC + 行级锁，不存在 SQLite 整库写锁问题。
 * 此模块保留 withRetry 接口以保持向后兼容，但仅对 Prisma 事务死锁/序列化失败重试。
 * 实际触发概率极低。
 */

export const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [200, 500, 1000],
} as const

/**
 * 判断是否为 PostgreSQL 可重试的事务冲突错误
 * - P2034: Transaction failed due to a write conflict or a deadlock
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('P2034') ||
      error.message.includes('deadlock detected') ||
      error.message.includes('could not serialize access')
    )
  }
  return false
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @internal 允许测试注入零延迟 sleep */
export const _internals = {
  sleep: defaultSleep,
}

/**
 * 对数据库写操作进行事务冲突重试。
 *
 * @param operation - 需要执行的异步操作
 * @param label - 可选标签，用于日志上下文
 * @returns 操作的返回值
 * @throws 非可重试错误立即抛出；超过重试次数抛出原始错误
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  label?: string
): Promise<T> {
  const { maxRetries, delays } = RETRY_CONFIG
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetriableError(error)) {
        throw error
      }

      lastError = error

      if (attempt < maxRetries) {
        const waitMs = delays[attempt]
        if (label) {
          console.warn(
            `[withRetry] ${label} — PostgreSQL transaction conflict, retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`
          )
        }
        await _internals.sleep(waitMs)
      }
    }
  }

  // 所有重试用尽，抛出原始错误
  throw lastError
}
