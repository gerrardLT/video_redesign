/* eslint-disable @typescript-eslint/no-explicit-any */
// Feature: local-life-depth-enhancements, Property 1: 额度预检与守恒
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 1: 额度预检与守恒
 *
 * For any 消耗积分的 AI 动作（重新生成文案 / 按平台改写 / 一键改写规避 / 生成参考图 /
 * 单版本重生成 / 局部重拍），给定任意余额 balance 与成本 cost：
 *   - balance < cost：该动作必在预检阶段被拒绝（抛 INSUFFICIENT_CREDITS），
 *     且不发生任何 reserve / charge / refund（无任何扣减）；
 *   - balance >= cost：执行结果必恰为 RESERVE→CHARGE（成功）或 RESERVE→REFUND（失败/超时）之一，
 *     绝不出现无 RESERVE 的 CHARGE、绝不出现同一 reservation 的双重 CHARGE。
 *
 * **Validates: Requirements 0.7, 4.8, 4.9**
 *
 * 测试手段（Node 环境，fast-check ≥100 次迭代）：
 * - 对 credit-service.getBalance 做内存桩（返回随机生成的 balance，用于驱动预检分支）；
 * - 对 merchant-billing-service 的 reserve/charge/refund 做内存桩，按调用顺序记录
 *   { action, bizRefId } 调用序列（守恒断言的依据），estimateRenderCost 桩返回确定成本；
 * - 对 prisma(@/lib/db) / LLM(global fetch) / Flux(@/lib/flux) / FFmpeg(child_process) /
 *   fs / Seedance / OSS(@/lib/storage) / 分布式锁 / impact-scope-service / 内容熵服务
 *   全部做内存桩，使外部依赖在「成功路径」可控成功、在「失败路径」可控失败；
 * - 真实调用被测服务函数，断言其计费调用序列符合「预检与守恒」。
 *
 * 被测覆盖：
 *   - publish-copy-service: regenerateCopy（重新生成文案）/ rewriteForPlatform（按平台改写）
 *   - compliance-service:   rewriteToCompliant（一键改写规避）
 *   - capture-director:     generateShotReferenceImage（生成参考图）
 *   - local-render-service: regenerateSingleVariant（单版本重生成）/ rerenderAffectedScope（局部重拍）
 */

// ========================
// 共享内存桩状态（hoisted，供 vi.mock 工厂与测试体共同引用）
// ========================

const h = vi.hoisted(() => {
  // 计费调用序列：每次 reserve/charge/refund 追加一条，断言守恒用
  const billingLog: { action: 'RESERVE' | 'CHARGE' | 'REFUND'; bizRefId: string }[] = []

  // 余额 + 外部依赖成败开关（每次迭代由测试体设置）
  const state = {
    balance: 0,
    lockOk: true, // 分布式锁是否获取成功（false 用于驱动渲染失败路径）
    fluxOk: true, // Flux 文生图是否成功（false 用于驱动参考图失败路径）
    fetchOk: true, // LLM(fetch) 是否成功（false 用于驱动文案/合规失败路径）
  }

  // LLM 成功时返回的合法平台文案（满足 publish-copy 后处理校验：标题≤30/封面≤15/标签3-10/CTA 非空）
  const SUCCESS_COPY = {
    title: '招牌推荐',
    coverTitle: '必吃',
    caption: '门店实拍分享，欢迎来尝尝',
    tags: ['美食', '本地', '推荐'],
    cta: '到店体验',
  }

  // 综合 prisma 内存桩：覆盖六个动作读写所需的全部模型方法
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaMock: any = {
    contentBrief: { findUniqueOrThrow: vi.fn(), update: vi.fn(async () => ({})) },
    productOffer: { findUnique: vi.fn(async () => null) },
    complianceCheck: { findFirst: vi.fn(), create: vi.fn() },
    videoVariant: { findUniqueOrThrow: vi.fn(), update: vi.fn(async (args: any) => ({ id: args?.where?.id ?? 'v', ...args?.data })) },
    publishMetric: { findFirst: vi.fn(async () => null) },
    consentRecord: { findFirst: vi.fn(async () => null) },
    shotTask: { findUniqueOrThrow: vi.fn() },
  }
  // $transaction 透传同一 prisma 桩作为事务客户端
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prismaMock))

  return { billingLog, state, SUCCESS_COPY, prismaMock }
})

// ========================
// 模块级内存桩
// ========================

// Prisma
vi.mock('@/lib/shared/db', () => ({ prisma: h.prismaMock }))

// credit-service：getBalance 返回随机余额（预检分支驱动）；estimateGroupCreditCost 透传确定成本
vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: vi.fn(async () => h.state.balance),
  estimateGroupCreditCost: vi.fn((durationSec: number) => Math.ceil(durationSec)),
}))

// merchant-billing-service：reserve/charge/refund 记录调用序列；estimateRenderCost 返回确定成本
vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  estimateRenderCost: vi.fn((groupDurations: number[]) =>
    groupDurations.reduce((s, d) => s + Math.ceil(d), 0),
  ),
  reserveMerchantCredits: vi.fn(async (input: { bizRefId: string }) => {
    h.billingLog.push({ action: 'RESERVE', bizRefId: input.bizRefId })
  }),
  chargeMerchantCredits: vi.fn(async (_tx: unknown, input: { bizRefId: string }) => {
    h.billingLog.push({ action: 'CHARGE', bizRefId: input.bizRefId })
  }),
  refundMerchantCredits: vi.fn(async (input: { bizRefId: string }) => {
    h.billingLog.push({ action: 'REFUND', bizRefId: input.bizRefId })
  }),
}))

// 内容熵服务（合规重跑用）：返回高独特性分，使重跑判定为 LOW（不影响计费守恒）
vi.mock('@/lib/merchant/content-entropy-service', () => ({
  calculateContentEntropy: vi.fn(async () => ({ uniquenessScore: 100 })),
}))

// Flux 文生图（参考图生成用）
vi.mock('@/lib/shared/flux', () => ({
  generateFirstFrame: vi.fn(async () => {
    if (!h.state.fluxOk) throw new Error('[stub] Flux 文生图失败')
    return { imageUrl: 'https://oss.example.com/shot-ref.jpg' }
  }),
}))

// OSS 存储（渲染上传/下载用）
vi.mock('@/lib/shared/storage', () => ({
  uploadBuffer: vi.fn(async () => {}),
  getSignedObjectUrl: vi.fn(() => 'https://oss.example.com/signed'),
  downloadToTemp: vi.fn(async () => {}),
}))

// Seedance（补充片段用；本测试镜头均有素材，不会触发）
vi.mock('@/lib/video/seedance', () => ({
  createSeedanceTask: vi.fn(async () => ({ taskId: 'seed-task' })),
  getSeedanceTaskStatus: vi.fn(async () => ({ status: 'succeeded', videoUrl: 'https://x/v.mp4' })),
}))

// 分布式锁（渲染并发控制用）
vi.mock('@/lib/shared/distributed-lock', () => ({
  acquireLock: vi.fn(async () => h.state.lockOk),
  releaseLock: vi.fn(async () => {}),
}))

// 进度发布（SSE，渲染中调用）
vi.mock('@/lib/shared/progress-publisher', () => ({
  publishStateChange: vi.fn(async () => {}),
  publishCompleted: vi.fn(async () => {}),
  publishFailed: vi.fn(async () => {}),
}))

// 受影响范围计算（局部重拍用）
vi.mock('@/lib/merchant/impact-scope-service', () => ({
  computeReshootScope: vi.fn(async () => ({ affectedGroupIds: ['shot-1'], hasContinuityChain: false })),
}))

// FFmpeg / FFprobe（渲染合成用）：通过 promisify.custom 提供异步桩，
// ffprobe 解析 stdout JSON，故返回合法元数据；ffmpeg 调用忽略 stdout。
vi.mock('child_process', () => {
  const ffprobeJson = JSON.stringify({
    streams: [{ codec_type: 'video', width: 720, height: 1280 }],
    format: { duration: '12.00' },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execFile: any = function execFileStub() {}
  execFile[Symbol.for('nodejs.util.promisify.custom')] = async () => ({
    stdout: ffprobeJson,
    stderr: 'YAVG:128.0',
  })
  return { execFile, default: { execFile } }
})

// fs/promises：渲染读写临时文件桩（readFile 返回 Buffer 供上传）
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  readFile: vi.fn(async () => Buffer.from('stub-binary')),
  stat: vi.fn(async () => ({ size: 1024 })),
}))

// LLM 调用统一走 global fetch：成功返回合法文案 JSON，失败返回非 ok 响应
vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    if (!h.state.fetchOk) {
      return { ok: false, status: 500, text: async () => 'stub LLM error' } as unknown as Response
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(h.SUCCESS_COPY) } }] }),
    } as unknown as Response
  }),
)

// LLM 环境变量（publish-copy / compliance 缺失会直接抛错，需提供）
process.env.MERCHANT_LLM_API_URL = 'https://llm.example.com/v1'
process.env.MERCHANT_LLM_API_KEY = 'stub-key'

// ========================
// 动态导入被测服务（确保 mock 生效）
// ========================

const { regenerateCopy, rewriteForPlatform } = await import('@/lib/merchant/publish-copy-service')
const { rewriteToCompliant } = await import('@/lib/merchant/compliance-service')
const { generateShotReferenceImage } = await import('@/lib/merchant/capture-director')
const { regenerateSingleVariant, rerenderAffectedScope } = await import('@/lib/merchant/local-render-service')

// ========================
// 各动作固定成本（与服务实现一致）
// ========================

const COST_COPY = 2 // CREDIT_COST_COPY_REWRITE
const COST_SHOT_REF = 2 // CREDIT_COST_SHOT_REFERENCE_IMAGE
const COST_COMPLIANCE = 5 // compliance-service 内部 CREDIT_COST_COMPLIANCE_REWRITE
const COST_RENDER = 10 // estimateRenderCost([10]) = 10（桩：单镜头组时长 10s）

// ========================
// 通用工具
// ========================

type Mode = 'insufficient' | 'success' | 'failure'

/**
 * 由 mode + 随机扰动 delta 计算余额：
 * - insufficient：balance ∈ [0, cost-1]
 * - success/failure：balance ∈ [cost, cost+delta]
 */
function resolveBalance(mode: Mode, cost: number, delta: number): number {
  if (mode === 'insufficient') {
    // cost ≥ 1，保证落在 [0, cost-1]
    return cost <= 1 ? 0 : delta % cost
  }
  return cost + delta
}

/** 守恒断言：按 mode 校验计费调用序列 */
function assertConserved(mode: Mode): void {
  const log = h.billingLog
  const actions = log.map((e) => e.action)

  if (mode === 'insufficient') {
    // 预检阶段拒绝：无任何 reserve/charge/refund
    expect(actions).toEqual([])
    return
  }

  if (mode === 'success') {
    expect(actions).toEqual(['RESERVE', 'CHARGE'])
  } else {
    expect(actions).toEqual(['RESERVE', 'REFUND'])
  }

  // 通用不变式（无论成功/失败）：
  // 1) 不存在无 RESERVE 前置的 CHARGE
  let reserved = false
  for (const e of log) {
    if (e.action === 'RESERVE') reserved = true
    if (e.action === 'CHARGE') expect(reserved).toBe(true)
  }
  // 2) 不存在双重 CHARGE
  expect(log.filter((e) => e.action === 'CHARGE').length).toBeLessThanOrEqual(1)
  // 3) 全部调用同属一个 reservation（同一 bizRefId）
  expect(new Set(log.map((e) => e.bizRefId)).size).toBe(1)
}

/** 重置每次迭代的内存状态 */
function resetIteration(mode: Mode): void {
  h.billingLog.length = 0
  // 外部依赖成败开关：成功路径全 OK；失败路径下文按动作设置具体失败源
  h.state.lockOk = true
  h.state.fluxOk = true
  h.state.fetchOk = true
}

/** 包装：执行动作并按 mode 断言抛错与守恒 */
async function runAndAssert(mode: Mode, invoke: () => Promise<unknown>): Promise<void> {
  if (mode === 'insufficient') {
    let thrown: unknown
    try {
      await invoke()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeDefined()
    // 必须是积分不足（预检拒绝），而非其它错误
    expect((thrown as { code?: string }).code).toBe('INSUFFICIENT_CREDITS')
    assertConserved('insufficient')
    return
  }

  if (mode === 'success') {
    await expect(invoke()).resolves.toBeDefined()
    assertConserved('success')
    return
  }

  // failure：动作应抛错，但计费已 RESERVE→REFUND 守恒
  let failed = false
  try {
    await invoke()
  } catch {
    failed = true
  }
  expect(failed).toBe(true)
  assertConserved('failure')
}

const modeArb = fc.constantFrom<Mode>('insufficient', 'success', 'failure')
const deltaArb = fc.integer({ min: 0, max: 200 })

// PublishPlatform 取值（与 src/types/merchant.ts 对齐）
const PLATFORMS = ['DOUYIN', 'KUAISHOU', 'XIAOHONGSHU', 'WECHAT_CHANNELS'] as const

const NUM_RUNS = 100

// ========================
// describe 1: 重新生成文案 / 按平台改写（publish-copy-service）
// ========================

describe('Property 1: 额度预检与守恒 — publish-copy-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** 配置 publish-copy 的 prisma 读取（含改写所需的现有平台文案） */
  function setupCopyPrisma(platform: string): void {
    const brief = {
      id: 'brief-1',
      storeId: 'store-1',
      offerId: null,
      copyEdited: false,
      platformCopies: { [platform]: h.SUCCESS_COPY },
      store: {
        id: 'store-1',
        name: '测试小店',
        industry: '餐饮',
        city: '杭州',
        district: '西湖区',
        businessArea: '文三路',
        mainProducts: ['牛肉面'],
        mainSellingPoints: ['现熬骨汤'],
        profile: {
          id: 'profile-1',
          storeId: 'store-1',
          contentPositioning: '社区面馆',
          recommendedPersona: '热情老板',
          hookKeywords: ['现熬'],
          forbiddenClaims: [],
          preferredCta: ['到店体验'],
        },
      },
    }
    h.prismaMock.contentBrief.findUniqueOrThrow.mockImplementation(async (args: { select?: unknown }) => {
      // tx 内 select platformCopies 的读取 与 loadCopyContext 的 include 读取共用同一对象
      if (args?.select) return { platformCopies: { [platform]: h.SUCCESS_COPY } }
      return brief
    })
  }

  it('重新生成文案：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, fc.constantFrom(...PLATFORMS), async (mode, delta, platform) => {
        resetIteration(mode)
        setupCopyPrisma(platform)
        h.state.balance = resolveBalance(mode, COST_COPY, delta)
        h.state.fetchOk = mode !== 'failure' // 失败路径：LLM 失败 → 文案为空 → 退款

        await runAndAssert(mode, () =>
          regenerateCopy({ contentBriefId: 'brief-1', platform: platform as never, userId: 'user-1', confirmOverwrite: true }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('按平台改写：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, fc.constantFrom(...PLATFORMS), async (mode, delta, platform) => {
        resetIteration(mode)
        setupCopyPrisma(platform)
        h.state.balance = resolveBalance(mode, COST_COPY, delta)
        h.state.fetchOk = mode !== 'failure'

        await runAndAssert(mode, () =>
          rewriteForPlatform({ contentBriefId: 'brief-1', platform: platform as never, userId: 'user-1', confirmOverwrite: true }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ========================
// describe 2: 一键改写规避（compliance-service）
// ========================

describe('Property 1: 额度预检与守恒 — compliance-service.rewriteToCompliant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupCompliancePrisma(): void {
    // 加载 brief（suggested* 草稿 + tags）
    h.prismaMock.contentBrief.findUniqueOrThrow.mockResolvedValue({
      id: 'brief-1',
      suggestedTitle: '招牌推荐',
      suggestedCoverTitle: '必吃',
      suggestedCaption: '门店实拍分享',
      suggestedCta: '到店体验',
      tags: ['美食'],
    })
    // 已存在一次合规检查（含命中风险，作为改写 evidence；避免触发内部初检）
    h.prismaMock.complianceCheck.findFirst.mockResolvedValue({
      id: 'cc-0',
      issues: [{ dimension: 'ABSOLUTE_CLAIM', riskLevel: 'HIGH', field: 'title', matchedText: '最好', reason: '绝对化用语' }],
      createdAt: new Date(),
    })
    // 重跑读取的 videoVariant（数据干净 → 重跑判定 LOW）
    h.prismaMock.videoVariant.findUniqueOrThrow.mockResolvedValue({
      id: 'var-1',
      subtitles: [],
      renderParams: {},
      generationLog: [],
      contentBrief: {
        id: 'brief-1',
        suggestedTitle: '招牌推荐',
        suggestedCaption: '门店实拍分享',
        suggestedCoverTitle: '必吃',
        suggestedCta: '到店体验',
        shotTasks: [],
        store: { id: 'store-1', canShootCustomers: false },
      },
    })
    // 重跑写入的检查记录
    h.prismaMock.complianceCheck.create.mockResolvedValue({
      id: 'cc-1',
      contentBriefId: 'brief-1',
      videoVariantId: 'var-1',
      riskLevel: 'LOW',
      passed: true,
      acknowledgedAt: null,
      createdAt: new Date(),
    })
  }

  it('一键改写规避：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, async (mode, delta) => {
        resetIteration(mode)
        setupCompliancePrisma()
        h.state.balance = resolveBalance(mode, COST_COMPLIANCE, delta)
        h.state.fetchOk = mode !== 'failure' // 失败路径：改写 LLM 失败 → 退款

        await runAndAssert(mode, () =>
          rewriteToCompliant({ contentBriefId: 'brief-1', videoVariantId: 'var-1', userId: 'user-1' }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ========================
// describe 3: 生成参考图（capture-director）
// ========================

describe('Property 1: 额度预检与守恒 — capture-director.generateShotReferenceImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupShotPrisma(): void {
    h.prismaMock.shotTask.findUniqueOrThrow.mockResolvedValue({
      id: 'shot-1',
      title: '招牌特写',
      instruction: '对准招牌菜拍摄',
      contentBrief: {
        id: 'brief-1',
        store: {
          id: 'store-1',
          name: '测试小店',
          mainProducts: ['牛肉面'],
          mainSellingPoints: ['现熬骨汤'],
          profile: { visualStyle: '暖色调', contentPositioning: '社区面馆' },
        },
      },
    })
  }

  it('生成参考图：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, async (mode, delta) => {
        resetIteration(mode)
        setupShotPrisma()
        h.state.balance = resolveBalance(mode, COST_SHOT_REF, delta)
        h.state.fluxOk = mode !== 'failure' // 失败路径：Flux 文生图失败 → 退款

        await runAndAssert(mode, () =>
          generateShotReferenceImage({ shotTaskId: 'shot-1', userId: 'user-1' }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ========================
// describe 4: 单版本重生成 / 局部重拍（local-render-service）
// ========================

describe('Property 1: 额度预检与守恒 — local-render-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** 单镜头（含素材，时长 10s → 成本 10），单版本 PROMOTION */
  function buildShotTasks() {
    return [
      {
        id: 'shot-1',
        type: 'OFFER_DISPLAY',
        order: 0,
        required: false,
        durationSec: 10,
        title: '优惠展示',
        instruction: '展示优惠价格',
        examplePrompt: null,
        rawAssets: [{ id: 'asset-1', ossKey: 'k/asset-1.mp4', durationSec: 10, type: 'OFFER_DISPLAY' }],
      },
    ]
  }

  it('单版本重生成：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, async (mode, delta) => {
        resetIteration(mode)
        h.prismaMock.videoVariant.findUniqueOrThrow.mockResolvedValue({
          id: 'var-1',
          type: 'PROMOTION',
          contentBrief: {
            id: 'brief-1',
            storeId: 'store-1',
            hook: '今日特价',
            mainMessage: '门店招牌',
            suggestedCta: '到店体验',
            shotTasks: buildShotTasks(),
            store: { id: 'store-1' },
          },
        })
        h.state.balance = resolveBalance(mode, COST_RENDER, delta)
        h.state.lockOk = mode !== 'failure' // 失败路径：渲染锁获取失败 → 退款

        await runAndAssert(mode, () =>
          regenerateSingleVariant({ videoVariantId: 'var-1', userId: 'user-1' }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('局部重拍：balance<cost 预检拒绝；balance>=cost 恰为 RESERVE→CHARGE 或 RESERVE→REFUND', async () => {
    /** **Validates: Requirements 0.7, 4.8, 4.9** */
    await fc.assert(
      fc.asyncProperty(modeArb, deltaArb, async (mode, delta) => {
        resetIteration(mode)
        h.prismaMock.contentBrief.findUniqueOrThrow.mockResolvedValue({
          id: 'brief-1',
          storeId: 'store-1',
          hook: '今日特价',
          mainMessage: '门店招牌',
          suggestedCta: '到店体验',
          shotTasks: buildShotTasks(),
          store: { id: 'store-1' },
          videoVariants: [{ id: 'var-1', type: 'PROMOTION' }],
        })
        h.state.balance = resolveBalance(mode, COST_RENDER, delta)
        h.state.lockOk = mode !== 'failure' // 失败路径：渲染锁获取失败 → 退款

        await runAndAssert(mode, () =>
          rerenderAffectedScope({ contentBriefId: 'brief-1', shotTaskId: 'shot-1', userId: 'user-1' }),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
