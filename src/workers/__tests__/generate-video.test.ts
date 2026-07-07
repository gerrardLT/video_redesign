/**
 * Generate Video Worker 单元测试
 *
 * 测试分镜组生成流程核心分支：
 * - Seedance 成功 → ShotGroup/Shot SUCCEEDED + OSS 回存
 * - 链式串行触发下一组
 * - Seedance 失败 → 退款 + FAILED 状态
 * - 尾帧持久化 lastFrameUrl
 * - 幂等性（已完成跳过）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===================== vi.hoisted() 提升 mock 变量 =====================

const {
  capturedProcessorHolder,
  mockShotGroupUpdate,
  mockShotGroupFindUnique,
  mockShotGroupFindFirst,
  mockShotGroupFindMany,
  mockShotGroupCount,
  mockShotUpdateMany,
  mockShotFindMany,
  mockGenerationJobFindUnique,
  mockGenerationJobFindUniqueOrThrow,
  mockGenerationJobFindFirst,
  mockGenerationJobFindMany,
  mockGenerationJobUpdate,
  mockProjectUpdate,
  mockAssetCreate,
  mockCreditLedgerFindFirst,
  mockCreditLedgerCreate,
  mockPrismaTransaction,
  mockCreateSeedanceTask,
  mockGetSeedanceTaskStatus,
  mockRefundCredits,
  mockChargeCreditsTx,
  mockAcquireLock,
  mockReleaseLock,
  mockWithCreditLock,
  mockUploadFile,
  mockQueueAdd,
  mockFetch,
  mockWriteFile,
  mockUnlink,
  mockMkdir,
  VALID_MP4_HEADER,
} = vi.hoisted(() => {
  const header = Buffer.alloc(64)
  header.write('ftyp', 4, 'ascii')

  return {
    capturedProcessorHolder: { fn: null as ((job: unknown) => Promise<unknown>) | null },
    mockShotGroupUpdate: vi.fn(),
    mockShotGroupFindUnique: vi.fn(),
    mockShotGroupFindFirst: vi.fn(),
    mockShotGroupFindMany: vi.fn(),
    mockShotGroupCount: vi.fn(),
    mockShotUpdateMany: vi.fn(),
    mockShotFindMany: vi.fn(),
    mockGenerationJobFindUnique: vi.fn(),
    mockGenerationJobFindUniqueOrThrow: vi.fn(),
    mockGenerationJobFindFirst: vi.fn(),
    mockGenerationJobFindMany: vi.fn(),
    mockGenerationJobUpdate: vi.fn(),
    mockProjectUpdate: vi.fn(),
    mockAssetCreate: vi.fn(),
    mockCreditLedgerFindFirst: vi.fn(),
    mockCreditLedgerCreate: vi.fn(),
    mockPrismaTransaction: vi.fn(),
    mockCreateSeedanceTask: vi.fn(),
    mockGetSeedanceTaskStatus: vi.fn(),
    mockRefundCredits: vi.fn(),
    mockChargeCreditsTx: vi.fn(),
    mockAcquireLock: vi.fn(),
    mockReleaseLock: vi.fn(),
    mockWithCreditLock: vi.fn(),
    mockUploadFile: vi.fn(),
    mockQueueAdd: vi.fn(),
    mockFetch: vi.fn(),
    mockWriteFile: vi.fn(),
    mockUnlink: vi.fn(),
    mockMkdir: vi.fn(),
    VALID_MP4_HEADER: header,
  }
})

// ===================== Mock 区 =====================

// Mock bullmq：捕获 processor 函数供测试调用
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      capturedProcessorHolder.fn = processor
    }
    on() { return this }
  },
  UnrecoverableError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnrecoverableError' }
  },
}))

// Mock Redis
vi.mock('@/lib/shared/redis', () => ({
  redis: {
    incrby: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue('0'),
    del: vi.fn().mockResolvedValue(1),
  },
}))

// Mock Prisma DB
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
    shotGroup: {
      update: (...args: unknown[]) => mockShotGroupUpdate(...args),
      findUnique: (...args: unknown[]) => mockShotGroupFindUnique(...args),
      findFirst: (...args: unknown[]) => mockShotGroupFindFirst(...args),
      findMany: (...args: unknown[]) => mockShotGroupFindMany(...args),
      count: (...args: unknown[]) => mockShotGroupCount(...args),
    },
    shot: {
      updateMany: (...args: unknown[]) => mockShotUpdateMany(...args),
      findMany: (...args: unknown[]) => mockShotFindMany(...args),
    },
    generationJob: {
      findUnique: (...args: unknown[]) => mockGenerationJobFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockGenerationJobFindUniqueOrThrow(...args),
      findFirst: (...args: unknown[]) => mockGenerationJobFindFirst(...args),
      findMany: (...args: unknown[]) => mockGenerationJobFindMany(...args),
      update: (...args: unknown[]) => mockGenerationJobUpdate(...args),
    },
    project: {
      update: (...args: unknown[]) => mockProjectUpdate(...args),
    },
    asset: {
      create: (...args: unknown[]) => mockAssetCreate(...args),
    },
    creditLedger: {
      findFirst: (...args: unknown[]) => mockCreditLedgerFindFirst(...args),
      create: (...args: unknown[]) => mockCreditLedgerCreate(...args),
    },
  },
}))

// Mock Seedance
vi.mock('@/lib/video/seedance', () => ({
  createSeedanceTask: (...args: unknown[]) => mockCreateSeedanceTask(...args),
  getSeedanceTaskStatus: (...args: unknown[]) => mockGetSeedanceTaskStatus(...args),
}))

// Mock credit service
vi.mock('@/lib/shared/credit-service', () => ({
  refundCredits: (...args: unknown[]) => mockRefundCredits(...args),
  chargeCreditsTx: (...args: unknown[]) => mockChargeCreditsTx(...args),
}))

// Mock distributed lock
vi.mock('@/lib/shared/distributed-lock', () => ({
  acquireLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
  generateLockKey: (id: string) => `lock:shotgroup:${id}`,
  withCreditLock: (...args: unknown[]) => mockWithCreditLock(...args),
}))

// Mock storage
vi.mock('@/lib/shared/storage', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  getPublicUrl: (key: string) => `https://oss.example.com/${key}`,
}))

// Mock queue
vi.mock('@/lib/shared/queue', () => ({
  videoGenerateQueue: { add: (...args: unknown[]) => mockQueueAdd(...args) },
}))

// Mock progress publisher
vi.mock('@/lib/shared/progress-publisher', () => ({
  publishStateChange: vi.fn().mockResolvedValue(undefined),
  publishCompleted: vi.fn().mockResolvedValue(undefined),
  publishFailed: vi.fn().mockResolvedValue(undefined),
  publishChainProgress: vi.fn().mockResolvedValue(undefined),
}))

// Mock group-gen-context
vi.mock('@/lib/video/group-gen-context', () => ({
  buildGroupGenReference: vi.fn().mockResolvedValue({
    referenceImages: ['https://oss.example.com/asset/avatar.png'],
    referenceAudioUrl: undefined,
    characterPrefix: '[人物：小红] ',
    merchantPrefix: '',
  }),
}))

// Mock frame-continuity
vi.mock('@/lib/video/frame-continuity', () => ({
  applySameSceneContinuation: vi.fn().mockResolvedValue({ referenceImages: [], continuationSuffix: '' }),
  VIDEO_CONTINUATION_PROMPT_SUFFIX: '\n[承接上段视频画面]',
}))

// Mock version-history-service
vi.mock('@/lib/video/version-history-service', () => ({
  createVersion: vi.fn().mockResolvedValue({ id: 'version-1' }),
}))

// Mock asset-lifecycle-service
vi.mock('@/lib/shared/asset-lifecycle-service', () => ({
  setExpiry: vi.fn().mockResolvedValue(undefined),
}))

// Mock segment-concat
vi.mock('@/lib/video/segment-concat', () => ({
  checkAndConcatProjectSegments: vi.fn().mockResolvedValue(undefined),
}))

// Mock happyhorse-workspace
vi.mock('@/lib/shared/happyhorse-workspace', () => ({
  createHappyHorseWorkspaceTask: vi.fn(),
  getHappyHorseTaskStatus: vi.fn(),
}))

// Mock logger
vi.mock('@/lib/shared/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

// Mock child_process（ffmpeg 抽帧）
vi.mock('child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb?: (err: null, stdout: string, stderr: string) => void) => {
    if (cb) cb(null, '', '')
  },
}))

// Mock global fetch（模拟视频下载）
vi.stubGlobal('fetch', mockFetch)

// ===================== 引入被测模块（必须在所有 mock 之后）=====================
import '../generate-video'

// ===================== 测试辅助 =====================

function createMockJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bull-job-1',
    data: {
      jobId: 'gen-job-1',
      projectId: 'project-1',
      userId: 'user-1',
      prompt: '一个女孩在公园里跑步',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      shotGroupId: 'group-1',
      chainMode: true,
      chainTotalGroups: 3,
      chainCurrentIndex: 0,
      ...overrides,
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
  }
}

function setupDefaultMocks() {
  // withCreditLock 执行传入的回调
  mockWithCreditLock.mockImplementation(async (fn: () => Promise<unknown>) => fn())

  // fetch 返回有效 MP4
  mockFetch.mockImplementation(() => Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(VALID_MP4_HEADER.buffer),
  }))

  // 锁默认可获取
  mockAcquireLock.mockImplementation(() => Promise.resolve(true))
  mockReleaseLock.mockImplementation(() => Promise.resolve(true))

  // ShotGroup 未完成
  mockShotGroupFindUnique.mockImplementation(() => Promise.resolve({ id: 'group-1', genStatus: 'PENDING' }))
  mockShotGroupFindFirst.mockImplementation(() => Promise.resolve(null))
  mockShotGroupFindMany.mockImplementation(() => Promise.resolve([]))
  mockShotGroupCount.mockImplementation(() => Promise.resolve(1))
  mockShotGroupUpdate.mockImplementation(() => Promise.resolve({}))

  // Shot mocks
  mockShotUpdateMany.mockImplementation(() => Promise.resolve({}))
  mockShotFindMany.mockImplementation(() => Promise.resolve([]))

  // GenerationJob 存在且无 seedanceTaskId（首次执行）
  mockGenerationJobFindUnique.mockImplementation(() => Promise.resolve({
    id: 'gen-job-1',
    status: 'QUEUED',
    costEstimate: 10,
    seedanceTaskId: null,
  }))
  mockGenerationJobFindUniqueOrThrow.mockImplementation(() => Promise.resolve({
    id: 'gen-job-1',
    costEstimate: 10,
  }))
  mockGenerationJobFindFirst.mockImplementation(() => Promise.resolve(null))
  mockGenerationJobFindMany.mockImplementation(() => Promise.resolve([{ costEstimate: 10 }]))
  mockGenerationJobUpdate.mockImplementation(() => Promise.resolve({}))

  // Project
  mockProjectUpdate.mockImplementation(() => Promise.resolve({}))

  // Asset
  mockAssetCreate.mockImplementation(() => Promise.resolve({ id: 'asset-1' }))

  // Credit
  mockCreditLedgerFindFirst.mockImplementation(() => Promise.resolve(null))
  mockCreditLedgerCreate.mockImplementation(() => Promise.resolve({}))
  mockRefundCredits.mockImplementation(() => Promise.resolve(undefined))
  mockChargeCreditsTx.mockImplementation(() => Promise.resolve(undefined))

  // Seedance 创建任务成功
  mockCreateSeedanceTask.mockImplementation(() => Promise.resolve({ taskId: 'seedance-task-1' }))

  // Seedance 轮询立即成功
  mockGetSeedanceTaskStatus.mockImplementation(() => Promise.resolve({
    status: 'succeeded',
    videoUrl: 'https://seedance.example.com/result.mp4',
    lastFrameUrl: 'https://seedance.example.com/lastframe.jpg',
    tokenUsage: { completionTokens: 5000, totalTokens: 6000 },
  }))

  // $transaction 执行传入的回调
  mockPrismaTransaction.mockImplementation(async (fnOrArr: unknown, _opts?: unknown) => {
    if (typeof fnOrArr === 'function') {
      return fnOrArr({
        shotGroup: { update: vi.fn().mockResolvedValue({}) },
        shot: { updateMany: vi.fn().mockResolvedValue({}) },
        generationJob: { update: vi.fn().mockResolvedValue({}) },
        creditLedger: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      })
    }
  })

  // OSS 上传
  mockUploadFile.mockImplementation(() => Promise.resolve('https://oss.example.com/generated/proj1/group1.mp4'))

  // Queue
  mockQueueAdd.mockImplementation(() => Promise.resolve({}))

  // FS operations
  mockWriteFile.mockImplementation(() => Promise.resolve(undefined))
  mockUnlink.mockImplementation(() => Promise.resolve(undefined))
  mockMkdir.mockImplementation(() => Promise.resolve(undefined))
}

// ===================== 测试用例 =====================

describe('Generate Video Worker - processGroupVideoGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('Seedance 生成成功 → ShotGroup 置为 SUCCEEDED + OSS 回存', async () => {
    const job = createMockJob()

    await capturedProcessorHolder.fn!(job)

    // 验证创建 Seedance 任务
    expect(mockCreateSeedanceTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '一个女孩在公园里跑步',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      })
    )

    // 验证下载视频（fetch 被调用）
    expect(mockFetch).toHaveBeenCalledWith(
      'https://seedance.example.com/result.mp4',
      expect.objectContaining({ headers: expect.any(Object) })
    )

    // 验证上传到 OSS
    expect(mockUploadFile).toHaveBeenCalled()

    // 验证 atomicSuccessUpdate 中的积分扣费（withCreditLock 被调用）
    expect(mockWithCreditLock).toHaveBeenCalled()

    // 验证 $transaction 被调用（状态更新事务）
    expect(mockPrismaTransaction).toHaveBeenCalled()
  })

  it('链式串行：当前组完成后触发下一组入队', async () => {
    // 模拟存在下一个待生成组
    mockShotGroupFindMany.mockResolvedValue([
      { id: 'group-2', groupIndex: 1, genStatus: 'QUEUED' },
    ])
    mockGenerationJobFindFirst.mockResolvedValue({
      id: 'gen-job-2',
      status: 'QUEUED',
      duration: 6,
      promptSnapshot: '女孩在湖边停下来',
    })
    mockShotFindMany.mockResolvedValue([
      { prompt: '湖边停步' },
    ])

    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    // 验证下一组入队
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'video-generate',
      expect.objectContaining({
        jobId: 'gen-job-2',
        shotGroupId: 'group-2',
        chainMode: true,
        referenceVideoUrl: expect.any(String),
      })
    )
  })

  it('Seedance 失败 → 退款 + ShotGroup FAILED', async () => {
    // Seedance 轮询返回失败
    mockGetSeedanceTaskStatus.mockResolvedValue({
      status: 'failed',
      error: { code: 'CONTENT_POLICY', message: '内容违规' },
    })

    const job = createMockJob()

    // processGroupVideoGenerate 会 throw（确定性错误，UnrecoverableError）
    await expect(capturedProcessorHolder.fn!(job)).rejects.toThrow('Seedance 生成失败')

    // 验证退款
    expect(mockRefundCredits).toHaveBeenCalledWith('user-1', 'gen-job-1', 10)

    // 验证 GenerationJob 标记 FAILED
    expect(mockGenerationJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gen-job-1' } }),
    )

    // 验证 ShotGroup 标记 FAILED
    expect(mockShotGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'group-1' } }),
    )
  })

  it('尾帧持久化：lastFrameUrl 通过 atomicSuccessUpdate 写入', async () => {
    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    // atomicSuccessUpdate 内部调用两次 $transaction:
    // 1. withCreditLock 内的积分事务
    // 2. 状态更新事务（包含 lastFrameUrl）
    // 验证 $transaction 至少被调用 2 次
    expect(mockPrismaTransaction.mock.calls.length).toBeGreaterThanOrEqual(2)

    // 第二次调用是状态更新事务，验证回调中 shotGroup.update 包含 lastFrameUrl
    const statusTxCall = mockPrismaTransaction.mock.calls[1]
    if (typeof statusTxCall[0] === 'function') {
      const mockTx = {
        shotGroup: { update: vi.fn().mockResolvedValue({}) },
        shot: { updateMany: vi.fn().mockResolvedValue({}) },
        generationJob: { update: vi.fn().mockResolvedValue({}) },
      }
      await statusTxCall[0](mockTx)
      expect(mockTx.shotGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastFrameUrl: 'https://seedance.example.com/lastframe.jpg',
          }),
        })
      )
    }
  })

  it('幂等性：ShotGroup 已 SUCCEEDED 时直接跳过', async () => {
    mockShotGroupFindUnique.mockResolvedValue({ id: 'group-1', genStatus: 'SUCCEEDED' })

    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    // 不应调用 Seedance
    expect(mockCreateSeedanceTask).not.toHaveBeenCalled()
    expect(mockGetSeedanceTaskStatus).not.toHaveBeenCalled()
    // 不应扣费
    expect(mockWithCreditLock).not.toHaveBeenCalled()
  })

  it('幂等性：ShotGroup 正在 GENERATING 时直接跳过', async () => {
    mockShotGroupFindUnique.mockResolvedValue({ id: 'group-1', genStatus: 'GENERATING' })

    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    expect(mockCreateSeedanceTask).not.toHaveBeenCalled()
  })

  it('分布式锁获取失败时跳过任务', async () => {
    mockAcquireLock.mockResolvedValue(false)

    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    expect(mockCreateSeedanceTask).not.toHaveBeenCalled()
    expect(mockShotGroupFindUnique).not.toHaveBeenCalled()
  })

  it('重试恢复：已有 seedanceTaskId 时不重复创建任务', async () => {
    // 首次 findUnique 返回带 seedanceTaskId 的 job（上次重试已创建）
    mockGenerationJobFindUnique.mockResolvedValue({
      id: 'gen-job-1',
      status: 'GENERATING',
      costEstimate: 10,
      seedanceTaskId: 'existing-seedance-task',
    })
    mockGenerationJobFindUniqueOrThrow.mockResolvedValue({
      id: 'gen-job-1',
      costEstimate: 10,
    })

    const job = createMockJob()
    await capturedProcessorHolder.fn!(job)

    // 不应创建新 Seedance 任务（复用已有）
    expect(mockCreateSeedanceTask).not.toHaveBeenCalled()
    // 验证轮询被调用
    expect(mockGetSeedanceTaskStatus).toHaveBeenCalled()
  })

  it('链式最终失败 → 退款所有下游 QUEUED 组', async () => {
    // Seedance 返回确定性失败（含 "Seedance 生成失败" 关键字触发 UnrecoverableError）
    mockGetSeedanceTaskStatus.mockResolvedValue({
      status: 'failed',
      error: { code: 'CONTENT_POLICY', message: '内容违规' },
    })

    // refundCredits 需对当前组退款后 + failProjectChain 内退下游组
    mockGenerationJobFindUnique.mockResolvedValue({
      id: 'gen-job-1',
      status: 'QUEUED',
      costEstimate: 10,
      seedanceTaskId: null,
    })

    // failProjectChain 查询下游 QUEUED 组
    mockGenerationJobFindMany.mockResolvedValue([
      { id: 'gen-job-2', costEstimate: 8, shotGroupId: 'group-2' },
      { id: 'gen-job-3', costEstimate: 12, shotGroupId: 'group-3' },
    ])

    const job = createMockJob({ chainMode: true, chainTotalGroups: 3, chainCurrentIndex: 0 })

    // 确定性错误会抛出 UnrecoverableError
    try {
      await capturedProcessorHolder.fn!(job)
      // 如果没有 throw，说明某处吞掉了错误——仍验证退款逻辑
    } catch {
      // 期望抛出
    }

    // 当前组退款
    expect(mockRefundCredits).toHaveBeenCalledWith('user-1', 'gen-job-1', 10)
    // 下游组应被退款
    expect(mockRefundCredits).toHaveBeenCalledWith('user-1', 'gen-job-2', 8)
    expect(mockRefundCredits).toHaveBeenCalledWith('user-1', 'gen-job-3', 12)
  })
})

describe('Generate Video Worker - 链式完成后项目状态', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDefaultMocks()
    // 无下一组（当前为最后一组）
    mockShotGroupFindMany.mockResolvedValue([])
  })

  it('最后一组完成后项目回到 EDITABLE 状态', async () => {
    const job = createMockJob({ chainCurrentIndex: 2, chainTotalGroups: 3 })
    await capturedProcessorHolder.fn!(job)

    // markChainCompleted 或其 catch 内都会调用 project.update
    // 成功路径：{ status: 'EDITABLE' }，失败路径：{ status: 'FAILED' }
    expect(mockProjectUpdate).toHaveBeenCalled()
    const callArgs = mockProjectUpdate.mock.calls[0][0]
    // 验证 where 条件包含正确的 projectId
    expect(callArgs.where.id).toBe('project-1')
    // 验证状态为 EDITABLE（成功路径）
    expect(callArgs.data.status).toBe('EDITABLE')
  })
})
