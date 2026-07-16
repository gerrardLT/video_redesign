/**
 * 保持（Preservation）属性测试 — 非承接输入行为保持不变
 * Spec: shot-group-frame-continuity（bugfix，requirements-first）
 *
 * **Property 2: Preservation** — 对所有 isBugCondition 返回 false 的输入，
 * 修复后的单组生成 SHALL 产出与修复前完全一致的结果（F'_single(input) = F_single(input)）。
 *
 * 方法论「观察优先」：本测试在**未修复代码**上运行并必须 PASS，锁定以下基线行为；
 * 修复落地后（tasks 3.6）重跑仍须 PASS（修复仅在 bug 条件下追加承接，不影响非 bug 输入）。
 *
 * 已观察并记录的未修复基线（见 src/app/api/shot-groups/[id]/generate/route.ts）：
 *  - 入队 referenceImages = buildGroupGenReference 输出，原样透传，不追加任何尾帧
 *  - 入队 prompt = `${characterPrefix}${finalScript}`，无「以图片N…作为本组起始画面」承接文案
 *  - scriptHash = computeScriptHash(seedancePrompt, durationNum, resolution)，与 prompt 内容绑定
 *  - 入队载荷不含 first_frame / firstFrameUrl（软承接，全程多模态参考）；不含 chainMode（不串入链式）
 *  - scriptHash 幂等短路（SUCCEEDED+!force / QUEUED / GENERATING）、force 抽卡绕过短路、
 *    RESERVE 冻结与余额校验行为固定
 *  - 单组路由对单一目标组入队恰好一次，绝不级联重生成其它组（Req 3.8 方案 A：维持现状）
 *
 * 覆盖的非 bug 分支（isBugCondition 返回 false）：
 *  - 首组（无前一组）/ 跨场景 / 前一组未成功 / 前一组无受信尾帧
 *  - 乱序时序：(a) 先生成后序组而前序组当时未成功 → 独立起镜；
 *             (b) force 重生成前序组 → 不级联重生成已生成的后序组
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { NextRequest } from 'next/server'
// 真实实现：不 mock，确保 scriptHash 与 durationNum 与生产逐位一致
import { computeScriptHash } from '@/lib/shared/script-hash'
import { MAX_GROUP_DURATION } from '@/lib/video/grouping-service'

// ========================
// 测试夹具常量
// ========================
const PREV_LAST_FRAME_URL = 'https://oss.example.com/last-frame/group-1.jpg'
const BASE_REF = 'asset://char-1' // buildGroupGenReference 装配的人物锚定参考图
const CHARACTER_PREFIX = '图片1中的小明，'
const TIMELINE_SCRIPT = '镜头1：镜头固定，人物站立在客厅'
const SCENE = '客厅'
// 承接文案特征串（出现即说明发生了承接，非 bug 输入下绝不应出现）
const CONTINUATION_MARK = '作为本组起始画面'

// ========================
// vi.hoisted mock 对象（沿用项目既有单测模式 / 与探索测试一致）
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

  const mockBuildGroupGenReference = vi.fn().mockResolvedValue({
    characterPrefix: '图片1中的小明，',
    referenceImages: ['asset://char-1'],
    referenceAudioUrl: undefined,
  })

  return { mockPrisma, mockQueue, mockEstimateGroupCreditCost, mockBuildGroupGenReference }
})

vi.mock('@/lib/shared/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/shared/queue', () => ({ videoGenerateQueue: mockQueue }))
vi.mock('@/lib/shared/credit-service', () => ({
  estimateGroupCreditCost: (duration: number, resolution: string) =>
    mockEstimateGroupCreditCost(duration, resolution),
}))
vi.mock('@/lib/shared/rate-limiter', () => ({ isRateLimited: async () => false }))
// 分布式锁在单测中直接放行：withCreditLock(fn) → fn()
vi.mock('@/lib/shared/distributed-lock', () => ({
  withCreditLock: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/video/group-gen-context', () => ({
  buildGroupGenReference: (...args: unknown[]) => mockBuildGroupGenReference(...args),
}))

// 导入被测路由 handler（mock 必须先于导入）
import { POST } from '@/app/api/shot-groups/[id]/generate/route'

// ========================
// 事务捕获器：记录冻结/扣费与 scriptHash 写入，供断言「积分与哈希行为不变」
// ========================
interface TxCaptured {
  scriptHash?: string | null
  promptSnapshot?: string
  costEstimate?: number
  newBalance?: number
  reserve?: { action?: string; amount?: number; balanceAfter?: number }
  timelineScript?: string
}

// ========================
// 辅助
// ========================
function createRequest(
  userId = 'user-1',
  groupId = 'group-2',
  body: Record<string, unknown> = {}
): NextRequest {
  const req = new NextRequest(`http://localhost:3011/api/shot-groups/${groupId}/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  req.headers.set('x-user-id', userId)
  return req
}

function createParams(id = 'group-2') {
  return { params: Promise.resolve({ id }) }
}

/** 当前组 G（待生成组，groupIndex=1，scriptEdited=true 固定复用 timelineScript） */
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
    genVideoUrl: null,
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

/** 前一组 P（groupIndex=0） */
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
 * 安装模拟事务并捕获关键写入。
 * 事务内：重读余额二次校验 → 扣减 → 创建 Job → RESERVE 流水 → 组/分镜置位（含 scriptHash）。
 */
function installTransaction(balance: number, captured: TxCaptured) {
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', creditBalance: balance }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: vi.fn().mockImplementation(async (args: any) => {
            captured.newBalance = args?.data?.creditBalance
            return {}
          }),
        },
        generationJob: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: vi.fn().mockImplementation(async (args: any) => {
            captured.promptSnapshot = args?.data?.promptSnapshot
            captured.costEstimate = args?.data?.costEstimate
            return { id: 'job-1', status: 'QUEUED' }
          }),
        },
        creditLedger: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: vi.fn().mockImplementation(async (args: any) => {
            captured.reserve = {
              action: args?.data?.action,
              amount: args?.data?.amount,
              balanceAfter: args?.data?.balanceAfter,
            }
            return {}
          }),
        },
        shotGroup: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: vi.fn().mockImplementation(async (args: any) => {
            if (args?.data?.scriptHash !== undefined) captured.scriptHash = args.data.scriptHash
            if (args?.data?.timelineScript !== undefined) captured.timelineScript = args.data.timelineScript
            return {}
          }),
        },
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

const BASE_PROMPT = `${CHARACTER_PREFIX}${TIMELINE_SCRIPT}`

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
  mockPrisma.shot.findFirst.mockResolvedValue({ scene: SCENE })
})

// ============================================================
// Property 2: Preservation — 非 bug 输入下单组装配与 scriptHash 与基线逐项一致
// ============================================================
describe('Property 2: Preservation — 非 bug 输入行为保持不变（未修复代码上应 PASS）', () => {
  /**
   * 非 bug 场景生成器：四类 isBugCondition=false 分支 + 随机参考图数量（含临界 8/9/10）
   * + 随机时长/分辨率/场景。每个输入都「确实不满足 bug 条件」，使断言在修复前后均成立。
   */
  const nonBugScenarioArb = fc.record({
    kind: fc.constantFrom('first', 'cross-scene', 'prev-pending', 'prev-no-frame'),
    refCount: fc.integer({ min: 1, max: 12 }), // 含 8/9/10 临界，验证承接上限保持
    genDuration: fc.integer({ min: 4, max: 15 }),
    resolution: fc.constantFrom('480p', '720p'),
    currScene: fc.constantFrom('客厅', '室外', '厨房', ''),
  })

  it('对所有 isBugCondition=false 的输入，入队 referenceImages/prompt 不承接、scriptHash 与基线一致', async () => {
    await fc.assert(
      fc.asyncProperty(nonBugScenarioArb, async (scn) => {
        // —— 每个用例重置队列与事务捕获 ——
        mockQueue.add.mockClear()
        const captured: TxCaptured = {}
        installTransaction(1000, captured)

        // 装配随机数量参考图（不含任何尾帧）
        const refs = Array.from({ length: scn.refCount }, (_, i) => `asset://ref-${i}`)
        mockBuildGroupGenReference.mockResolvedValue({
          characterPrefix: CHARACTER_PREFIX,
          referenceImages: refs,
          referenceAudioUrl: undefined,
        })

        const group = makeCurrentGroupG({ genDuration: scn.genDuration })

        // 按分支构造前一组 P，确保「确实不满足 bug 条件」
        let prev: Record<string, unknown> | null
        switch (scn.kind) {
          case 'first':
            prev = null // 无前一组
            break
          case 'cross-scene':
            // 前一组成功且有尾帧，但与当前组跨场景 → 不承接
            prev = makePrevGroupP()
            mockPrisma.shot.findFirst.mockImplementation(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              async (args: any) => {
                const sgid = args?.where?.shotGroupId
                if (sgid === 'group-1') return { scene: `${scn.currScene}-异场景` }
                return { scene: scn.currScene }
              }
            )
            break
          case 'prev-pending':
            // 前一组未成功（乱序：先生成后序组）→ 不承接
            prev = makePrevGroupP({ genStatus: 'PENDING', lastFrameUrl: null })
            break
          case 'prev-no-frame':
            // 前一组成功但无受信尾帧 → 不承接
            prev = makePrevGroupP({ genStatus: 'SUCCEEDED', lastFrameUrl: null })
            break
          default:
            prev = null
        }

        installGroupQueries({ group, prev, successor: null })

        const res = await POST(
          createRequest('user-1', 'group-2', { resolution: scn.resolution }),
          createParams('group-2')
        )

        // 基线断言
        expect(res.status).toBe(202)
        expect(mockQueue.add).toHaveBeenCalledTimes(1) // 仅入队目标组一次，无级联（Req 3.8）

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enqueued = mockQueue.add.mock.calls[0][1] as any

        const durationNum = Math.min(Math.round(scn.genDuration), MAX_GROUP_DURATION)
        const expectedHash = computeScriptHash(BASE_PROMPT, durationNum, scn.resolution)

        // 参考图：原样透传，不追加尾帧、数量不变（Req 3.1/3.2/3.3 + 软承接上限 Req 3.4 保持）
        expect(enqueued.referenceImages).toEqual(refs)
        expect(enqueued.referenceImages).not.toContain(PREV_LAST_FRAME_URL)
        expect(enqueued.referenceImages.length).toBe(scn.refCount)

        // prompt：无承接文案（Req 3.1/3.2/3.3）
        expect(enqueued.prompt).toBe(BASE_PROMPT)
        expect(enqueued.prompt).not.toContain(CONTINUATION_MARK)

        // 软承接来源约束：不使用 first_frame、不含 firstFrameUrl（Req 3.4/3.7）
        expect(enqueued).not.toHaveProperty('firstFrameUrl')
        expect(JSON.stringify(enqueued)).not.toContain('first_frame')

        // 单组路径不串入链式参数，不影响链式行为（Req 3.5）
        expect(enqueued.chainMode).toBeUndefined()
        expect(enqueued.chainCurrentIndex).toBeUndefined()
        expect(enqueued.chainTotalGroups).toBeUndefined()

        // scriptHash 与 promptSnapshot 与基线逐项一致（Req 3.6）
        expect(captured.promptSnapshot).toBe(BASE_PROMPT)
        expect(captured.scriptHash).toBe(expectedHash)
      }),
      { numRuns: 200 }
    )
  })

  it('参考图临界 8/9/10：非 bug 输入下不追加尾帧、总数恒等于基线数量（软承接上限保持，Req 3.4）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(8, 9, 10), async (refCount) => {
        mockQueue.add.mockClear()
        const captured: TxCaptured = {}
        installTransaction(1000, captured)

        const refs = Array.from({ length: refCount }, (_, i) => `asset://ref-${i}`)
        mockBuildGroupGenReference.mockResolvedValue({
          characterPrefix: CHARACTER_PREFIX,
          referenceImages: refs,
          referenceAudioUrl: undefined,
        })

        // 跨场景前一组（不触发承接）：即便有尾帧也不应追加
        installGroupQueries({
          group: makeCurrentGroupG(),
          prev: makePrevGroupP(),
          successor: null,
        })
        mockPrisma.shot.findFirst.mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async (args: any) => {
            const sgid = args?.where?.shotGroupId
            if (sgid === 'group-1') return { scene: '室外' }
            return { scene: SCENE }
          }
        )

        const res = await POST(createRequest(), createParams())
        expect(res.status).toBe(202)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enqueued = mockQueue.add.mock.calls[0][1] as any
        // 数量不变：不因临界值发生任何追加
        expect(enqueued.referenceImages.length).toBe(refCount)
        expect(enqueued.referenceImages).not.toContain(PREV_LAST_FRAME_URL)
      }),
      { numRuns: 30 }
    )
  })
})

// ============================================================
// scriptHash 幂等短路 / force 抽卡 / 积分冻结行为保持（Req 3.6）
// ============================================================
describe('Preservation — scriptHash 幂等、force 抽卡、积分冻结行为不变（Req 3.6）', () => {
  it('SUCCEEDED 且 scriptHash 命中且非 force：幂等短路，不入队、不冻结积分', async () => {
    const hash = computeScriptHash(BASE_PROMPT, 12, '480p')
    const group = makeCurrentGroupG({
      genStatus: 'SUCCEEDED',
      scriptHash: hash,
      genVideoUrl: 'https://oss.example.com/v.mp4',
    })
    installGroupQueries({ group, prev: makePrevGroupP(), successor: null })
    mockPrisma.generationJob.findFirst.mockResolvedValue({ id: 'job-existing', status: 'SUCCEEDED' })

    const res = await POST(createRequest(), createParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent).toBe(true)
    expect(mockQueue.add).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled() // 无冻结/扣费
  })

  it('force=true：绕过 SUCCEEDED 幂等短路，走真生成（入队 + 冻结事务）', async () => {
    const hash = computeScriptHash(BASE_PROMPT, 12, '480p')
    const group = makeCurrentGroupG({
      genStatus: 'SUCCEEDED',
      scriptHash: hash,
      genVideoUrl: 'https://oss.example.com/v.mp4',
    })
    installGroupQueries({ group, prev: makePrevGroupP(), successor: null })
    const captured: TxCaptured = {}
    installTransaction(1000, captured)

    const res = await POST(
      createRequest('user-1', 'group-2', { force: true }),
      createParams()
    )
    expect(res.status).toBe(202)
    expect(mockQueue.add).toHaveBeenCalledTimes(1)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('QUEUED 进行中且 scriptHash 命中：幂等短路返回进行中，不重复入队/扣费', async () => {
    const hash = computeScriptHash(BASE_PROMPT, 12, '480p')
    const group = makeCurrentGroupG({ genStatus: 'QUEUED', scriptHash: hash })
    installGroupQueries({ group, prev: makePrevGroupP(), successor: null })
    mockPrisma.generationJob.findFirst.mockResolvedValue({ id: 'job-q', status: 'QUEUED' })

    const res = await POST(createRequest(), createParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent).toBe(true)
    expect(mockQueue.add).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('余额不足：冻结前拒绝（400），不入队、不进入事务', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', creditBalance: 1 })
    installGroupQueries({ group: makeCurrentGroupG(), prev: null, successor: null })

    const res = await POST(createRequest(), createParams())
    expect(res.status).toBe(400)
    expect(mockQueue.add).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('积分冻结：RESERVE 流水金额为 -cost、余额扣减为 balance-cost（行为不变）', async () => {
    const captured: TxCaptured = {}
    installTransaction(1000, captured)
    installGroupQueries({ group: makeCurrentGroupG(), prev: null, successor: null })

    const res = await POST(
      createRequest('user-1', 'group-2', { resolution: '720p' }),
      createParams()
    )
    expect(res.status).toBe(202)

    const expectedCost = Math.ceil(12 * 1.5) // duration 12, 720p → 18
    expect(captured.costEstimate).toBe(expectedCost)
    expect(captured.reserve?.action).toBe('RESERVE')
    expect(captured.reserve?.amount).toBe(-expectedCost)
    expect(captured.newBalance).toBe(1000 - expectedCost)
  })
})

// ============================================================
// 乱序 / 时序场景：系统不发起自动回补 / 级联重生成（Req 3.8 方案 A）
// ============================================================
describe('Preservation — 乱序/时序：无自动回补、无级联重生成（Req 3.8）', () => {
  it('(a) 先生成后序组而前序组当时未成功：后序组独立起镜、不报错、仅入队自身一次', async () => {
    installGroupQueries({
      group: makeCurrentGroupG(), // group-2（后序组）
      prev: makePrevGroupP({ genStatus: 'PENDING', lastFrameUrl: null }), // 前序组当时未成功
      successor: null,
    })
    const captured: TxCaptured = {}
    installTransaction(1000, captured)

    const res = await POST(createRequest('user-1', 'group-2'), createParams('group-2'))
    expect(res.status).toBe(202)
    expect(mockQueue.add).toHaveBeenCalledTimes(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueued = mockQueue.add.mock.calls[0][1] as any
    expect(enqueued.shotGroupId).toBe('group-2')
    expect(enqueued.referenceImages).toEqual([BASE_REF]) // 独立起镜，无承接
    expect(enqueued.prompt).not.toContain(CONTINUATION_MARK)
  })

  it('(b) force 重生成前序组：仅重生成该组自身，绝不级联重生成已生成的后序组', async () => {
    // 对前序组 group-1 force 重生成，项目存在后继组 group-2（已生成）
    const prevGroup = makeCurrentGroupG({
      id: 'group-1',
      groupIndex: 0,
      startTime: 0,
      endTime: 12,
      genStatus: 'SUCCEEDED',
      scriptHash: null, // 与新算哈希不一致 → 不走幂等短路，force 真生成
      genVideoUrl: 'https://oss.example.com/v1.mp4',
    })
    const successorN = {
      id: 'group-2',
      groupIndex: 1,
      genStatus: 'SUCCEEDED',
      shots: [{ orderIndex: 0, scene: SCENE }],
    }
    installGroupQueries({ group: prevGroup, prev: null, successor: successorN })
    const captured: TxCaptured = {}
    installTransaction(1000, captured)

    const res = await POST(
      createRequest('user-1', 'group-1', { force: true }),
      createParams('group-1')
    )
    expect(res.status).toBe(202)

    // 关键：单组路由对单一目标组入队恰好一次，不对后继组发起任何重生成（方案 A：维持现状）
    expect(mockQueue.add).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueued = mockQueue.add.mock.calls[0][1] as any
    expect(enqueued.shotGroupId).toBe('group-1')
  })
})
