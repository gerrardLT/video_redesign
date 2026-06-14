/**
 * Bug 条件探索测试 — 单组路径同场景尾帧承接缺失
 * Spec: shot-group-frame-continuity（bugfix，requirements-first）
 *
 * **Property 1: Bug Condition** — 单组生成在 bug 条件下未承接前一组尾帧
 *
 * CRITICAL：本测试编码「修复后应有」的承接行为，在**未修复代码**上必须 FAIL ——
 * 失败即确认 bug 存在（单组路由不读取前一组尾帧、不注入承接参考图、prompt 无承接指令、
 * 也不请求 returnLastFrame 以持久化本组尾帧）。修复落地后本测试自然转为 PASS（见 tasks 3.5）。
 *
 * Scoped PBT Approach：固定到确定性可复现用例——「项目含组 1(P)、组 2(G) 同场景，
 * 组 1 已 SUCCEEDED 且持有受信尾帧 lastFrameUrl」，对组 2 调用单组生成路由
 * POST /api/shot-groups/[id]/generate，断言入队 Seedance 任务的承接装配。
 *
 * 断言（依据 design「Correctness Properties / Property 1」与「Fix Checking」伪代码）：
 *  - 入队 referenceImages 包含 P.lastFrameUrl
 *  - prompt 含「以图片N…作为本组起始画面」承接指令
 *  - 单组承接装配结果与链式 applySameSceneContinuation（同一前一组/当前组）一致
 *  - 全程软承接，未使用 role=first_frame；referenceImages.length <= 9
 *  - 补充：存在同场景后继组时入队 returnLastFrame=true（确认「尾帧未持久化根因」：
 *    单组路径根本不请求尾帧，故无尾帧可供后续承接）
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ========================
// 测试夹具常量
// ========================
const PREV_LAST_FRAME_URL = 'https://oss.example.com/last-frame/group-1.jpg'
const BASE_REF = 'asset://char-1' // buildGroupGenReference 装配的人物锚定参考图
const CHARACTER_PREFIX = '图片1中的小明，'
const TIMELINE_SCRIPT = '镜头1：镜头固定，人物站立在客厅'
const SCENE = '客厅'

// ========================
// vi.hoisted mock 对象（沿用项目既有单测模式）
// ========================
const {
  mockPrisma,
  mockQueue,
  mockEstimateGroupCreditCost,
  mockBuildGroupGenReference,
} = vi.hoisted(() => {
  const mockPrisma = {
    shotGroup: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    shot: {
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    styleConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    generationJob: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    creditLedger: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  }

  const mockQueue = { add: vi.fn().mockResolvedValue({}) }

  // 真实公式：ceil(duration × (resolution === '720p' ? 1.5 : 1.0))
  const mockEstimateGroupCreditCost = vi.fn((duration: number, resolution: string) => {
    const multiplier = resolution === '720p' ? 1.5 : 1.0
    return Math.ceil(duration * multiplier)
  })

  // 注：hoisted 工厂先于模块级 const 初始化执行，此处用字面量（与下方常量保持一致）；
  // 每个用例的 beforeEach 会用常量重置该 mock 返回值。
  const mockBuildGroupGenReference = vi.fn().mockResolvedValue({
    characterPrefix: '图片1中的小明，',
    referenceImages: ['asset://char-1'],
    referenceAudioUrl: undefined,
  })

  return { mockPrisma, mockQueue, mockEstimateGroupCreditCost, mockBuildGroupGenReference }
})

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/queue', () => ({ videoGenerateQueue: mockQueue }))
vi.mock('@/lib/credit-service', () => ({
  estimateGroupCreditCost: (duration: number, resolution: string) =>
    mockEstimateGroupCreditCost(duration, resolution),
}))
vi.mock('@/lib/rate-limiter', () => ({ isRateLimited: () => false }))
// 分布式锁在单测中直接放行：withCreditLock(fn) → fn()
vi.mock('@/lib/distributed-lock', () => ({
  withCreditLock: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/group-gen-context', () => ({
  buildGroupGenReference: (...args: unknown[]) => mockBuildGroupGenReference(...args),
}))

// 导入被测路由 handler（mock 必须先于导入）
import { POST } from '@/app/api/shot-groups/[id]/generate/route'

// ========================
// 辅助
// ========================
function createRequest(userId = 'user-1', groupId = 'group-2'): NextRequest {
  const req = new NextRequest(`http://localhost:3011/api/shot-groups/${groupId}/generate`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
  })
  req.headers.set('x-user-id', userId)
  return req
}

function createParams(id = 'group-2') {
  return { params: Promise.resolve({ id }) }
}

/**
 * 链式承接装配基准（design「Fix Implementation #2」applySameSceneContinuation 伪代码）。
 * 单组承接结果应与此一致：把前一组尾帧追加在末尾，contIndex = 已有参考图数 + 1，
 * prompt 末尾拼接承接指令（文案与链式 triggerNextChainGroup 一字一致）。
 */
function expectedSameSceneContinuation(
  baseRefs: string[],
  basePrompt: string,
  lastFrameUrl: string
) {
  const contIndex = baseRefs.length + 1
  return {
    referenceImages: [...baseRefs, lastFrameUrl],
    prompt: `${basePrompt}\n承接：以图片${contIndex}（上一镜头结尾画面）作为本组起始画面，自然衔接上一镜头的人物姿态、机位、构图与光线，保持镜头连续`,
    contIndex,
  }
}

/** 当前组 G（待承接组，groupIndex=1，与前一组同场景） */
function makeCurrentGroupG(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-2',
    groupIndex: 1,
    genDuration: 12,
    startTime: 12,
    endTime: 24,
    genStatus: 'PENDING',
    scriptEdited: true,
    timelineScript: TIMELINE_SCRIPT,
    scriptHash: null,
    audioKey: null,
    project: { id: 'proj-1', userId: 'user-1', aspectRatio: '16:9' },
    shots: [
      {
        id: 'shot-g0',
        orderIndex: 0,
        startTime: 12,
        endTime: 16,
        prompt: '镜头固定，人物站立在客厅',
        dialogue: null,
        hasFace: false,
        coverUrl: 'https://oss.example.com/frame_g0.jpg',
        scene: SCENE,
        shotAssets: [],
      },
    ],
    ...overrides,
  }
}

/** 前一组 P（groupIndex=0，已成功且持有受信尾帧，与 G 同场景） */
function makePrevGroupP(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    groupIndex: 0,
    genStatus: 'SUCCEEDED',
    lastFrameUrl: PREV_LAST_FRAME_URL,
    ...overrides,
  }
}

/**
 * 安装模拟事务：调用回调并提供 tx mock（findUniqueOrThrow 返回余额，job.create 返回固定 id）。
 */
function installTransaction(balance: number) {
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', creditBalance: balance }),
          update: vi.fn().mockResolvedValue({}),
        },
        generationJob: {
          create: vi.fn().mockResolvedValue({ id: 'job-1', status: 'QUEUED' }),
        },
        creditLedger: { create: vi.fn().mockResolvedValue({}) },
        shotGroup: { update: vi.fn().mockResolvedValue({}) },
        shot: { updateMany: vi.fn().mockResolvedValue({}) },
      }
      return fn(tx)
    }
  )
}

/**
 * 配置 prisma.shotGroup.findFirst 路由：
 * - where.id 命中 → 返回当前组 G（含 include）
 * - where.groupIndex.lt 命中 → 返回前一组 P（修复后单组路由会查询前一组）
 * - where.groupIndex.gt 命中 → 返回同场景后继组 N（修复后用于决定 returnLastFrame）
 */
function installGroupQueries(opts: {
  group: Record<string, unknown>
  prev?: Record<string, unknown> | null
  successor?: Record<string, unknown> | null
}) {
  mockPrisma.shotGroup.findFirst.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      const where = args?.where ?? {}
      if (where.id) return opts.group
      if (where.groupIndex && typeof where.groupIndex === 'object') {
        if ('lt' in where.groupIndex) return opts.prev ?? null
        if ('gt' in where.groupIndex) return opts.successor ?? null
      }
      return null
    }
  )
}

// ========================
// 测试
// ========================
describe('Property 1: Bug Condition — 单组路径同场景尾帧承接缺失（探索测试，未修复代码上应 FAIL）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildGroupGenReference.mockResolvedValue({
      characterPrefix: CHARACTER_PREFIX,
      referenceImages: [BASE_REF],
      referenceAudioUrl: undefined,
    })
    mockEstimateGroupCreditCost.mockImplementation((duration: number, resolution: string) => {
      const multiplier = resolution === '720p' ? 1.5 : 1.0
      return Math.ceil(duration * multiplier)
    })
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', creditBalance: 1000 })
    mockPrisma.generationJob.findFirst.mockResolvedValue(null)
    // 前一组末镜 / 当前组首镜 scene 均为同场景（共享承接函数据此判定同场景）
    mockPrisma.shot.findFirst.mockResolvedValue({ scene: SCENE })
    installTransaction(1000)
  })

  it('单组生成组 2 时，入队 Seedance 任务应承接组 1 尾帧（referenceImages 含 P.lastFrameUrl + prompt 含承接指令）', async () => {
    installGroupQueries({ group: makeCurrentGroupG(), prev: makePrevGroupP(), successor: null })

    const res = await POST(createRequest(), createParams())
    expect(res.status).toBe(202)

    expect(mockQueue.add).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueued = mockQueue.add.mock.calls[0][1] as any

    const expected = expectedSameSceneContinuation(
      [BASE_REF],
      `${CHARACTER_PREFIX}${TIMELINE_SCRIPT}`,
      PREV_LAST_FRAME_URL
    )

    // 断言 1：入队参考图包含前一组受信尾帧（未修复代码：referenceImages=[BASE_REF]，不含尾帧 → FAIL）
    expect(enqueued.referenceImages).toContain(PREV_LAST_FRAME_URL)

    // 断言 2：prompt 含承接指令（未修复代码：prompt 无「以图片N…作为本组起始画面」→ FAIL）
    expect(enqueued.prompt).toContain(`以图片${expected.contIndex}`)
    expect(enqueued.prompt).toContain('作为本组起始画面')

    // 断言 3：单组承接装配与链式 applySameSceneContinuation 基准一致
    expect(enqueued.referenceImages).toEqual(expected.referenceImages)
    expect(enqueued.prompt).toEqual(expected.prompt)
  })

  it('承接为软承接：未使用 role=first_frame，且 referenceImages.length <= 9', async () => {
    installGroupQueries({ group: makeCurrentGroupG(), prev: makePrevGroupP(), successor: null })

    const res = await POST(createRequest(), createParams())
    expect(res.status).toBe(202)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueued = mockQueue.add.mock.calls[0][1] as any

    // 软承接：入队载荷不得携带任何 first_frame 角色字段
    expect(enqueued).not.toHaveProperty('firstFrameUrl')
    expect(JSON.stringify(enqueued)).not.toContain('first_frame')

    // 承接后总参考图数 <= 9（不挤占人物锚定/场景帧）
    expect(Array.isArray(enqueued.referenceImages)).toBe(true)
    expect(enqueued.referenceImages.length).toBeLessThanOrEqual(9)
    // 且承接确实发生（含尾帧），否则上限断言无意义
    expect(enqueued.referenceImages).toContain(PREV_LAST_FRAME_URL)
  })

  it('尾帧未持久化根因：存在同场景后继组时，单组入队应请求 returnLastFrame=true（未修复代码不请求 → FAIL）', async () => {
    // 当前组为 groupIndex=0 的组 1，存在同场景后继组 N（组 2）→ 本组尾帧应被请求并持久化
    const groupOne = makeCurrentGroupG({
      id: 'group-1',
      groupIndex: 0,
      startTime: 0,
      endTime: 12,
    })
    const successorN = {
      id: 'group-2',
      groupIndex: 1,
      genStatus: 'PENDING',
      shots: [{ orderIndex: 0, scene: SCENE }],
    }
    installGroupQueries({ group: groupOne, prev: null, successor: successorN })

    const res = await POST(createRequest('user-1', 'group-1'), createParams('group-1'))
    expect(res.status).toBe(202)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueued = mockQueue.add.mock.calls[0][1] as any

    // 未修复代码：单组路由从不设置 returnLastFrame → undefined，本组尾帧永不被持久化 → FAIL
    expect(enqueued.returnLastFrame).toBe(true)
  })
})
