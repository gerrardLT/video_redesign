/**
 * ConcurrencyController 单元测试
 * 覆盖: checkAndIncrement, decrement, reconcile, buildRejectionResponse
 *
 * Mock 策略：
 * - '@/lib/redis': 基于 Map 的内存 Redis 模拟，支持 eval/get/set
 * - '@/lib/db': vi.fn() 模拟 Prisma 查询
 *
 * Requirements: 3.4, 3.5, 3.6, 6.1, 6.3, 6.4, 7.1, 7.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================
// Mock: 基于 Map 的内存 Redis
// ============================
const redisStore = new Map<string, string>()

/**
 * 模拟 Redis eval 执行 Lua 脚本逻辑
 * 根据脚本内容判断执行 check-and-increment 还是 safe-decrement
 */
function mockRedisEval(script: string, _numKeys: number, key: string, ...args: string[]) {
  // 判断是 check-and-increment 脚本
  if (script.includes('INCR') && script.includes('DECR') && args.length > 0) {
    const limit = parseInt(args[0], 10)
    const currentStr = redisStore.get(key) || '0'
    const current = parseInt(currentStr, 10) + 1 // 模拟 INCR

    if (current > limit) {
      // 超限，回滚（不递增）
      return [0, current - 1]
    }
    // 放行，计数已递增
    redisStore.set(key, current.toString())
    return [1, current]
  }

  // 判断是 safe-decrement 脚本
  if (script.includes('DECR') && script.includes('GET') && !script.includes('INCR')) {
    const currentStr = redisStore.get(key) || '0'
    const current = parseInt(currentStr, 10)

    if (current > 0) {
      const newVal = current - 1
      redisStore.set(key, newVal.toString())
      return newVal
    }
    return 0
  }

  return null
}

vi.mock('@/lib/redis', () => ({
  redis: {
    eval: vi.fn(mockRedisEval),
    get: vi.fn((key: string) => redisStore.get(key) || null),
    set: vi.fn((key: string, value: string) => {
      redisStore.set(key, value)
      return 'OK'
    }),
  },
}))

// ============================
// Mock: Prisma 数据库
// ============================
const mockProjectCount = vi.fn()
const mockGenerationJobCount = vi.fn()
const mockProjectFindMany = vi.fn()
const mockGenerationJobFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    project: {
      count: (...args: unknown[]) => mockProjectCount(...args),
      findMany: (...args: unknown[]) => mockProjectFindMany(...args),
    },
    generationJob: {
      count: (...args: unknown[]) => mockGenerationJobCount(...args),
      findMany: (...args: unknown[]) => mockGenerationJobFindMany(...args),
    },
  },
}))

// ============================
// 导入被测模块（在 mock 之后）
// ============================
import {
  checkAndIncrement,
  decrement,
  reconcile,
  buildRejectionResponse,
  buildConcurrencyKey,
} from '@/lib/concurrency-controller'

describe('ConcurrencyController', () => {
  beforeEach(() => {
    // 每个测试前清空 Redis 存储和 mock 调用记录
    redisStore.clear()
    vi.clearAllMocks()
  })

  // ============================
  // checkAndIncrement 测试
  // ============================
  describe('checkAndIncrement', () => {
    it('当计数 < 限制时，返回 allowed=true 并递增计数', async () => {
      // 初始计数为 0，限制为 3
      const result = await checkAndIncrement('user1', 'generate', 3)

      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(1)
      expect(result.limit).toBe(3)
      // Redis 中计数应已递增
      expect(redisStore.get('concurrency:user1:generate')).toBe('1')
    })

    it('当计数 >= 限制时，返回 allowed=false 且计数不递增', async () => {
      // 预设 Redis 中计数已达到限制
      redisStore.set('concurrency:user1:parse', '1')

      const result = await checkAndIncrement('user1', 'parse', 1)

      expect(result.allowed).toBe(false)
      expect(result.currentCount).toBe(1) // 保持原值
      expect(result.limit).toBe(1)
      // Redis 中计数不应变化（回滚了）
      expect(redisStore.get('concurrency:user1:parse')).toBe('1')
    })

    it('边界值: 当计数 === limit-1 时，允许通过（恰好在限制下）', async () => {
      // 限制为 3，当前计数为 2（limit-1）
      redisStore.set('concurrency:user1:generate', '2')

      const result = await checkAndIncrement('user1', 'generate', 3)

      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(3)
      expect(redisStore.get('concurrency:user1:generate')).toBe('3')
    })

    it('边界值: 当计数 === limit 时，拒绝', async () => {
      // 限制为 3，当前计数为 3（已达限制）
      redisStore.set('concurrency:user1:generate', '3')

      const result = await checkAndIncrement('user1', 'generate', 3)

      expect(result.allowed).toBe(false)
      expect(result.currentCount).toBe(3) // 保持原值
      expect(redisStore.get('concurrency:user1:generate')).toBe('3')
    })

    it('当 limit 为 Infinity 时，直接放行且不调用 Redis', async () => {
      const { redis } = await import('@/lib/redis')

      const result = await checkAndIncrement('user1', 'generate', Infinity)

      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(0)
      expect(result.limit).toBe(Infinity)
      // 不应调用 Redis eval
      expect(redis.eval).not.toHaveBeenCalled()
    })

    it('多次递增直到达到限制', async () => {
      // 限制为 2
      const result1 = await checkAndIncrement('user1', 'merge', 2)
      expect(result1.allowed).toBe(true)
      expect(result1.currentCount).toBe(1)

      const result2 = await checkAndIncrement('user1', 'merge', 2)
      expect(result2.allowed).toBe(true)
      expect(result2.currentCount).toBe(2)

      // 第三次应被拒绝
      const result3 = await checkAndIncrement('user1', 'merge', 2)
      expect(result3.allowed).toBe(false)
      expect(result3.currentCount).toBe(2)
    })
  })

  // ============================
  // decrement 测试
  // ============================
  describe('decrement', () => {
    it('正常递减: 计数从 2 减少到 1', async () => {
      redisStore.set('concurrency:user1:generate', '2')

      await decrement('user1', 'generate')

      expect(redisStore.get('concurrency:user1:generate')).toBe('1')
    })

    it('计数为 0 时不变为负数（零底线保护）', async () => {
      redisStore.set('concurrency:user1:parse', '0')

      await decrement('user1', 'parse')

      // 应保持 0，不变为 -1
      expect(redisStore.get('concurrency:user1:parse')).toBe('0')
    })

    it('key 不存在时（隐含计数为 0），不变为负数', async () => {
      // 不预设任何值
      await decrement('user1', 'merge')

      // Map 中如果没有改变，则 get 返回 undefined（即视为 0）
      const val = redisStore.get('concurrency:user1:merge')
      expect(val === undefined || val === '0').toBe(true)
    })

    it('连续递减到 0 后保持', async () => {
      redisStore.set('concurrency:user1:generate', '1')

      await decrement('user1', 'generate')
      expect(redisStore.get('concurrency:user1:generate')).toBe('0')

      // 再次递减不应变为负数
      await decrement('user1', 'generate')
      expect(redisStore.get('concurrency:user1:generate')).toBe('0')
    })
  })

  // ============================
  // reconcile 测试
  // ============================
  describe('reconcile', () => {
    it('正偏差修复: Redis 计数 > DB 真实计数时，修正 Redis', async () => {
      // Redis 中 parse=5，但 DB 中实际只有 2 个活跃任务
      redisStore.set('concurrency:user1:parse', '5')
      redisStore.set('concurrency:user1:generate', '0')
      redisStore.set('concurrency:user1:merge', '0')

      // 模拟 DB 查询结果
      mockProjectCount
        .mockResolvedValueOnce(2)  // parse: DOWNLOADING/PARSING
        .mockResolvedValueOnce(0)  // merge: MERGING
      mockGenerationJobCount.mockResolvedValueOnce(0) // generate

      await reconcile('user1')

      // parse 应被修正为 2
      expect(redisStore.get('concurrency:user1:parse')).toBe('2')
    })

    it('负偏差修复: Redis 计数 < DB 真实计数时，修正 Redis', async () => {
      // Redis 中 generate=1，但 DB 中实际有 3 个活跃任务
      redisStore.set('concurrency:user1:parse', '0')
      redisStore.set('concurrency:user1:generate', '1')
      redisStore.set('concurrency:user1:merge', '0')

      mockProjectCount
        .mockResolvedValueOnce(0)  // parse
        .mockResolvedValueOnce(0)  // merge
      mockGenerationJobCount.mockResolvedValueOnce(3) // generate

      await reconcile('user1')

      // generate 应被修正为 3
      expect(redisStore.get('concurrency:user1:generate')).toBe('3')
    })

    it('无偏差: Redis 计数 === DB 计数时，不修改 Redis', async () => {
      // Redis 和 DB 一致
      redisStore.set('concurrency:user1:parse', '1')
      redisStore.set('concurrency:user1:generate', '2')
      redisStore.set('concurrency:user1:merge', '0')

      mockProjectCount
        .mockResolvedValueOnce(1)  // parse
        .mockResolvedValueOnce(0)  // merge
      mockGenerationJobCount.mockResolvedValueOnce(2) // generate

      const { redis } = await import('@/lib/redis')
      vi.mocked(redis.set).mockClear()

      await reconcile('user1')

      // 不应调用 set（无需修正）
      expect(redis.set).not.toHaveBeenCalled()
    })
  })

  // ============================
  // buildRejectionResponse 测试
  // ============================
  describe('buildRejectionResponse', () => {
    it('FREE tier: nextTier 是 MONTHLY，nextTierLimit > currentLimit', () => {
      const response = buildRejectionResponse('FREE', 'generate', 1)

      expect(response.error).toBeTruthy()
      expect(response.code).toBe('CONCURRENCY_LIMIT_REACHED')
      expect(response.currentTier).toBe('FREE')
      expect(response.currentLimit).toBe(1)
      // MONTHLY generate 限制为 3
      expect(response.nextTierLimit).toBe(3)
      expect(response.upgradePrompt.nextTier).toContain('月卡')
      expect(response.upgradePrompt.benefit).toBeTruthy()
    })

    it('MONTHLY tier: nextTier 是 YEARLY，nextTierLimit 更高或 unlimited', () => {
      const response = buildRejectionResponse('MONTHLY', 'generate', 3)

      expect(response.code).toBe('CONCURRENCY_LIMIT_REACHED')
      expect(response.currentTier).toBe('MONTHLY')
      expect(response.currentLimit).toBe(3)
      // YEARLY generate 限制为 Infinity → 'unlimited'
      expect(response.nextTierLimit).toBe('unlimited')
      expect(response.upgradePrompt.nextTier).toContain('年卡')
      expect(response.upgradePrompt.benefit).toBeTruthy()
    })

    it('MONTHLY tier parse: nextTierLimit 是数字且更高', () => {
      const response = buildRejectionResponse('MONTHLY', 'parse', 2)

      expect(response.currentTier).toBe('MONTHLY')
      expect(response.currentLimit).toBe(2)
      // YEARLY parse 限制为 5
      expect(response.nextTierLimit).toBe(5)
    })

    it('响应始终包含完整的必要字段', () => {
      const tiers = ['FREE', 'MONTHLY', 'YEARLY'] as const
      const taskTypes = ['parse', 'generate', 'merge'] as const

      for (const tier of tiers) {
        for (const taskType of taskTypes) {
          const response = buildRejectionResponse(tier, taskType, 1)

          // 验证所有必要字段存在
          expect(response).toHaveProperty('error')
          expect(response).toHaveProperty('code')
          expect(response).toHaveProperty('currentTier')
          expect(response).toHaveProperty('currentLimit')
          expect(response).toHaveProperty('nextTierLimit')
          expect(response).toHaveProperty('upgradePrompt')
          expect(response.upgradePrompt).toHaveProperty('nextTier')
          expect(response.upgradePrompt).toHaveProperty('benefit')

          // code 始终为固定值
          expect(response.code).toBe('CONCURRENCY_LIMIT_REACHED')
          // error 为非空字符串
          expect(response.error.length).toBeGreaterThan(0)
        }
      }
    })

    it('FREE tier merge: nextTierLimit 应为 MONTHLY 的 merge 限制', () => {
      const response = buildRejectionResponse('FREE', 'merge', 1)

      expect(response.currentTier).toBe('FREE')
      expect(response.currentLimit).toBe(1)
      // MONTHLY merge 限制为 1（与 FREE 相同，但 upgradePrompt 仍给出提示）
      expect(response.nextTierLimit).toBe(1)
    })
  })

  // ============================
  // buildConcurrencyKey 测试
  // ============================
  describe('buildConcurrencyKey', () => {
    it('生成正确格式的 Redis key', () => {
      expect(buildConcurrencyKey('user123', 'parse')).toBe('concurrency:user123:parse')
      expect(buildConcurrencyKey('user456', 'generate')).toBe('concurrency:user456:generate')
      expect(buildConcurrencyKey('user789', 'merge')).toBe('concurrency:user789:merge')
    })
  })
})
