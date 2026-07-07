import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'

// ============================================================
// 内存模拟 Redis 存储（模拟 SET NX EX / eval Lua / DEL 语义）
// ============================================================

/** 模拟 Redis 键值对，含过期时间戳 */
interface RedisEntry {
  value: string
  expiresAt: number // Date.now() 时间戳，-1 表示永不过期
}

const store = new Map<string, RedisEntry>()

/** 清理已过期的键 */
function purgeExpired() {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.expiresAt > 0 && now >= entry.expiresAt) {
      store.delete(key)
    }
  }
}

/** 模拟 redis.set 方法（仅支持 SET key value EX ttl NX 模式） */
function mockRedisSet(
  key: string,
  value: string,
  exFlag?: string,
  ttlSeconds?: number,
  nxFlag?: string
): string | null {
  purgeExpired()

  if (nxFlag === 'NX') {
    if (store.has(key)) return null // 键已存在，NX 语义拒绝
    const expiresAt = exFlag === 'EX' && ttlSeconds
      ? Date.now() + ttlSeconds * 1000
      : -1
    store.set(key, { value, expiresAt })
    return 'OK'
  }

  // 非 NX 模式：直接覆盖
  const expiresAt = exFlag === 'EX' && ttlSeconds
    ? Date.now() + ttlSeconds * 1000
    : -1
  store.set(key, { value, expiresAt })
  return 'OK'
}

/** 模拟 redis.eval（Lua 原子 compare-and-delete 脚本） */
function mockRedisEval(
  _script: string,
  _numKeys: number,
  key: string,
  expectedValue: string
): number {
  purgeExpired()
  const entry = store.get(key)
  if (entry && entry.value === expectedValue) {
    store.delete(key)
    return 1
  }
  return 0
}

/** 模拟 redis.del */
function mockRedisDel(key: string): number {
  purgeExpired()
  if (store.has(key)) {
    store.delete(key)
    return 1
  }
  return 0
}

// Mock redis 模块：拦截所有 Redis 调用到内存模拟
vi.mock('@/lib/shared/redis', () => ({
  redis: {
    set: vi.fn((...args: unknown[]) => {
      return Promise.resolve(
        mockRedisSet(
          args[0] as string,
          args[1] as string,
          args[2] as string | undefined,
          args[3] as number | undefined,
          args[4] as string | undefined
        )
      )
    }),
    eval: vi.fn((...args: unknown[]) => {
      return Promise.resolve(
        mockRedisEval(
          args[0] as string,
          args[1] as number,
          args[2] as string,
          args[3] as string
        )
      )
    }),
    del: vi.fn((...args: unknown[]) => {
      return Promise.resolve(mockRedisDel(args[0] as string))
    }),
  },
}))

// 导入被测模块（在 mock 之后）
import { acquireLock, releaseLock, generateLockKey, withCreditLock } from '@/lib/shared/distributed-lock'

// ============================================================
// 生成器
// ============================================================

/** 合法锁 key 生成器 */
const lockKeyArb = fc.stringMatching(/^lock:[a-z]{1,10}:[a-z0-9]{1,8}$/)

/** 合法锁 value（UUID 格式简化） */
const lockValueArb = fc.uuid()

/** 正整数返回值 */
const returnValueArb = fc.oneof(
  fc.integer(),
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.constant(null),
  fc.array(fc.integer(), { minLength: 0, maxLength: 5 })
)

// ============================================================
// 测试
// ============================================================

describe('distributed-lock 属性测试', () => {
  beforeEach(() => {
    store.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    store.clear()
    vi.useRealTimers()
  })

  // --------------------------------------------------------
  // Property 1: 互斥性 — 同一 key 的锁在持有期间不能被第二个调用者获取
  // --------------------------------------------------------
  describe('Property 1: 互斥性', () => {
    it('同一 key 已被持有时，第二次 acquireLock 返回 false', async () => {
      await fc.assert(
        fc.asyncProperty(lockKeyArb, lockValueArb, lockValueArb, async (key, value1, value2) => {
          store.clear()

          // 第一个调用者成功获取
          const first = await acquireLock(key, value1)
          expect(first).toBe(true)

          // 第二个调用者尝试获取同一 key（不同 value），应失败
          const second = await acquireLock(key, value2)
          expect(second).toBe(false)
        }),
        { numRuns: 100 }
      )
    })

    it('不同 key 互不影响，可同时持有', async () => {
      await fc.assert(
        fc.asyncProperty(
          lockKeyArb,
          lockKeyArb,
          lockValueArb,
          lockValueArb,
          async (key1, key2, value1, value2) => {
            // 确保两个 key 不同
            fc.pre(key1 !== key2)
            store.clear()

            const first = await acquireLock(key1, value1)
            const second = await acquireLock(key2, value2)

            expect(first).toBe(true)
            expect(second).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 2: 释放后可重入 — 锁释放后，新调用者可以获取
  // --------------------------------------------------------
  describe('Property 2: 释放后可重入', () => {
    it('持有者释放锁后，新调用者可成功获取同一 key', async () => {
      await fc.assert(
        fc.asyncProperty(lockKeyArb, lockValueArb, lockValueArb, async (key, value1, value2) => {
          store.clear()

          // 获取 → 释放
          await acquireLock(key, value1)
          const released = await releaseLock(key, value1)
          expect(released).toBe(true)

          // 新调用者获取成功
          const reacquired = await acquireLock(key, value2)
          expect(reacquired).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('非持有者释放锁时返回 false，锁仍然有效', async () => {
      await fc.assert(
        fc.asyncProperty(lockKeyArb, lockValueArb, lockValueArb, async (key, ownerValue, intruderValue) => {
          fc.pre(ownerValue !== intruderValue)
          store.clear()

          await acquireLock(key, ownerValue)

          // 非持有者尝试释放 → 失败
          const badRelease = await releaseLock(key, intruderValue)
          expect(badRelease).toBe(false)

          // 锁仍然被持有
          const retryAcquire = await acquireLock(key, intruderValue)
          expect(retryAcquire).toBe(false)
        }),
        { numRuns: 100 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 3: 超时自动释放 — 锁超时后自动释放，不永久阻塞
  // --------------------------------------------------------
  describe('Property 3: 超时自动释放', () => {
    it('锁 TTL 过期后，新调用者可成功获取', async () => {
      await fc.assert(
        fc.asyncProperty(lockKeyArb, lockValueArb, lockValueArb, async (key, value1, value2) => {
          store.clear()

          await acquireLock(key, value1)

          // 确认锁被持有
          const blocked = await acquireLock(key, value2)
          expect(blocked).toBe(false)

          // 推进时间超过 TTL（720 秒 = 720000ms）
          vi.advanceTimersByTime(720_001)

          // TTL 过期后新调用者可获取
          const afterExpiry = await acquireLock(key, value2)
          expect(afterExpiry).toBe(true)
        }),
        { numRuns: 50 }
      )
    })

    it('TTL 未过期时锁仍有效', async () => {
      await fc.assert(
        fc.asyncProperty(
          lockKeyArb,
          lockValueArb,
          lockValueArb,
          fc.integer({ min: 1, max: 719_000 }), // TTL 内的任意时间
          async (key, value1, value2, advanceMs) => {
            store.clear()

            await acquireLock(key, value1)
            vi.advanceTimersByTime(advanceMs)

            // TTL 未过期，锁仍有效
            const stillBlocked = await acquireLock(key, value2)
            expect(stillBlocked).toBe(false)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 4: 操作原子性 — withCreditLock 包裹的操作抛错时锁正确释放
  // --------------------------------------------------------
  describe('Property 4: 操作原子性', () => {
    it('操作成功时锁正确释放', async () => {
      vi.useRealTimers() // withCreditLock 内部有 sleep，使用真实计时器

      store.clear()
      const result = await withCreditLock(async () => {
        return 42
      }, 'test-success')

      expect(result).toBe(42)

      // 锁应已释放：全局积分写锁 key 不应存在于 store
      expect(store.has('lock:credit:global')).toBe(false)
    })

    it('操作抛错时锁也正确释放', async () => {
      vi.useRealTimers()

      store.clear()
      const testError = new Error('模拟业务错误')

      await expect(
        withCreditLock(async () => {
          throw testError
        }, 'test-error')
      ).rejects.toThrow('模拟业务错误')

      // 锁应已释放
      expect(store.has('lock:credit:global')).toBe(false)
    })

    it('任意返回值/抛错组合下，锁最终都被释放', async () => {
      vi.useRealTimers()

      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // true=成功, false=抛错
          fc.integer({ min: -1000, max: 1000 }),
          async (shouldSucceed, returnVal) => {
            store.clear()

            if (shouldSucceed) {
              const result = await withCreditLock(async () => returnVal, 'prop-test')
              expect(result).toBe(returnVal)
            } else {
              await expect(
                withCreditLock(async () => {
                  throw new Error(`err-${returnVal}`)
                }, 'prop-test')
              ).rejects.toThrow()
            }

            // 无论成功或失败，锁都应被释放
            expect(store.has('lock:credit:global')).toBe(false)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 5: 不可重入 — withCreditLock 内部再调用 withCreditLock 应超时失败
  // --------------------------------------------------------
  describe('Property 5: 不可重入', () => {
    it('嵌套调用 withCreditLock 时内层因同一 key 已被持有而获取失败', async () => {
      vi.useRealTimers()

      store.clear()

      // 直接测试底层：先持有全局积分写锁 key，再验证同 key 无法再获取
      const lockKey = 'lock:credit:global'
      const holdValue = 'holder-001'

      const acquired = await acquireLock(lockKey, holdValue)
      expect(acquired).toBe(true)

      // 在锁持有期间，尝试以 NX 模式再获取同一 key（模拟 withCreditLock 内部重入）
      const reentrant = await acquireLock(lockKey, 'reentrant-002')
      expect(reentrant).toBe(false)

      // 清理
      await releaseLock(lockKey, holdValue)
    })

    it('不可重入性质对任意锁值成立', async () => {
      await fc.assert(
        fc.asyncProperty(lockValueArb, lockValueArb, async (outerValue, innerValue) => {
          store.clear()
          const lockKey = 'lock:credit:global'

          // 外层持有
          const outer = await acquireLock(lockKey, outerValue)
          expect(outer).toBe(true)

          // 内层尝试获取同一 key → 失败（不可重入）
          const inner = await acquireLock(lockKey, innerValue)
          expect(inner).toBe(false)

          // 清理
          await releaseLock(lockKey, outerValue)
        }),
        { numRuns: 100 }
      )
    })
  })

  // --------------------------------------------------------
  // Property 6: 返回值传递 — withCreditLock 返回包裹函数的返回值
  // --------------------------------------------------------
  describe('Property 6: 返回值传递', () => {
    it('withCreditLock 透传任意类型返回值', async () => {
      vi.useRealTimers()

      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.integer(),
            fc.string({ minLength: 0, maxLength: 50 }),
            fc.constant(null),
            fc.constant(undefined),
            fc.array(fc.integer(), { minLength: 0, maxLength: 5 }),
            fc.record({ id: fc.integer(), name: fc.string() })
          ),
          async (expectedReturn) => {
            store.clear()

            const actual = await withCreditLock(async () => expectedReturn, 'return-test')
            expect(actual).toEqual(expectedReturn)
          }
        ),
        { numRuns: 50 }
      )
    })

    it('withCreditLock 透传 Promise resolve 的值', async () => {
      vi.useRealTimers()

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 9999 }), async (num) => {
          store.clear()

          const result = await withCreditLock(async () => {
            // 模拟异步计算
            return num * 2
          }, 'async-return')

          expect(result).toBe(num * 2)
        }),
        { numRuns: 100 }
      )
    })
  })

  // --------------------------------------------------------
  // 补充: generateLockKey 纯函数属性
  // --------------------------------------------------------
  describe('补充: generateLockKey 纯函数', () => {
    it('相同输入产出相同 key（确定性）', () => {
      fc.assert(
        fc.property(fc.uuid(), (shotGroupId) => {
          const k1 = generateLockKey(shotGroupId)
          const k2 = generateLockKey(shotGroupId)
          expect(k1).toBe(k2)
        }),
        { numRuns: 100 }
      )
    })

    it('不同输入产出不同 key（无碰撞）', () => {
      fc.assert(
        fc.property(fc.uuid(), fc.uuid(), (id1, id2) => {
          fc.pre(id1 !== id2)
          expect(generateLockKey(id1)).not.toBe(generateLockKey(id2))
        }),
        { numRuns: 100 }
      )
    })

    it('输出始终包含 lock:generate:shotGroup: 前缀', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), (id) => {
          const key = generateLockKey(id)
          expect(key).toBe(`lock:generate:shotGroup:${id}`)
        }),
        { numRuns: 100 }
      )
    })
  })
})
