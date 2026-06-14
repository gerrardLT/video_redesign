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

  return {
    mockPrisma,
    mockQueue,
    mockEstimateGroupCreditCost,
    mockRefundCredits,
    mockBuildGroupGenReference,
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

// 导入路由 handler（mock 必须先于导入）
import { POST } from '@/app/api/projects/[id]/generate/route'

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

/**
 * 安装一个真实模拟事务行为的 $transaction：
 * 调用传入的回调并提供 tx mock（findUniqueOrThrow 返回指定余额，job.create 递增 id）。
 */
function installTransaction(balance: number) {
  let jobSeq = 0
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', creditBalance: balance }),
          update: vi.fn().mockResolvedValue({}),
        },
        generationJob: {
          create: vi.fn().mockImplementation(async ({ data }: { data: { shotGroupId: string } }) => {
            jobSeq += 1
            return { id: `job-${jobSeq}`, shotGroupId: data.shotGroupId, status: 'QUEUED' }
          }),
        },
        creditLedger: {
          create: vi.fn().mockResolvedValue({}),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
        shotGroup: {
          update: vi.fn().mockResolvedValue({}),
        },
        shot: {
          updateMany: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(tx)
    }
  )
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
    // 余额充足：2 组 × ceil(12×1.5)=18 → totalCost=36
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', creditBalance: 100 })
    installTransaction(100)

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.mode).toBe('chain')
    expect(body.totalJobs).toBe(2)
    expect(body.costEstimate).toBe(36)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs[0]).toHaveProperty('id')
    expect(body.jobs[0]).toHaveProperty('groupIndex', 0)
    expect(body.jobs[0].status).toBe('QUEUED')
    expect(body.jobs[1]).toHaveProperty('groupIndex', 1)
    expect(body.jobs[1].status).toBe('WAITING')

    // 仅入队第一组（链式：后续组由 Worker 触发）
    expect(mockQueue.add).toHaveBeenCalledTimes(1)
    expect(mockQueue.add).toHaveBeenCalledWith(
      'video-generate',
      expect.objectContaining({
        projectId: 'proj-1',
        userId: 'user-1',
        shotGroupId: 'group-1',
        chainMode: true,
        chainTotalGroups: 2,
        chainCurrentIndex: 0,
      })
    )
  })

  it('积分余额不足 → 返回 400 + required/available', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(makeProject())
    // 余额不足：totalCost=36，余额仅 10
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', creditBalance: 10 })

    const res = await POST(createRequest(), createParams())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('积分余额不足')
    expect(body.required).toBe(36)
    expect(body.available).toBe(10)

    // 余额不足时不应进入事务、不应入队
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
