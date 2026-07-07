/**
 * 看门狗 Worker 单元测试
 * 覆盖 parse-watchdog 和 generate-watchdog 的 BullMQ job 处理逻辑：
 *
 * parse-watchdog:
 * - 超时 PARSING 项目 → 标记 FAILED + 写 errorMsg
 * - 未超时项目不处理
 * - 无卡死项目时正常返回
 *
 * generate-watchdog:
 * - 超时 GENERATING 组 → failProjectChain 退款解卡
 * - 未超时项目不处理（有近期更新的 Job）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mock 依赖
// ============================================================

// Mock prisma
const mockPrisma = {
  project: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  generationJob: {
    findMany: vi.fn(),
  },
  shotGroup: {
    update: vi.fn(),
    count: vi.fn(),
  },
  shot: {
    updateMany: vi.fn(),
  },
}

vi.mock('@/lib/shared/db', () => ({
  prisma: mockPrisma,
}))

// Mock logger
vi.mock('@/lib/shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock redis（Worker 构造需要）
vi.mock('@/lib/shared/redis', () => ({
  redis: {
    options: { maxRetriesPerRequest: null },
    status: 'ready',
  },
}))

// Mock progress-publisher（generate-video 依赖）
vi.mock('@/lib/shared/progress-publisher', () => ({
  publishStateChange: vi.fn(),
  publishCompleted: vi.fn(),
  publishFailed: vi.fn(),
  publishChainProgress: vi.fn(),
}))

// Mock credit-service（generate-video 中 failProjectChain 依赖）
vi.mock('@/lib/shared/credit-service', () => ({
  refundCredits: vi.fn().mockResolvedValue(undefined),
  reserveCredits: vi.fn(),
  chargeCredits: vi.fn(),
}))

// Mock 其他 generate-video 依赖，避免导入副作用
vi.mock('@/lib/video/seedance', () => ({
  submitSeedanceTask: vi.fn(),
  pollSeedanceTask: vi.fn(),
}))

vi.mock('@/lib/video/frame-continuity', () => ({
  applySameSceneContinuation: vi.fn(),
}))

vi.mock('@/lib/video/version-history-service', () => ({
  createVersion: vi.fn(),
}))

vi.mock('@/lib/shared/storage', () => ({
  uploadBuffer: vi.fn(),
  deleteOssFile: vi.fn(),
}))

vi.mock('@/lib/shared/distributed-lock', () => ({
  withLock: vi.fn((key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/lib/shared/queue', () => ({
  generateVideoQueue: { add: vi.fn() },
  orderExpireQueue: { add: vi.fn() },
}))

vi.mock('@/lib/shared/notification-service', () => ({
  createPaymentSuccessNotification: vi.fn(),
}))

// ============================================================
// Mock BullMQ Worker 构造函数，按队列名称捕获 processor
// ============================================================
const capturedProcessors: Record<string, (job?: unknown) => Promise<unknown>> = {}

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(name: string, processor: (job?: unknown) => Promise<unknown>) {
      capturedProcessors[name] = processor
    }
    on() { return this }
  },
}))

// ============================================================
// 导入 Workers（触发 mock 之后）
// ============================================================
beforeEach(async () => {
  vi.clearAllMocks()
  // 动态导入以确保 processor 被捕获
  if (!capturedProcessors['parse-watchdog']) {
    await import('@/workers/parse-watchdog')
  }
  if (!capturedProcessors['generate-watchdog']) {
    await import('@/workers/generate-watchdog')
  }
})

// ============================================================
// 辅助函数
// ============================================================
function createMockJob(name: string, data: Record<string, unknown> = {}) {
  return { id: `job-${Date.now()}`, name, data }
}

// ============================================================
// parse-watchdog 测试
// ============================================================
describe('parse-watchdog', () => {
  it('超时 PARSING 项目 → 标记 FAILED + 写 errorMsg', async () => {
    const stuckProject = {
      id: 'proj-stuck-1',
      name: '卡死项目',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000), // 1小时前（超过30分钟阈值）
    }

    mockPrisma.project.findMany.mockResolvedValueOnce([stuckProject])
    mockPrisma.project.update.mockResolvedValueOnce({ id: stuckProject.id, status: 'FAILED' })

    const job = createMockJob('parse-watchdog')
    const result = await capturedProcessors['parse-watchdog']!(job)

    expect(result).toEqual({ scanned: 1, marked: 1 })
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-stuck-1' },
      data: {
        status: 'FAILED',
        errorMsg: expect.stringContaining('解析超时'),
      },
    })
  })

  it('未超时项目不处理: updatedAt 在阈值内的 PARSING 项目不被返回', async () => {
    // Prisma 查询条件 updatedAt < cutoff，未超时的不会出现在结果集中
    mockPrisma.project.findMany.mockResolvedValueOnce([])

    const job = createMockJob('parse-watchdog')
    const result = await capturedProcessors['parse-watchdog']!(job)

    expect(result).toEqual({ scanned: 0, marked: 0 })
    expect(mockPrisma.project.update).not.toHaveBeenCalled()
  })

  it('无卡死项目时正常返回', async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([])

    const job = createMockJob('parse-watchdog')
    const result = await capturedProcessors['parse-watchdog']!(job)

    expect(result).toEqual({ scanned: 0, marked: 0 })
  })

  it('多个超时项目批量处理', async () => {
    const projects = [
      { id: 'proj-1', name: '项目1', updatedAt: new Date(Date.now() - 45 * 60 * 1000) },
      { id: 'proj-2', name: '项目2', updatedAt: new Date(Date.now() - 50 * 60 * 1000) },
      { id: 'proj-3', name: '项目3', updatedAt: new Date(Date.now() - 35 * 60 * 1000) },
    ]

    mockPrisma.project.findMany.mockResolvedValueOnce(projects)
    mockPrisma.project.update.mockResolvedValue({ status: 'FAILED' })

    const job = createMockJob('parse-watchdog')
    const result = await capturedProcessors['parse-watchdog']!(job)

    expect(result).toEqual({ scanned: 3, marked: 3 })
    expect(mockPrisma.project.update).toHaveBeenCalledTimes(3)
  })

  it('单个项目更新失败不影响其他项目处理', async () => {
    const projects = [
      { id: 'proj-fail', name: '更新失败的项目', updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
      { id: 'proj-ok', name: '正常项目', updatedAt: new Date(Date.now() - 40 * 60 * 1000) },
    ]

    mockPrisma.project.findMany.mockResolvedValueOnce(projects)
    // 第一个 update 抛错，第二个正常
    mockPrisma.project.update
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({ id: 'proj-ok', status: 'FAILED' })

    const job = createMockJob('parse-watchdog')
    const result = await capturedProcessors['parse-watchdog']!(job)

    // 第一个失败不计入 marked，第二个成功
    expect(result).toEqual({ scanned: 2, marked: 1 })
  })
})

// ============================================================
// generate-watchdog 测试
// ============================================================
describe('generate-watchdog', () => {
  it('超时 GENERATING 项目 → failProjectChain 退款解卡', async () => {
    const stuckProject = {
      id: 'proj-gen-stuck',
      userId: 'user-1',
      name: '生成卡死项目',
    }

    // 项目查询返回一个 GENERATING 状态的项目
    mockPrisma.project.findMany.mockResolvedValueOnce([stuckProject])

    // 该项目有未完成 Job，且更新时间全部超时（40分钟前）
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([
      { updatedAt: new Date(Date.now() - 40 * 60 * 1000) },
      { updatedAt: new Date(Date.now() - 35 * 60 * 1000) },
    ])

    // failProjectChain 内部调用：查找未完成 Job
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([
      { id: 'job-1', costEstimate: 10, shotGroupId: 'sg-1' },
      { id: 'job-2', costEstimate: 15, shotGroupId: 'sg-2' },
    ])
    // failProjectChain: shotGroup.count 判断是否有分镜组
    mockPrisma.shotGroup.count.mockResolvedValueOnce(2)
    // failProjectChain: 更新组/分镜/项目状态
    mockPrisma.generationJob.findMany.mockResolvedValue([])
    mockPrisma.shotGroup.update.mockResolvedValue({})
    mockPrisma.shot.updateMany.mockResolvedValue({})
    mockPrisma.project.update.mockResolvedValue({})

    const result = await capturedProcessors['generate-watchdog']!()

    expect(result).toEqual({ scanned: 1, recovered: 1 })
  })

  it('未超时项目不处理: 有近期更新的 Job 则跳过', async () => {
    const activeProject = {
      id: 'proj-active',
      userId: 'user-2',
      name: '正在生成的项目',
    }

    mockPrisma.project.findMany.mockResolvedValueOnce([activeProject])

    // 有 Job 在 5 分钟前更新过（远未超过30分钟阈值）→ 跳过
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([
      { updatedAt: new Date(Date.now() - 5 * 60 * 1000) },
      { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    ])

    const result = await capturedProcessors['generate-watchdog']!()

    expect(result).toEqual({ scanned: 1, recovered: 0 })
    // 不应触发 failProjectChain 相关操作
    expect(mockPrisma.project.update).not.toHaveBeenCalled()
  })

  it('无 GENERATING 项目时直接返回', async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([])

    const result = await capturedProcessors['generate-watchdog']!()

    expect(result).toEqual({ scanned: 0, recovered: 0 })
  })

  it('状态漂移: 无未完成 Job 但项目仍 GENERATING → 触发解卡', async () => {
    const driftedProject = {
      id: 'proj-drifted',
      userId: 'user-3',
      name: '状态漂移项目',
    }

    mockPrisma.project.findMany.mockResolvedValueOnce([driftedProject])

    // 无未完成 Job（空数组）→ 状态漂移，应触发解卡
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([])

    // failProjectChain 内部：也无未完成 Job
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([])
    mockPrisma.shotGroup.count.mockResolvedValueOnce(1)
    mockPrisma.project.update.mockResolvedValue({})

    const result = await capturedProcessors['generate-watchdog']!()

    expect(result).toEqual({ scanned: 1, recovered: 1 })
  })

  it('activeJobs 查询异常不阻塞其他项目的处理', async () => {
    const projects = [
      { id: 'proj-err', userId: 'user-4', name: '查询异常项目' },
      { id: 'proj-ok', userId: 'user-5', name: '正常卡死项目' },
    ]

    mockPrisma.project.findMany.mockResolvedValueOnce(projects)

    // 第一个项目：activeJobs 查询直接抛错（外层 try-catch 捕获，跳过该项目）
    mockPrisma.generationJob.findMany.mockRejectedValueOnce(new Error('DB connection lost'))

    // 第二个项目：有超时 Job
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([
      { updatedAt: new Date(Date.now() - 45 * 60 * 1000) },
    ])
    // failProjectChain 对第二个项目正常执行
    mockPrisma.generationJob.findMany.mockResolvedValueOnce([
      { id: 'job-3', costEstimate: 5, shotGroupId: 'sg-3' },
    ])
    mockPrisma.shotGroup.count.mockResolvedValueOnce(1)
    mockPrisma.shotGroup.update.mockResolvedValue({})
    mockPrisma.shot.updateMany.mockResolvedValue({})
    mockPrisma.project.update.mockResolvedValue({})

    const result = await capturedProcessors['generate-watchdog']!()

    // 第一个因查询异常被跳过（recovered 不计），第二个成功
    expect(result).toEqual({ scanned: 2, recovered: 1 })
  })
})
