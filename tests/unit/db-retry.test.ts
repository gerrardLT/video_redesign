import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, isSQLiteLockError, RETRY_CONFIG, _internals } from '@/lib/db-retry'

describe('isSQLiteLockError', () => {
  it('识别 SQLITE_BUSY 错误', () => {
    expect(isSQLiteLockError(new Error('SQLITE_BUSY: database table is locked'))).toBe(true)
  })

  it('识别 "database is locked" 错误', () => {
    expect(isSQLiteLockError(new Error('database is locked'))).toBe(true)
  })

  it('不识别其他 Error', () => {
    expect(isSQLiteLockError(new Error('connection refused'))).toBe(false)
  })

  it('不识别非 Error 类型', () => {
    expect(isSQLiteLockError('string error')).toBe(false)
    expect(isSQLiteLockError(null)).toBe(false)
    expect(isSQLiteLockError(undefined)).toBe(false)
    expect(isSQLiteLockError(42)).toBe(false)
  })
})

describe('RETRY_CONFIG', () => {
  it('最大重试次数为 3', () => {
    expect(RETRY_CONFIG.maxRetries).toBe(3)
  })

  it('延迟间隔为 500ms、1000ms、1500ms', () => {
    expect(RETRY_CONFIG.delays).toEqual([500, 1000, 1500])
  })
})

describe('withRetry', () => {
  const sleepCalls: number[] = []
  let originalSleep: typeof _internals.sleep

  beforeEach(() => {
    sleepCalls.length = 0
    originalSleep = _internals.sleep
    _internals.sleep = async (ms: number) => {
      sleepCalls.push(ms)
    }
  })

  afterEach(() => {
    _internals.sleep = originalSleep
  })

  it('成功时直接返回结果', async () => {
    const result = await withRetry(() => Promise.resolve(42))
    expect(result).toBe(42)
    expect(sleepCalls).toHaveLength(0)
  })

  it('非锁竞争错误立即抛出，不重试', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw new Error('some other error')
    }

    await expect(withRetry(op)).rejects.toThrow('some other error')
    expect(callCount).toBe(1)
    expect(sleepCalls).toHaveLength(0)
  })

  it('非 Error 类型的异常不触发重试', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw 'string error' // eslint-disable-line no-throw-literal
    }

    await expect(withRetry(op)).rejects.toBe('string error')
    expect(callCount).toBe(1)
    expect(sleepCalls).toHaveLength(0)
  })

  it('SQLITE_BUSY 错误触发重试，恢复后返回结果', async () => {
    let callCount = 0
    const op = async () => {
      callCount++
      if (callCount <= 2) throw new Error('SQLITE_BUSY: database table is locked')
      return 'recovered'
    }

    const result = await withRetry(op, 'test-label')

    expect(result).toBe('recovered')
    expect(callCount).toBe(3) // 2 失败 + 1 成功
    expect(sleepCalls).toEqual([500, 1000]) // 等待了两次
  })

  it('"database is locked" 错误同样触发重试', async () => {
    let callCount = 0
    const op = async () => {
      callCount++
      if (callCount <= 1) throw new Error('database is locked')
      return 'ok'
    }

    const result = await withRetry(op)

    expect(result).toBe('ok')
    expect(callCount).toBe(2)
    expect(sleepCalls).toEqual([500])
  })

  it('最多重试 3 次后抛出原始错误（共 4 次尝试）', async () => {
    const originalError = new Error('SQLITE_BUSY')
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw originalError
    }

    await expect(withRetry(op, 'exhaust-test')).rejects.toBe(originalError)
    expect(callCount).toBe(4) // 1 初始 + 3 重试
    expect(sleepCalls).toEqual([500, 1000, 1500])
  })

  it('重试间隔为 500ms、1000ms、1500ms', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw new Error('database is locked')
    }

    await expect(withRetry(op)).rejects.toThrow('database is locked')
    expect(sleepCalls).toEqual([500, 1000, 1500])
  })

  it('超过重试次数时抛出最后一次错误', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw new Error(`SQLITE_BUSY attempt ${callCount}`)
    }

    try {
      await withRetry(op)
    } catch (e) {
      // lastError 在每次 catch 中被覆盖，抛出最后一次的错误
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('SQLITE_BUSY attempt 4')
    }
  })
})
