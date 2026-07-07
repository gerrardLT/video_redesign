/**
 * 并发对账 Worker 单元测试
 * 测试 concurrency-reconcile Worker 和 concurrency-controller 核心对账逻辑：
 * - Redis > DB 时修正 Redis 为 DB 值
 * - Redis < DB 时修正 Redis 为 DB 值
 * - Redis === DB 时不操作
 * - 多用户批量对账
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Redis：vi.mock 工厂不引用外部变量，规避 hoisting 问题
vi.mock('@/lib/shared/redis', () => {
  const store: Record<string, string> = {}
  return {
    redis: {
      get: vi.fn((key: string) => Promise.resolve(store[key] || null)),
      set: vi.fn((key: string, value: string) => {
        store[key] = value
        return Promise.resolve('OK')
      }),
      eval: vi.fn(),
      options: { maxRetriesPerRequest: null },
      status: 'ready',
      // 暴露 store 引用供测试操作
      __store: store,
    },
  }
})

// Mock Prisma
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    project: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

// Mock logger
vi.mock('@/lib/shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock BullMQ Worker 构造函数，捕获 processor
let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      // 通过全局变量传递 processor（避免 hoisting 问题）
      ;(globalThis as Record<string, unknown>).__capturedProcessor = processor
    }
    on() { return this }
  },
}))

// 导入被测模块
import {
  buildConcurrencyKey,
  getActiveTaskCountsFromDB,
  reconcile,
  reconcileAll,
} from '@/lib/shared/concurrency-controller'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'

// 获取 mock 引用
const mockRedis = redis as unknown as {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  __store: Record<string, string>
}
const mockPrisma = prisma as unknown as {
  project: {
    count: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  // 清空模拟 Redis 存储
  const store = mockRedis.__store
  Object.keys(store).forEach(key => delete store[key])
  // 确保 worker 被加载并捕获 processor
  if (!capturedProcessor) {
    await import('@/workers/concurrency-reconcile')
    capturedProcessor = (globalThis as Record<string, unknown>).__capturedProcessor as typeof capturedProcessor
  }
})

/**
 * 设置 Redis 中的并发计数器值
 */
function setRedisCounter(userId: string, taskType: string, value: number) {
  mockRedis.__store[`concurrency:${userId}:${taskType}`] = value.toString()
}

/**
 * 创建模拟 Job 对象
 */
function createMockJob(id = 'job-reconcile-001') {
  return { id, name: 'reconcile', data: {} }
}

describe('concurrency-reconcile', () => {
  describe('buildConcurrencyKey', () => {
    it('生成正确格式的 Redis key', () => {
      expect(buildConcurrencyKey('user-123', 'parse')).toBe('concurrency:user-123:parse')
      expect(buildConcurrencyKey('user-456', 'generate')).toBe('concurrency:user-456:generate')
      expect(buildConcurrencyKey('user-789', 'merge')).toBe('concurrency:user-789:merge')
    })
  })

  describe('getActiveTaskCountsFromDB', () => {
    it('从数据库查询各类型活跃任务计数', async () => {
      // 模拟 prisma.project.count 返回值（按调用顺序：parse, generate, merge）
      mockPrisma.project.count
        .mockResolvedValueOnce(2) // parse: DOWNLOADING + PARSING
        .mockResolvedValueOnce(1) // generate: GENERATING
        .mockResolvedValueOnce(0) // merge: MERGING

      const counts = await getActiveTaskCountsFromDB('user-001')

      expect(counts).toEqual({ parse: 2, generate: 1, merge: 0 })

      // 验证查询条件正确
      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: { userId: 'user-001', status: { in: ['DOWNLOADING', 'PARSING'] } },
      })
      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: { userId: 'user-001', status: 'GENERATING' },
      })
      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: { userId: 'user-001', exportStatus: { in: ['MERGING'] } },
      })
    })
  })

  describe('reconcile - 单用户对账', () => {
    it('Redis > DB 时修正 Redis 为 DB 值（计数泄漏修复）', async () => {
      const userId = 'user-leak'

      // Redis 中记录了 3 个 parse 任务（泄漏导致偏高）
      setRedisCounter(userId, 'parse', 3)
      setRedisCounter(userId, 'generate', 2)
      setRedisCounter(userId, 'merge', 1)

      // DB 真实值：parse=1, generate=0, merge=0
      mockPrisma.project.count
        .mockResolvedValueOnce(1) // parse
        .mockResolvedValueOnce(0) // generate
        .mockResolvedValueOnce(0) // merge

      await reconcile(userId)

      // 验证 Redis 被修正为 DB 值
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-leak:parse', '1')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-leak:generate', '0')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-leak:merge', '0')
    })

    it('Redis < DB 时修正 Redis 为 DB 值（Redis 重启后计数丢失）', async () => {
      const userId = 'user-restart'

      // Redis 重启后计数归零
      setRedisCounter(userId, 'parse', 0)
      setRedisCounter(userId, 'generate', 0)
      setRedisCounter(userId, 'merge', 0)

      // 但 DB 显示确实有活跃任务
      mockPrisma.project.count
        .mockResolvedValueOnce(2) // parse
        .mockResolvedValueOnce(1) // generate
        .mockResolvedValueOnce(1) // merge

      await reconcile(userId)

      // 验证 Redis 被修正为 DB 值
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-restart:parse', '2')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-restart:generate', '1')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-restart:merge', '1')
    })

    it('Redis === DB 时不执行 SET 操作（无偏差不修改）', async () => {
      const userId = 'user-ok'

      // Redis 与 DB 一致
      setRedisCounter(userId, 'parse', 1)
      setRedisCounter(userId, 'generate', 2)
      setRedisCounter(userId, 'merge', 0)

      mockPrisma.project.count
        .mockResolvedValueOnce(1) // parse
        .mockResolvedValueOnce(2) // generate
        .mockResolvedValueOnce(0) // merge

      await reconcile(userId)

      // 无偏差时不调用 set
      expect(mockRedis.set).not.toHaveBeenCalled()
    })

    it('Redis 无 key（null）视为 0，DB=0 时不操作', async () => {
      const userId = 'user-new'

      // Redis 中没有任何 key（新用户/从未产生过任务）
      // mockRedisStore 为空，get 返回 null

      mockPrisma.project.count
        .mockResolvedValueOnce(0) // parse
        .mockResolvedValueOnce(0) // generate
        .mockResolvedValueOnce(0) // merge

      await reconcile(userId)

      // 无偏差不操作
      expect(mockRedis.set).not.toHaveBeenCalled()
    })

    it('部分类型有偏差时只修正有偏差的类型', async () => {
      const userId = 'user-partial'

      // parse 偏高，generate 正常，merge 偏低
      setRedisCounter(userId, 'parse', 3)
      setRedisCounter(userId, 'generate', 1)
      setRedisCounter(userId, 'merge', 0)

      mockPrisma.project.count
        .mockResolvedValueOnce(1) // parse: DB=1, Redis=3 → 需修正
        .mockResolvedValueOnce(1) // generate: DB=1, Redis=1 → 不修正
        .mockResolvedValueOnce(2) // merge: DB=2, Redis=0 → 需修正

      await reconcile(userId)

      // 只修正 parse 和 merge
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-partial:parse', '1')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-partial:merge', '2')
      expect(mockRedis.set).toHaveBeenCalledTimes(2)
    })
  })

  describe('reconcileAll - 批量对账', () => {
    it('多用户批量对账：扫描所有有活跃任务的用户并逐一修复', async () => {
      // findMany 返回有活跃任务的用户列表
      mockPrisma.project.findMany
        .mockResolvedValueOnce([{ userId: 'user-A' }, { userId: 'user-B' }]) // parse 用户
        .mockResolvedValueOnce([{ userId: 'user-B' }, { userId: 'user-C' }]) // generate 用户
        .mockResolvedValueOnce([{ userId: 'user-A' }]) // merge 用户

      // 为每个用户设置 Redis 偏差并配置 DB mock
      setRedisCounter('user-A', 'parse', 3) // 偏高
      setRedisCounter('user-A', 'generate', 0)
      setRedisCounter('user-A', 'merge', 2) // 偏高

      setRedisCounter('user-B', 'parse', 0) // 偏低
      setRedisCounter('user-B', 'generate', 0) // 偏低
      setRedisCounter('user-B', 'merge', 0)

      setRedisCounter('user-C', 'parse', 0)
      setRedisCounter('user-C', 'generate', 1) // 一致
      setRedisCounter('user-C', 'merge', 0)

      // reconcile 内部会调用 project.count（每次 reconcile 调用 3 次）
      // user-A: parse=1, generate=0, merge=0
      mockPrisma.project.count
        .mockResolvedValueOnce(1)  // user-A parse
        .mockResolvedValueOnce(0)  // user-A generate
        .mockResolvedValueOnce(0)  // user-A merge
        // user-B: parse=1, generate=2, merge=0
        .mockResolvedValueOnce(1)  // user-B parse
        .mockResolvedValueOnce(2)  // user-B generate
        .mockResolvedValueOnce(0)  // user-B merge
        // user-C: parse=0, generate=1, merge=0
        .mockResolvedValueOnce(0)  // user-C parse
        .mockResolvedValueOnce(1)  // user-C generate
        .mockResolvedValueOnce(0)  // user-C merge

      await reconcileAll()

      // 验证 findMany 查询了三种类型的活跃用户
      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(3)

      // user-A: parse 3→1, merge 2→0 被修正
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-A:parse', '1')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-A:merge', '0')

      // user-B: parse 0→1, generate 0→2 被修正
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-B:parse', '1')
      expect(mockRedis.set).toHaveBeenCalledWith('concurrency:user-B:generate', '2')

      // user-C: generate 一致不修正
      expect(mockRedis.set).not.toHaveBeenCalledWith('concurrency:user-C:generate', expect.anything())
    })

    it('无活跃任务用户时不执行对账', async () => {
      // 没有任何用户有活跃任务
      mockPrisma.project.findMany
        .mockResolvedValueOnce([]) // parse
        .mockResolvedValueOnce([]) // generate
        .mockResolvedValueOnce([]) // merge

      await reconcileAll()

      // findMany 被调用 3 次（查询三种类型）
      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(3)
      // 无用户需要对账，不调用 count 或 set
      expect(mockPrisma.project.count).not.toHaveBeenCalled()
      expect(mockRedis.set).not.toHaveBeenCalled()
    })

    it('用户去重：同一用户在多种任务中活跃时只对账一次', async () => {
      // user-X 同时有 parse 和 generate 活跃任务
      mockPrisma.project.findMany
        .mockResolvedValueOnce([{ userId: 'user-X' }]) // parse
        .mockResolvedValueOnce([{ userId: 'user-X' }]) // generate
        .mockResolvedValueOnce([{ userId: 'user-X' }]) // merge

      // reconcile user-X 只调用一次（3 次 count）
      setRedisCounter('user-X', 'parse', 1)
      setRedisCounter('user-X', 'generate', 1)
      setRedisCounter('user-X', 'merge', 1)

      mockPrisma.project.count
        .mockResolvedValueOnce(1)  // parse 一致
        .mockResolvedValueOnce(1)  // generate 一致
        .mockResolvedValueOnce(1)  // merge 一致

      await reconcileAll()

      // 只为 user-X 查询 3 次 count（只对账一次）
      expect(mockPrisma.project.count).toHaveBeenCalledTimes(3)
    })
  })

  describe('Worker processor', () => {
    it('Worker processor 调用 reconcileAll 并返回成功结果', async () => {
      // reconcileAll 内部的 findMany 返回空（无需对账）
      mockPrisma.project.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const job = createMockJob()
      const result = await capturedProcessor!(job)

      expect(result).toEqual(
        expect.objectContaining({ success: true, durationMs: expect.any(Number) })
      )
    })

    it('Worker processor 在 reconcileAll 抛错时传播错误', async () => {
      // 模拟数据库连接失败
      mockPrisma.project.findMany.mockRejectedValueOnce(new Error('DB connection lost'))

      const job = createMockJob()

      await expect(capturedProcessor!(job)).rejects.toThrow('DB connection lost')
    })
  })

  describe('Redis 连接异常不崩溃（错误隔离）', () => {
    it('redis.get 抛出 ECONNREFUSED 时，reconcile 传播错误（BullMQ 负责重试）', async () => {
      const userId = 'user-redis-down'

      // DB 正常返回
      mockPrisma.project.count
        .mockResolvedValueOnce(1)  // parse
        .mockResolvedValueOnce(0)  // generate
        .mockResolvedValueOnce(0)  // merge

      // Redis get 抛出连接异常
      mockRedis.get.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:6379')
      )

      // reconcile 应传播 Redis 错误，而非静默吞掉
      await expect(reconcile(userId)).rejects.toThrow('ECONNREFUSED')
    })

    it('redis.set 抛出异常时，reconcile 传播错误', async () => {
      const userId = 'user-set-fail'

      // 设置 Redis 计数偏高
      setRedisCounter(userId, 'parse', 5)
      setRedisCounter(userId, 'generate', 0)
      setRedisCounter(userId, 'merge', 0)

      // DB 返回较低值（触发 set 修正）
      mockPrisma.project.count
        .mockResolvedValueOnce(1)  // parse: 需修正
        .mockResolvedValueOnce(0)  // generate
        .mockResolvedValueOnce(0)  // merge

      // redis.set 在修正时抛出异常
      mockRedis.set.mockRejectedValueOnce(
        new Error('READONLY You can\'t write against a read only replica')
      )

      // reconcile 传播 Redis 写入错误
      await expect(reconcile(userId)).rejects.toThrow('READONLY')
    })

    it('Redis 异常经 Worker processor 传播后不会导致进程崩溃', async () => {
      // findMany 返回一个有活跃任务的用户
      mockPrisma.project.findMany
        .mockResolvedValueOnce([{ userId: 'user-Z' }]) // parse
        .mockResolvedValueOnce([])                      // generate
        .mockResolvedValueOnce([])                      // merge

      // 在 reconcile(user-Z) 时 DB 正常但 Redis get 异常
      mockPrisma.project.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)

      mockRedis.get.mockRejectedValueOnce(
        new Error('Connection is closed')
      )

      const job = createMockJob('job-redis-fail')

      // Worker processor 应 reject（让 BullMQ 重试），而非导致未捕获异常崩溃
      await expect(capturedProcessor!(job)).rejects.toThrow('Connection is closed')
    })
  })
})
