/**
 * SQLite 写操作重试辅助函数
 * 仅对 SQLITE_BUSY / "database is locked" 错误重试
 * 最多 3 次重试（共 4 次尝试），间隔 500ms / 1000ms / 1500ms
 */

export const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [500, 1000, 1500],
} as const

export function isSQLiteLockError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('SQLITE_BUSY') ||
      error.message.includes('database is locked')
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
 * 对 SQLite 写操作进行锁竞争重试。
 *
 * @param operation - 需要执行的异步操作
 * @param label - 可选标签，用于日志上下文
 * @returns 操作的返回值
 * @throws 非锁竞争错误立即抛出；超过重试次数抛出原始错误
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
      if (!isSQLiteLockError(error)) {
        throw error
      }

      lastError = error

      if (attempt < maxRetries) {
        const waitMs = delays[attempt]
        if (label) {
          console.warn(
            `[withRetry] ${label} — SQLite lock detected, retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`
          )
        }
        await _internals.sleep(waitMs)
      }
    }
  }

  // 所有重试用尽，抛出原始错误
  throw lastError
}
