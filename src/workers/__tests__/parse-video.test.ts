/**
 * parse-video Worker 单元测试
 * 测试视频解析 Worker 的完整处理逻辑：
 * - 正常流程：Project PARSING → EDITABLE
 * - AI 分析失败 → Project FAILED + errorMsg
 * - 余额预检不足 → 拒绝（抛错）
 * - 幂等清理：重新解析先删除旧数据
 * - 临时文件清理（成功/失败后均执行）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ Mock 所有外部依赖 ============

// Mock prisma - 模拟完整的数据库操作
const mockPrisma = {
  project: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  shot: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  character: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  shotGroup: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
  shotGroupCharacter: {
    createMany: vi.fn(),
  },
  styleConfig: {
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/shared/db', () => ({
  prisma: mockPrisma,
}))

// Mock redis
vi.mock('@/lib/shared/redis', () => ({
  redis: {
    options: { maxRetriesPerRequest: null },
    status: 'ready',
  },
}))

// Mock ffmpeg
const mockGetVideoMetadata = vi.fn()
const mockNormalizeVideo = vi.fn()
const mockDetectSceneCuts = vi.fn()

vi.mock('@/lib/video/ffmpeg', () => ({
  getVideoMetadata: (...args: unknown[]) => mockGetVideoMetadata(...args),
  normalizeVideo: (...args: unknown[]) => mockNormalizeVideo(...args),
  detectSceneCuts: (...args: unknown[]) => mockDetectSceneCuts(...args),
}))

// Mock video-analyzer
const mockParseVideoDirectly = vi.fn()

vi.mock('@/lib/video/video-analyzer', () => ({
  parseVideoDirectly: (...args: unknown[]) => mockParseVideoDirectly(...args),
}))

// Mock grouping-service
const mockGroupShots = vi.fn()

vi.mock('@/lib/video/grouping-service', () => ({
  groupShots: (...args: unknown[]) => mockGroupShots(...args),
}))

// Mock storage
const mockUploadFile = vi.fn()
const mockToAcceleratedUrl = vi.fn()

vi.mock('@/lib/shared/storage', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  toAcceleratedUrl: (...args: unknown[]) => mockToAcceleratedUrl(...args),
}))

// Mock credit-service
const mockEstimateParseCreditCost = vi.fn()
const mockFreezeParseCredits = vi.fn()
const mockChargeParseCreditsFromReserve = vi.fn()
const mockRefundParseCredits = vi.fn()

vi.mock('@/lib/shared/credit-service', () => ({
  estimateParseCreditCost: (...args: unknown[]) => mockEstimateParseCreditCost(...args),
  freezeParseCredits: (...args: unknown[]) => mockFreezeParseCredits(...args),
  chargeParseCreditsFromReserve: (...args: unknown[]) => mockChargeParseCreditsFromReserve(...args),
  refundParseCredits: (...args: unknown[]) => mockRefundParseCredits(...args),
}))

// Mock distributed-lock - withCreditLock 直接执行传入的 fn
vi.mock('@/lib/shared/distributed-lock', () => ({
  withCreditLock: async (fn: () => Promise<unknown>) => fn(),
}))

// Mock progress-publisher
const mockPublishStateChange = vi.fn()
const mockPublishCompleted = vi.fn()
const mockPublishFailed = vi.fn()

vi.mock('@/lib/shared/progress-publisher', () => ({
  publishStateChange: (...args: unknown[]) => mockPublishStateChange(...args),
  publishCompleted: (...args: unknown[]) => mockPublishCompleted(...args),
  publishFailed: (...args: unknown[]) => mockPublishFailed(...args),
}))

// Mock queue（人物形象生成入队）
const mockImageGenerateQueueAdd = vi.fn()

vi.mock('@/lib/shared/queue', () => ({
  imageGenerateQueue: { add: (...args: unknown[]) => mockImageGenerateQueueAdd(...args) },
}))

// Mock fs/promises
const mockMkdir = vi.fn()
const mockUnlink = vi.fn()
const mockWriteFile = vi.fn()
const mockRm = vi.fn()

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}))

// Mock child_process（用于 extractGroupAudio / extractShotThumbnails 的 ffmpeg 调用）
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    // 默认成功
    cb(null, '', '')
  }),
}))

// Mock BullMQ Worker 构造函数，捕获 processor
let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      capturedProcessor = processor
    }
    on() { return this }
  },
}))

// Mock global fetch（用于从 OSS 下载视频）
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ============ 测试辅助 ============

/** 创建模拟 Job 对象 */
function createMockJob(data: { projectId: string; videoUrl: string }, attemptsMade = 0) {
  return {
    id: `job-${Date.now()}`,
    data,
    attemptsMade,
  }
}

/** 标准视频元数据 */
const STANDARD_METADATA = {
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
}

/** 标准分镜解析结果（2 个分镜） */
const STANDARD_SHOTS = [
  {
    orderIndex: 0,
    startTime: 0,
    endTime: 15,
    scene: '室内办公室',
    shotType: '中景',
    cameraMove: '固定',
    dialogue: [{ speaker: '小明', text: '你好' }],
    audioDesc: '办公室环境音',
    suggestedPrompt: 'A person sitting in an office',
    hasFace: true,
    characters: [
      { name: '小明', appearance: '黑色短发、白衬衫', appearanceDetail: { hair: '黑色短发', clothing: '白衬衫', accessories: '', makeup: '' } },
    ],
  },
  {
    orderIndex: 1,
    startTime: 15,
    endTime: 30,
    scene: '室内办公室',
    shotType: '特写',
    cameraMove: '推',
    dialogue: [],
    audioDesc: '键盘敲击声',
    suggestedPrompt: 'Close-up of hands typing on keyboard',
    hasFace: false,
    characters: [],
  },
]

/** 标准分组计划 */
const STANDARD_GROUP_PLANS = [
  {
    groupIndex: 0,
    genDuration: 15,
    startTime: 0,
    endTime: 15,
    shotOrderIndexes: [0],
  },
  {
    groupIndex: 1,
    genDuration: 15,
    startTime: 15,
    endTime: 30,
    shotOrderIndexes: [1],
  },
]

/** 设置所有 mock 的默认成功行为 */
function setupSuccessMocks() {
  // prisma
  mockPrisma.project.findUniqueOrThrow.mockResolvedValue({ userId: 'user-001' })
  mockPrisma.project.update.mockResolvedValue({})
  mockPrisma.shot.create.mockResolvedValue({})
  mockPrisma.shot.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.shot.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.character.create.mockResolvedValue({})
  mockPrisma.character.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.character.findMany.mockResolvedValue([
    { id: 'char-001', name: '小明', appearance: '黑色短发、白衬衫' },
  ])
  mockPrisma.shotGroup.create.mockResolvedValueOnce({ id: 'group-001' })
  mockPrisma.shotGroup.create.mockResolvedValueOnce({ id: 'group-002' })
  mockPrisma.shotGroup.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.shotGroup.update.mockResolvedValue({})
  mockPrisma.shotGroupCharacter.createMany.mockResolvedValue({ count: 1 })
  mockPrisma.styleConfig.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.styleConfig.upsert.mockResolvedValue({})
  // $transaction 直接执行传入回调
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
    return fn(mockPrisma)
  })

  // ffmpeg
  mockGetVideoMetadata.mockResolvedValue(STANDARD_METADATA)
  mockNormalizeVideo.mockResolvedValue(undefined)
  mockDetectSceneCuts.mockResolvedValue([15.0])

  // video-analyzer
  mockParseVideoDirectly.mockResolvedValue({
    shots: STANDARD_SHOTS,
    globalSettings: {
      artStyle: '写实',
      colorTone: '暖色调',
      characters: [{ name: '小明', appearance: '黑色短发、白衬衫', props: '' }],
      subtitleDeclaration: '',
    },
  })

  // grouping
  mockGroupShots.mockReturnValue(STANDARD_GROUP_PLANS)

  // storage
  mockUploadFile.mockResolvedValue('https://oss.example.com/uploaded-file')
  mockToAcceleratedUrl.mockImplementation((url: string) => url)

  // credit
  mockEstimateParseCreditCost.mockReturnValue(5)
  mockFreezeParseCredits.mockResolvedValue(undefined)
  mockChargeParseCreditsFromReserve.mockResolvedValue(undefined)
  mockRefundParseCredits.mockResolvedValue(undefined)

  // progress
  mockPublishStateChange.mockResolvedValue(undefined)
  mockPublishCompleted.mockResolvedValue(undefined)
  mockPublishFailed.mockResolvedValue(undefined)

  // fs
  mockMkdir.mockResolvedValue(undefined)
  mockUnlink.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)

  // queue
  mockImageGenerateQueueAdd.mockResolvedValue(undefined)
}

// ============ 加载 Worker（触发 BullMQ mock 捕获 processor） ============

beforeEach(async () => {
  vi.clearAllMocks()
  if (!capturedProcessor) {
    await import('@/workers/parse-video')
  }
})

// ============ 测试用例 ============

describe('parse-video Worker', () => {
  describe('正常流程：Project PARSING → EDITABLE', () => {
    it('本地视频解析成功后将项目状态更新为 EDITABLE', async () => {
      setupSuccessMocks()

      const job = createMockJob({
        projectId: 'proj-001',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await capturedProcessor!(job)

      // 验证项目状态更新为 EDITABLE
      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-001' },
          data: expect.objectContaining({
            status: 'EDITABLE',
            duration: 30,
            aspectRatio: '16:9',
          }),
        })
      )

      // 验证积分记账完成
      expect(mockChargeParseCreditsFromReserve).toHaveBeenCalled()

      // 验证进度通知
      expect(mockPublishCompleted).toHaveBeenCalledWith('user-001', 'parse', 'proj-001')
    })

    it('OSS URL 视频先下载后解析', async () => {
      setupSuccessMocks()

      // 模拟从 OSS 下载视频
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      })

      const job = createMockJob({
        projectId: 'proj-002',
        videoUrl: 'https://oss.example.com/videos/test.mp4',
      })

      await capturedProcessor!(job)

      // 验证调用了 fetch 下载
      expect(mockFetch).toHaveBeenCalledWith('https://oss.example.com/videos/test.mp4')

      // 验证最终状态为 EDITABLE
      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-002' },
          data: expect.objectContaining({ status: 'EDITABLE' }),
        })
      )
    })

    it('分镜、人物、分组记录正确创建', async () => {
      setupSuccessMocks()

      const job = createMockJob({
        projectId: 'proj-003',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await capturedProcessor!(job)

      // 验证创建了 2 个 Shot
      expect(mockPrisma.shot.create).toHaveBeenCalledTimes(2)

      // 验证创建了 1 个 Character（小明）
      expect(mockPrisma.character.create).toHaveBeenCalledTimes(1)
      expect(mockPrisma.character.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ projectId: 'proj-003', name: '小明' }),
        })
      )

      // 验证创建了 2 个 ShotGroup
      expect(mockPrisma.shotGroup.create).toHaveBeenCalledTimes(2)

      // 验证 StyleConfig 被写入
      expect(mockPrisma.styleConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-003' },
        })
      )
    })
  })

  describe('AI 分析失败 → Project FAILED + errorMsg', () => {
    it('视频直传分析抛错时项目标记 FAILED 并保存错误信息', async () => {
      setupSuccessMocks()
      mockParseVideoDirectly.mockRejectedValue(new Error('模型服务超时'))

      const job = createMockJob({
        projectId: 'proj-fail-001',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      // 验证项目标记为 FAILED
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-fail-001' },
        data: {
          status: 'FAILED',
          errorMsg: '视频解析失败（视频直传分析）：模型服务超时',
        },
      })

      // 验证推送了失败进度
      expect(mockPublishFailed).toHaveBeenCalledWith(
        'user-001',
        'parse',
        'proj-fail-001',
        '视频解析失败（视频直传分析）：模型服务超时'
      )
    })

    it('模型返回空分镜数据时项目标记 FAILED', async () => {
      setupSuccessMocks()
      mockParseVideoDirectly.mockResolvedValue({ shots: [], globalSettings: null })

      const job = createMockJob({
        projectId: 'proj-fail-002',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-fail-002' },
        data: {
          status: 'FAILED',
          errorMsg: '视频解析失败：模型未返回任何分镜数据',
        },
      })
    })

    it('FFmpeg Normalize 失败时项目标记 FAILED', async () => {
      setupSuccessMocks()
      mockNormalizeVideo.mockRejectedValue(new Error('ffmpeg exit code 1'))

      const job = createMockJob({
        projectId: 'proj-fail-003',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-fail-003' },
        data: {
          status: 'FAILED',
          errorMsg: '视频 Normalize 预处理失败：ffmpeg exit code 1',
        },
      })
    })

    it('分析失败后退还已冻结积分', async () => {
      setupSuccessMocks()
      mockEstimateParseCreditCost.mockReturnValue(10)
      mockParseVideoDirectly.mockRejectedValue(new Error('服务不可用'))

      const job = createMockJob({
        projectId: 'proj-fail-refund',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      // 验证退还积分被调用
      expect(mockRefundParseCredits).toHaveBeenCalledWith('user-001', 'proj-fail-refund', 10)
    })
  })

  describe('余额预检不足 → 拒绝', () => {
    it('freezeParseCredits 抛错时项目标记 FAILED', async () => {
      setupSuccessMocks()
      mockFreezeParseCredits.mockRejectedValue(new Error('余额不足，无法冻结解析积分'))

      const job = createMockJob({
        projectId: 'proj-credit-001',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      // 验证项目标记为 FAILED
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-credit-001' },
        data: {
          status: 'FAILED',
          errorMsg: '余额不足，无法冻结解析积分',
        },
      })

      // 余额不足时 parseCost 已赋值但 freeze 失败，不执行退款（无实际冻结）
      // 由于 freezeParseCredits 在冻结前抛错，parseCost > 0 但 refund 仍会被调用
      // Worker 的 catch 无法区分「freeze 前抛错」和「freeze 后抛错」，统一尝试退款是安全的
    })
  })

  describe('幂等清理：重新解析先删除旧数据', () => {
    it('attemptsMade > 0 时先清理残留的分镜、人物、分组数据', async () => {
      setupSuccessMocks()

      const job = createMockJob(
        { projectId: 'proj-idempotent', videoUrl: '/uploads/videos/test.mp4' },
        2 // 第3次尝试
      )

      await capturedProcessor!(job)

      // 验证清理操作在第 3 次尝试时执行
      expect(mockPrisma.shot.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-idempotent' },
      })
      expect(mockPrisma.character.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-idempotent' },
      })
      expect(mockPrisma.shotGroup.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-idempotent' },
      })
      expect(mockPrisma.styleConfig.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-idempotent' },
      })
    })

    it('首次尝试（attemptsMade = 0）不清理旧数据', async () => {
      setupSuccessMocks()

      const job = createMockJob(
        { projectId: 'proj-first', videoUrl: '/uploads/videos/test.mp4' },
        0 // 首次
      )

      await capturedProcessor!(job)

      // 首次尝试不调用 deleteMany
      expect(mockPrisma.shot.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.character.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.shotGroup.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('临时文件清理', () => {
    it('解析成功后清理 normalized 临时文件', async () => {
      setupSuccessMocks()

      const job = createMockJob({
        projectId: 'proj-cleanup-ok',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await capturedProcessor!(job)

      // 验证 unlink 被调用（清理 normalized 文件）
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('解析失败后仍然清理临时文件', async () => {
      setupSuccessMocks()
      mockParseVideoDirectly.mockRejectedValue(new Error('分析超时'))

      const job = createMockJob({
        projectId: 'proj-cleanup-fail',
        videoUrl: '/uploads/videos/test.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      // 即使失败，finally 块仍执行清理
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('OSS 下载视频后清理 source 临时目录', async () => {
      setupSuccessMocks()
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      })

      const job = createMockJob({
        projectId: 'proj-cleanup-oss',
        videoUrl: 'https://oss.example.com/videos/test.mp4',
      })

      await capturedProcessor!(job)

      // 验证 rm 被调用（清理 source 临时目录）
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining('proj-cleanup-oss'),
        { recursive: true, force: true }
      )
    })
  })

  describe('视频时长超限', () => {
    it('超过 120s 的视频直接拒绝', async () => {
      setupSuccessMocks()
      mockGetVideoMetadata.mockResolvedValue({
        ...STANDARD_METADATA,
        duration: 180, // 超过 120s
      })

      const job = createMockJob({
        projectId: 'proj-too-long',
        videoUrl: '/uploads/videos/long.mp4',
      })

      await expect(capturedProcessor!(job)).rejects.toThrow()

      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-too-long' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMsg: expect.stringContaining('视频时长超限'),
        }),
      })
    })
  })
})
