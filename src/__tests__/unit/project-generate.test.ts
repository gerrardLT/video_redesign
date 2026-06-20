/**
 * Unit Test: POST /api/projects/[id]/generate — 项目级链式生成路由
 *
 * 测试当前契约（链式分镜组生成，非旧的 segment 分段契约）：
 * 1. 项目不存在 → 404 {error:'项目不存在'}
 * 2. 项目状态非 EDITABLE/FAILED → 400 {error:`项目状态为 ${status}，无法生成`}
 * 3. 项目没有分镜组 → 400 {error:'项目没有分镜组，请先解析视频'}
 * 4. 存在缺少提示词的分镜 → 400 {error:'存在缺少提示词的分镜，无法生成', missingShotIds}
 * 5. 正常生成 → 202 {mode:'chain', totalJobs, costEstimate, jobs:[{id,groupIndex,status}]}
 *    且仅第一组入队（chainMode:true）
 * 6. 积分余额不足 → 400 {error:'积分余额不足', required, available}
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ========================
// 使用 vi.hoisted 定义 mock 对象（避免 hoisting 问题）
// ========================

const {
  mockPrisma,
  mockQueue,
  mockEstimateGroupCreditCost,
  mockRefundCredits,
  mockBuildGroupGenReference,
  mockGetUserPrivileges,
  mockCheckAndIncrement,
  mockBuildRejectionResponse,
  mockDecrement,
  mockOrchestrateGeneration,
} = vi.hoisted(() => {
  const mockPrisma = {
    project: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
    generationJob: {
      create: vi.fn(),
    },
    creditLedger: {
      create: vi.fn().mockResolvedValue({}),
    },
    shotGroup: {
      update: vi.fn().mockResolvedValue({}),
    },
    shot: {
      updateMany: vi.fn().mockResolvedValue({}),
    },
    subscriptionRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }

  const mockQueue = {
    add: vi.fn().mockResolvedValue({}),
  }

  // 真实公式：ceil(duration × (resolution === '720p' ? 1.5 : 1.0))
  const mockEstimateGroupCreditCost = vi.fn((duration: number, resolution: string) => {
    const multiplier = resolution === '720p' ? 1.5 : 1.0
    return Math.ceil(duration * multiplier)
  })

  const mockRefundCredits = vi.fn().mockResolvedValue(undefined)

  const mockBuildGroupGenReference = vi.fn().mockResolvedValue({
    characterPrefix: '',
    referenceImages: [],
    referenceAudioUrl: undefined,
  })

  // 并发控制相关 mock
  const mockGetUserPrivileges = vi.fn().mockResolvedValue({
    queuePriority: 5,
    allowedResolutions: ['480p', '720p'],
    watermarkEnabled: true,
    historyRetentionDays: 7,
    isActiveMember: false,
    tier: 'FREE' as const,
    concurrency: { parse: 1, generate: 1, merge: 1 },
  })

  const mockCheckAndIncrement = vi.fn().mockResolvedValue({
    allowed: true,
    currentCount: 1,
    limit: 1,
  })

  const mockBuildRejectionResponse = vi.fn()
  const mockDecrement = vi.fn().mockResolvedValue(undefined)

  const mockOrchestrateGeneration = vi.fn()

  return {
    mockPrisma,
    mockQueue,
    mockEstimateGroupCreditCost,
    mockRefundCredits,
    mockBuildGroupGenReference,
    mockGetUserPrivileges,
    mockCheckAndIncrement,
    mockBuildRejectionResponse,
    mockDecrement,
    mockOrchestrateGeneration,
  }
})

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/queue', () => ({ videoGenerateQueue: mockQueue }))
vi.mock('@/lib/credit-service', () => ({
  estimateGroupCreditCost: (duration: number, resolution: string) =>
    mockEstimateGroupCreditCost(duration, resolution),
  refundCredits: (...args: unknown[]) => mockRefundCredits(...args),
}))
vi.mock('@/lib/rate-limiter', () => ({
  isRateLimited: () => false,
}))
// 分布式锁在单测中直接放行：withCreditLock(fn) → fn()
vi.mock('@/lib/distributed-lock', () => ({
  withCreditLock: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/group-gen-context', () => ({
  buildGroupGenReference: (...args: unknown[]) => mockBuildGroupGenReference(...args),
}))
vi.mock('@/lib/privilege-engine', () => ({
  getUserPrivileges: (...args: unknown[]) => mockGetUserPrivileges(...args),
}))
vi.mock('@/lib/concurrency-controller', () => ({
  checkAndIncrement: (...args: unknown[]) => mockCheckAndIncrement(...args),
  buildRejectionResponse: (...args: unknown[]) => mockBuildRejectionResponse(...args),
  decrement: (...args: unknown[]) => mockDecrement(...args),
}))
vi.mock('@/lib/generation-orchestrator', () => ({
  orchestrateGeneration: (...args: unknown[]) => mockOrchestrateGeneration(...args),
}))

// 导入路由 handler（mock 必须先于导入）
import { POST } from '@/app/api/projects/[id]/generate/route'
import { ApiError } from '@/lib/api-error'

// ========================
// 辅助函数
// ========================

function createRequest(userId: string = 'user-1'): NextRequest {
  const req = new NextRequest('http://localhost:3011/api/projects/proj-1/generate', {
    method: 'POST',
  })
  req.headers.set('x-user-id', userId)
  return req
}

function createParams(id: string = 'proj-1') {
  return { params: Promise.resolve({ id }) }
}

/** 构造一个分镜（含 prompt） */
function makeShot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'shot-x',
    orderIndex: 0,
    startTime: 0,
    endTime: 4,
    prompt: '镜头固定，人物站立',
    dialogue: null,
    hasFace: false,
    coverUrl: 'https://oss/frame_0.jpg',
    ...overrides,
  }
}

/** 构造一个分镜组（含 shots） */
function makeGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'group-1',
    groupIndex: 0,
    genDuration: 12,
    startTime: 0,
    endTime: 12,
    genStatus: 'PENDING',
    audioKey: null,
    shots: [makeShot({ id: 'shot-1', orderIndex: 0 })],
    ...overrides,
  }
}

/** 构造完整 project.findFirst 返回（含 shotGroups[].shots[] 与 styleConfig） */
function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proj-1',
    userId: 'user-1',
    status: 'EDITABLE',
    aspectRatio: '16:9',
    styleConfig: {
      template: { promptPrefix: '国风3D动画风格，暗色调' },
      customDescription: null,
    },
    shotGroups: [
      makeGroup({
        id: 'group-1',
        groupIndex: 0,
        shots: [
          makeShot({ id: 'shot-1', orderIndex: 0, prompt: '镜头固定，人物站立' }),
          makeShot({ id: 'shot-2', orderIndex: 1, prompt: '镜头推进，人物走动', hasFace: true }),
        ],
      }),
      makeGroup({
        id: 'group-2',
        groupIndex: 1,
        startTime: 12,
        endTime: 24,
        shots: [
          makeShot({ id: 'shot-3', orderIndex: 0, startTime: 12, endTime: 16, prompt: '镜头摇移，场景切换' }),
        ],
      }),
    ],
    ...overrides,
  }
}

// ========================
// 测试
// ========================

describe('POST /api/projects/[id]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildGroupGenReference.mockResolvedValue({
      characterPrefix: '',
      referenceImages: [],
      referenceAudioUrl: undefined,
    })
    mockEstimateGroupCreditCost.mockImplementation((duration: number, resolution: string) => {
      const multiplier = resolution === '720p' ? 1.5 : 1.0
      return Math.ceil(duration * multiplier)
    })
    // 默认并发控制放行
    mockGetUserPrivileges.mockResolvedValue({
      queuePriority: 5,
      allowedResolutions: ['480p', '720p'],
      watermarkEnabled: true,
      historyRetentionDays: 7,
      isActiveMember: false,
      tier: 'FREE' as const,
      concurrency: { parse: 1, generate: 1, merge: 1 },
    })
    mockCheckAndIncrement.mockResolvedValue({
      allowed: true,
      currentCount: 1,
      limit: 1,
    })
  })

  it('项目不存在 → 返回 404', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null)

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('项目不存在')
  })

  it('项目状态非 EDITABLE/FAILED → 返回 400 + 状态错误消息', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      makeProject({ status: 'PARSING' })
    )

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('项目状态为 PARSING，无法生成')
  })

  it('项目没有分镜组 → 返回 400', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      makeProject({ shotGroups: [] })
    )

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('项目没有分镜组，请先解析视频')
  })

  it('存在缺少提示词的分镜 → 返回 400 + missingShotIds', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      makeProject({
        shotGroups: [
          makeGroup({
            id: 'group-1',
            groupIndex: 0,
            shots: [
              makeShot({ id: 'shot-ok', orderIndex: 0, prompt: '镜头固定，人物站立' }),
              makeShot({ id: 'shot-empty', orderIndex: 1, prompt: '   ' }),
              makeShot({ id: 'shot-null', orderIndex: 2, prompt: null }),
            ],
          }),
        ],
      })
    )

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('存在缺少提示词的分镜，无法生成')
    expect(body.missingShotIds).toEqual(['shot-empty', 'shot-null'])
  })

  it('正常生成 → 返回 202 + chain 模式，且仅第一组入队', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(makeProject())
    // orchestrateGeneration 返回 chain 模式结果
    mockOrchestrateGeneration.mockResolvedValue({
      mode: 'chain',
      enqueuedGroups: 1,
      totalGroups: 2,
      totalCost: 36,
      jobs: [
        { id: 'job-1', groupIndex: 0, status: 'QUEUED' },
        { id: 'job-2', groupIndex: 1, status: 'WAITING' },
      ],
    })

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.mode).toBe('chain')
    expect(body.totalGroups).toBe(2)
    expect(body.totalCost).toBe(36)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs[0]).toHaveProperty('id')
    expect(body.jobs[0]).toHaveProperty('groupIndex', 0)
    expect(body.jobs[0].status).toBe('QUEUED')
    expect(body.jobs[1]).toHaveProperty('groupIndex', 1)
    expect(body.jobs[1].status).toBe('WAITING')

    // 确认调用了 orchestrateGeneration
    expect(mockOrchestrateGeneration).toHaveBeenCalledTimes(1)
    expect(mockOrchestrateGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        tier: 'FREE',
      })
    )
  })

  it('积分余额不足 → 返回 402 + INSUFFICIENT_CREDITS', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(makeProject())
    // orchestrateGeneration 抛出 INSUFFICIENT_CREDITS 错误
    mockOrchestrateGeneration.mockRejectedValue(
      new ApiError('INSUFFICIENT_CREDITS', '积分不足：生成需 36 积分，当前余额 10', 402)
    )

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body.code).toBe('INSUFFICIENT_CREDITS')
  })
})
