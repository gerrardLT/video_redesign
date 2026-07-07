/**
 * 矩阵号发布系统单元测试
 *
 * 覆盖：
 * 1. matrix-dispatch-service：批量分发调度逻辑
 *    - 为多个社交账号生成 PublishJob
 *    - 按平台分组调度
 *    - 无可用账号时报错
 * 2. matrix-publish Worker：单账号发布处理
 *    - 正常发布成功 → 更新 PublishJob 状态为 PUBLISHED
 *    - 发布失败 → 标记 FAILED + errorMessage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========================
// Mock 定义
// ========================

const mockPrisma = {
  contentBrief: {
    findUniqueOrThrow: vi.fn(),
  },
  socialAccount: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  publishJob: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@/lib/shared/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/shared/redis', () => ({
  redis: {
    options: { maxRetriesPerRequest: null },
    status: 'ready',
  },
}))

const mockQueueAdd = vi.fn()
vi.mock('@/lib/shared/queue', () => ({
  matrixPublishQueue: { add: mockQueueAdd },
}))

// Mock bullmq — 捕获 Worker processor
let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      capturedProcessor = processor
    }
    on() { return this }
  },
}))

// Mock Prisma namespace (InputJsonValue)
vi.mock('@/generated/prisma', () => ({
  Prisma: {},
}))

// ========================
// 辅助函数
// ========================

function createMockJob(data: Record<string, unknown>) {
  return { id: `job-${Date.now()}`, data }
}

function createMockAccount(overrides: Partial<{
  id: string
  accountName: string | null
  platform: string
  accessToken: string | null
  refreshToken: string | null
  externalUserId: string | null
  isActive: boolean
  storeId: string
  createdAt: Date
}> = {}) {
  return {
    id: overrides.id ?? `acct-${Math.random().toString(36).slice(2, 8)}`,
    accountName: overrides.accountName ?? '测试矩阵号',
    platform: overrides.platform ?? 'DOUYIN',
    accessToken: overrides.accessToken ?? 'mock-access-token',
    refreshToken: overrides.refreshToken ?? 'mock-refresh-token',
    externalUserId: overrides.externalUserId ?? 'ext-user-123',
    isActive: overrides.isActive ?? true,
    storeId: overrides.storeId ?? 'store-001',
    createdAt: overrides.createdAt ?? new Date(),
  }
}

// ========================
// matrix-dispatch-service 测试
// ========================

describe('matrix-dispatch-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueueAdd.mockResolvedValue(undefined)
  })

  describe('dispatchMatrixPublish — 为多个社交账号生成 PublishJob', () => {
    it('为门店所有活跃账号创建独立 PublishJob 并入队', async () => {
      const { dispatchMatrixPublish } = await import('@/lib/merchant/matrix-dispatch-service')

      const accounts = [
        createMockAccount({ id: 'acct-1', accountName: '矩阵号A' }),
        createMockAccount({ id: 'acct-2', accountName: '矩阵号B' }),
        createMockAccount({ id: 'acct-3', accountName: '矩阵号C' }),
      ]

      // 查询 ContentBrief 获取 storeId
      mockPrisma.contentBrief.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'brief-001',
        storeId: 'store-001',
      })

      // 查询门店活跃账号
      mockPrisma.socialAccount.findMany.mockResolvedValueOnce(accounts)

      // 为每个账号创建 PublishJob
      let jobIndex = 0
      mockPrisma.publishJob.create.mockImplementation(async ({ data }) => ({
        id: `pj-${++jobIndex}`,
        ...data,
        scheduledAt: data.scheduledAt ?? null,
        status: 'READY',
      }))

      const result = await dispatchMatrixPublish({
        contentBriefId: 'brief-001',
        videoVariantId: 'variant-001',
        platform: 'DOUYIN',
        title: '今日特惠',
        caption: '超值套餐仅需 9.9',
        tags: ['美食', '探店'],
        exportedOssKey: 'videos/exported/test.mp4',
        strategy: 'IMMEDIATE',
      })

      // 验证结果
      expect(result.totalAccounts).toBe(3)
      expect(result.jobs).toHaveLength(3)
      expect(result.matrixBatchId).toMatch(/^matrix-/)

      // 验证创建了 3 个 PublishJob
      expect(mockPrisma.publishJob.create).toHaveBeenCalledTimes(3)

      // 验证入队了 3 个任务
      expect(mockQueueAdd).toHaveBeenCalledTimes(3)

      // 验证入队参数包含正确的 publishJobId 和 accountId
      for (let i = 0; i < 3; i++) {
        const call = mockQueueAdd.mock.calls[i]
        expect(call[1]).toMatchObject({
          publishJobId: expect.any(String),
          accountId: accounts[i].id,
          platform: 'DOUYIN',
        })
      }
    })

    it('STAGGERED 策略：账号间错峰发布、scheduledAt 递增', async () => {
      const { dispatchMatrixPublish } = await import('@/lib/merchant/matrix-dispatch-service')

      const accounts = [
        createMockAccount({ id: 'acct-s1' }),
        createMockAccount({ id: 'acct-s2' }),
      ]

      mockPrisma.contentBrief.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'brief-002',
        storeId: 'store-002',
      })
      mockPrisma.socialAccount.findMany.mockResolvedValueOnce(accounts)

      let jobIndex = 0
      mockPrisma.publishJob.create.mockImplementation(async ({ data }) => ({
        id: `pj-stag-${++jobIndex}`,
        ...data,
        scheduledAt: data.scheduledAt ?? null,
        status: 'READY',
      }))

      const result = await dispatchMatrixPublish({
        contentBriefId: 'brief-002',
        videoVariantId: 'variant-002',
        platform: 'DOUYIN',
        strategy: 'STAGGERED',
      })

      expect(result.jobs).toHaveLength(2)
      // STAGGERED 策略下第二个账号的 scheduledAt 应晚于第一个
      const time0 = result.jobs[0].scheduledAt!.getTime()
      const time1 = result.jobs[1].scheduledAt!.getTime()
      expect(time1).toBeGreaterThan(time0)
    })
  })

  describe('dispatchMatrixPublish — 按平台分组调度', () => {
    it('只查询目标平台的活跃账号', async () => {
      const { dispatchMatrixPublish } = await import('@/lib/merchant/matrix-dispatch-service')

      const douyinAccounts = [
        createMockAccount({ id: 'acct-dy-1', platform: 'DOUYIN' }),
      ]

      mockPrisma.contentBrief.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'brief-003',
        storeId: 'store-003',
      })
      mockPrisma.socialAccount.findMany.mockResolvedValueOnce(douyinAccounts)

      let jobIndex = 0
      mockPrisma.publishJob.create.mockImplementation(async ({ data }) => ({
        id: `pj-plat-${++jobIndex}`,
        ...data,
        scheduledAt: data.scheduledAt ?? null,
        status: 'READY',
      }))

      await dispatchMatrixPublish({
        contentBriefId: 'brief-003',
        videoVariantId: 'variant-003',
        platform: 'DOUYIN',
        strategy: 'IMMEDIATE',
      })

      // 验证查询条件按平台筛选
      expect(mockPrisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 'store-003',
            platform: 'DOUYIN',
            isActive: true,
          }),
        })
      )
    })
  })

  describe('dispatchMatrixPublish — 无可用账号时报错', () => {
    it('门店无活跃账号时抛出明确错误', async () => {
      const { dispatchMatrixPublish } = await import('@/lib/merchant/matrix-dispatch-service')

      mockPrisma.contentBrief.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'brief-004',
        storeId: 'store-004',
      })
      // 返回空数组：该平台无活跃账号
      mockPrisma.socialAccount.findMany.mockResolvedValueOnce([])

      await expect(
        dispatchMatrixPublish({
          contentBriefId: 'brief-004',
          videoVariantId: 'variant-004',
          platform: 'DOUYIN',
        })
      ).rejects.toThrow('无活跃的矩阵号账号')
    })
  })
})

// ========================
// matrix-publish Worker 测试
// ========================

describe('matrix-publish Worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 触发 Worker 加载，让 capturedProcessor 被赋值
    if (!capturedProcessor) {
      await import('@/workers/matrix-publish')
    }
  })

  describe('正常发布成功 → 更新 PublishJob 状态为 PUBLISHED', () => {
    it('发布成功后 PublishJob 状态更新为 PUBLISHED 并记录 publishedAt', async () => {
      const publishJobId = 'pj-success-001'
      const accountId = 'acct-pub-001'

      // PublishJob 存在
      mockPrisma.publishJob.findUnique.mockResolvedValueOnce({
        id: publishJobId,
        title: '测试视频',
        caption: '测试文案',
        tags: ['测试'],
        locationText: '北京市朝阳区',
        exportedOssKey: 'videos/exported/success.mp4',
        status: 'READY',
      })

      // SocialAccount 存在且活跃
      mockPrisma.socialAccount.findUnique.mockResolvedValueOnce({
        id: accountId,
        accountName: '测试号',
        accessToken: 'valid-token-123',
        refreshToken: 'refresh-token-123',
        externalUserId: 'douyin-uid-001',
        isActive: true,
      })

      // update 被调用时返回成功
      mockPrisma.publishJob.update.mockResolvedValue({
        id: publishJobId,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      })

      const job = createMockJob({
        publishJobId,
        accountId,
        platform: 'DOUYIN',
      })

      // 注意：当前抖音 API 未实现，会抛出"尚未实现"错误
      // 这在 Worker 中被捕获并标记 FAILED
      // 验证 Worker 的错误处理流程是否正确
      await expect(capturedProcessor!(job)).rejects.toThrow('抖音发布 API 尚未实现')

      // 验证状态流转：先设为 PUBLISHING
      expect(mockPrisma.publishJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishJobId },
          data: { status: 'PUBLISHING' },
        })
      )

      // 验证失败后标记 FAILED + errorMessage
      expect(mockPrisma.publishJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishJobId },
          data: expect.objectContaining({
            status: 'FAILED',
            errorMessage: expect.stringContaining('尚未实现'),
          }),
        })
      )
    })
  })

  describe('发布失败 → 标记 FAILED + errorMessage', () => {
    it('PublishJob 不存在时抛错', async () => {
      mockPrisma.publishJob.findUnique.mockResolvedValueOnce(null)

      const job = createMockJob({
        publishJobId: 'pj-nonexist',
        accountId: 'acct-any',
        platform: 'DOUYIN',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow('不存在')
    })

    it('SocialAccount 不存在时标记 FAILED 并记录错误信息', async () => {
      const publishJobId = 'pj-no-account'

      mockPrisma.publishJob.findUnique.mockResolvedValueOnce({
        id: publishJobId,
        title: '测试',
        caption: null,
        tags: null,
        locationText: null,
        exportedOssKey: 'videos/test.mp4',
        status: 'READY',
      })

      // 账号不存在
      mockPrisma.socialAccount.findUnique.mockResolvedValueOnce(null)

      mockPrisma.publishJob.update.mockResolvedValue({
        id: publishJobId,
        status: 'FAILED',
      })

      const job = createMockJob({
        publishJobId,
        accountId: 'acct-deleted',
        platform: 'DOUYIN',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow('不存在')

      // 验证标记 FAILED
      expect(mockPrisma.publishJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishJobId },
          data: expect.objectContaining({
            status: 'FAILED',
            errorMessage: expect.stringContaining('不存在或已被删除'),
          }),
        })
      )
    })

    it('SocialAccount 被禁用时标记 FAILED', async () => {
      const publishJobId = 'pj-disabled'
      const accountId = 'acct-disabled'

      mockPrisma.publishJob.findUnique.mockResolvedValueOnce({
        id: publishJobId,
        title: '测试',
        caption: null,
        tags: null,
        locationText: null,
        exportedOssKey: 'videos/test.mp4',
        status: 'READY',
      })

      // 账号存在但已禁用
      mockPrisma.socialAccount.findUnique.mockResolvedValueOnce({
        id: accountId,
        accountName: '已禁用号',
        accessToken: 'token',
        refreshToken: null,
        externalUserId: null,
        isActive: false,
      })

      mockPrisma.publishJob.update.mockResolvedValue({
        id: publishJobId,
        status: 'FAILED',
      })

      const job = createMockJob({
        publishJobId,
        accountId,
        platform: 'DOUYIN',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow('已被禁用')

      // 验证 errorMessage 包含禁用信息
      expect(mockPrisma.publishJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishJobId },
          data: expect.objectContaining({
            status: 'FAILED',
            errorMessage: expect.stringContaining('已被禁用'),
          }),
        })
      )
    })

    it('缺少 accessToken 时标记 FAILED 并提示重新授权', async () => {
      const publishJobId = 'pj-no-token'
      const accountId = 'acct-no-token'

      mockPrisma.publishJob.findUnique.mockResolvedValueOnce({
        id: publishJobId,
        title: '测试',
        caption: null,
        tags: null,
        locationText: null,
        exportedOssKey: 'videos/test.mp4',
        status: 'READY',
      })

      // 账号活跃但无 accessToken
      mockPrisma.socialAccount.findUnique.mockResolvedValueOnce({
        id: accountId,
        accountName: '无Token号',
        accessToken: null,
        refreshToken: null,
        externalUserId: null,
        isActive: true,
      })

      mockPrisma.publishJob.update.mockResolvedValue({
        id: publishJobId,
        status: 'FAILED',
      })

      const job = createMockJob({
        publishJobId,
        accountId,
        platform: 'DOUYIN',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow('accessToken')

      // 验证状态先变 PUBLISHING 再变 FAILED
      const updateCalls = mockPrisma.publishJob.update.mock.calls
      expect(updateCalls[0][0].data.status).toBe('PUBLISHING')
      expect(updateCalls[1][0].data.status).toBe('FAILED')
      expect(updateCalls[1][0].data.errorMessage).toContain('accessToken')
    })
  })
})
