/**
 * 属性测试：PostgreSQL 事务冲突重试语义
 *
 * 验证 withRetry 对 PostgreSQL 可重试事务冲突错误的行为：
 * - P2034: Prisma 事务写冲突/死锁（Transaction failed due to a write conflict or a deadlock）
 * - deadlock detected: PostgreSQL 原生死锁检测
 * - could not serialize access: PostgreSQL 序列化隔离级别冲突
 *
 * 属性覆盖：
 * (a) N 次可重试失败后成功 → sleep 序列为 [200, 500, 1000] 的前 N 个元素
 * (b) 非可重试错误 → 立即抛出，调用次数 1，sleep 次数 0
 * (c) 连续 4 次可重试错误 → 抛出原始错误，总调用 4 次，sleep 序列 [200, 500, 1000]
 * (d) 第 M+1 次成功时返回值严格相等
 * (e) M 次可重试后一次非可重试 → 非可重试错误立即抛出，sleep 次数 = M
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**
 */
import * as fc from 'fast-check'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { withRetry, _internals, RETRY_CONFIG } from '@/lib/shared/db-retry'

// ─── 生成器定义 ────────────────────────────────────────────────────────────────

/**
 * 生成 PostgreSQL 可重试事务冲突错误消息
 * 包含 P2034、deadlock detected、could not serialize access 及其随机后缀变体
 */
const retriableErrorMessageArb = fc.oneof(
  fc.constant('P2034: Transaction failed due to a write conflict'),
  fc.constant('P2034: Transaction failed due to a write conflict or a deadlock'),
  fc.constant('deadlock detected'),
  fc.constant('could not serialize access'),
  fc.string({ minLength: 0, maxLength: 50 }).map((s) => `P2034: ${s}`),
  fc.string({ minLength: 0, maxLength: 50 }).map((s) => `deadlock detected: ${s}`),
  fc.string({ minLength: 0, maxLength: 50 }).map((s) => `could not serialize access due to ${s}`)
)

/**
 * 生成非可重试错误消息（过滤排除三种 PostgreSQL 可重试特征）
 */
const nonRetriableErrorMessageArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(
    (s) =>
      !s.includes('P2034') &&
      !s.includes('deadlock detected') &&
      !s.includes('could not serialize access')
  )

// ─── 属性测试 ──────────────────────────────────────────────────────────────────

describe('PostgreSQL 事务冲突重试属性测试', () => {
  let originalSleep: typeof _internals.sleep
  let sleepCalls: number[]

  beforeEach(() => {
    originalSleep = _internals.sleep
    sleepCalls = []
    // 注入零延迟 sleep，仅记录调用参数
    _internals.sleep = async (ms: number) => {
      sleepCalls.push(ms)
    }
  })

  afterEach(() => {
    _internals.sleep = originalSleep
  })

  it('属性: N 次重试后成功 → sleep 序列为 [200, 500, 1000] 的前 N 个元素', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        retriableErrorMessageArb,
        async (retryCount, errorMsg) => {
          sleepCalls = []
          let callCount = 0

          const operation = async () => {
            callCount++
            if (callCount <= retryCount) {
              throw new Error(errorMsg)
            }
            return 'success'
          }

          const result = await withRetry(operation)
          expect(result).toBe('success')
          expect(callCount).toBe(retryCount + 1)

          // sleep 序列应为 RETRY_CONFIG.delays 的前 N 个元素
          const expectedDelays = RETRY_CONFIG.delays.slice(0, retryCount)
          expect(sleepCalls).toEqual(expectedDelays)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('属性: 非可重试错误 → 立即抛出，调用次数 1，sleep 次数 0', async () => {
    await fc.assert(
      fc.asyncProperty(nonRetriableErrorMessageArb, async (errorMsg) => {
        sleepCalls = []
        let callCount = 0

        const operation = async () => {
          callCount++
          throw new Error(errorMsg)
        }

        await expect(withRetry(operation)).rejects.toThrow(errorMsg)
        expect(callCount).toBe(1)
        expect(sleepCalls).toHaveLength(0)
      }),
      { numRuns: 100 }
    )
  })

  it('属性: 连续 4 次可重试 → 抛出原始错误，总调用 4 次，sleep 序列 [200, 500, 1000]', async () => {
    await fc.assert(
      fc.asyncProperty(retriableErrorMessageArb, async (errorMsg) => {
        sleepCalls = []
        let callCount = 0
        const errors: Error[] = []

        const operation = async () => {
          callCount++
          const err = new Error(errorMsg)
          errors.push(err)
          throw err
        }

        try {
          await withRetry(operation)
          // 不应走到这里
          expect.fail('应该抛出错误')
        } catch (thrown) {
          // 抛出的是最后一次捕获的错误
          expect(thrown).toBe(errors[errors.length - 1])
        }

        expect(callCount).toBe(4) // 1 初始 + 3 重试
        expect(sleepCalls).toEqual([200, 500, 1000])
      }),
      { numRuns: 100 }
    )
  })

  it('属性: 第 M+1 次成功时返回值严格相等', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        retriableErrorMessageArb,
        fc.oneof(
          fc.integer(),
          fc.string({ minLength: 1 }),
          fc.constant(null),
          fc.constant(true),
          fc.constant(undefined),
          fc.double({ noNaN: true })
        ),
        async (failuresBeforeSuccess, errorMsg, returnValue) => {
          sleepCalls = []
          let callCount = 0

          const operation = async () => {
            callCount++
            if (callCount <= failuresBeforeSuccess) {
              throw new Error(errorMsg)
            }
            return returnValue
          }

          const result = await withRetry(operation)
          // 返回值严格相等（===）
          expect(result).toBe(returnValue)
          expect(callCount).toBe(failuresBeforeSuccess + 1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('属性: M 次可重试后一次非可重试 → 非可重试错误立即抛出，sleep 次数 = M', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        retriableErrorMessageArb,
        nonRetriableErrorMessageArb,
        async (retriableFailures, retriableMsg, nonRetriableMsg) => {
          sleepCalls = []
          let callCount = 0

          const operation = async () => {
            callCount++
            if (callCount <= retriableFailures) {
              throw new Error(retriableMsg)
            }
            // 第 M+1 次抛出非可重试错误
            throw new Error(nonRetriableMsg)
          }

          await expect(withRetry(operation)).rejects.toThrow(nonRetriableMsg)
          expect(callCount).toBe(retriableFailures + 1)
          // sleep 次数等于可重试失败次数
          expect(sleepCalls).toHaveLength(retriableFailures)
        }
      ),
      { numRuns: 100 }
    )
  })
})
