import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isRetriableError,
  withRetry,
  RETRY_CONFIG,
  _internals,
} from '@/lib/shared/db-retry'

describe('isRetriableError', () => {
  it('识别包含 P2034 的错误', () => {
    expect(isRetriableError(new Error('P2034: Transaction failed due to a write conflict'))).toBe(true)
  })

  it('识别包含 "deadlock detected" 的错误', () => {
    expect(isRetriableError(new Error('deadlock detected'))).toBe(true)
  })

  it('识别包含 "could not serialize access" 的错误', () => {
    expect(isRetriableError(new Error('could not serialize access due to concurrent update'))).toBe(true)
  })

  it('不识别其他 Error', () => {
    expect(isRetriableError(new Error('connection refused'))).toBe(false)
    expect(isRetriableError(new Error('unique constraint violation'))).toBe(false)
  })

  it('不识别非 Error 类型', () => {
    expect(isRetriableError('string error')).toBe(false)
    expect(isRetriableError(null)).toBe(false)
    expect(isRetriableError(undefined)).toBe(false)
    expect(isRetriableError(42)).toBe(false)
  })
})

describe('RETRY_CONFIG', () => {
  it('最大重试次数为 3', () => {
    expect(RETRY_CONFIG.maxRetries).toBe(3)
  })

  it('延迟间隔为 [200, 500, 1000]', () => {
    expect(RETRY_CONFIG.delays).toEqual([200, 500, 1000])
  })
})

describe('withRetry', () => {
  const sleepCalls: number[] = []
  let originalSleep: typeof _internals.sleep

  beforeEach(() => {
    sleepCalls.length = 0
    originalSleep = _internals.sleep
    // 注入零延迟 sleep，仅记录调用参数
    _internals.sleep = async (ms: number) => {
      sleepCalls.push(ms)
    }
  })

  afterEach(() => {
    _internals.sleep = originalSleep
  })

  it('首次成功直接返回结果，不调用 sleep', async () => {
    const result = await withRetry(() => Promise.resolve(42))
    expect(result).toBe(42)
    expect(sleepCalls).toHaveLength(0)
  })

  it('非可重试错误立即抛出，不重试', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw new Error('connection refused')
    }

    await expect(withRetry(op)).rejects.toThrow('connection refused')
    expect(callCount).toBe(1)
    expect(sleepCalls).toHaveLength(0)
  })

  it('非 Error 类型异常不触发重试', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw 'string error'  
    }

    await expect(withRetry(op)).rejects.toBe('string error')
    expect(callCount).toBe(1)
    expect(sleepCalls).toHaveLength(0)
  })

  it('P2034 事务冲突触发重试，恢复后返回结果', async () => {
    let callCount = 0
    const op = async () => {
      callCount++
      if (callCount <= 2) throw new Error('P2034: Transaction failed due to a write conflict')
      return 'recovered'
    }

    const result = await withRetry(op, 'test-label')

    expect(result).toBe('recovered')
    expect(callCount).toBe(3) // 2 失败 + 1 成功
    expect(sleepCalls).toEqual([200, 500]) // 按 delays 顺序等待
  })

  it('"deadlock detected" 同样触发重试', async () => {
    let callCount = 0
    const op = async () => {
      callCount++
      if (callCount <= 1) throw new Error('deadlock detected')
      return 'ok'
    }

    const result = await withRetry(op)

    expect(result).toBe('ok')
    expect(callCount).toBe(2)
    expect(sleepCalls).toEqual([200])
  })

  it('"could not serialize access" 同样触发重试', async () => {
    let callCount = 0
    const op = async () => {
      callCount++
      if (callCount <= 1) throw new Error('could not serialize access due to concurrent update')
      return 'serialized'
    }

    const result = await withRetry(op)

    expect(result).toBe('serialized')
    expect(callCount).toBe(2)
    expect(sleepCalls).toEqual([200])
  })

  it('最多重试 3 次后抛出最后一次错误（共 4 次尝试），sleep 序列为 [200, 500, 1000]', async () => {
    let callCount = 0
    const op = async (): Promise<never> => {
      callCount++
      throw new Error(`P2034: conflict attempt ${callCount}`)
    }

    try {
      await withRetry(op, 'exhaust-test')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('P2034: conflict attempt 4')
    }

    expect(callCount).toBe(4) // 1 初始 + 3 重试
    expect(sleepCalls).toEqual([200, 500, 1000])
  })
})
