// Feature: local-life-depth-enhancements, Property 11: 改写后未通过不得标记通过
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { ABSOLUTE_CLAIMS } from '@/constants/merchant'

/**
 * Feature: local-life-depth-enhancements
 * Property 11: 改写后未通过不得标记通过
 *
 * 对 compliance-service.rewriteToCompliant 的重跑结果 recheck：
 * 当 recheck.riskLevel ∈ {HIGH, BLOCKED} 时，必须 stillBlocked=true，
 * 且系统绝不将该文案标记为合规通过（recheck.passed !== true），并显式返回剩余风险点（issues 非空）。
 * 反之（LOW/MEDIUM）stillBlocked 必须为 false。
 *
 * **Validates: Requirements 2.7**
 *
 * 测试手段（真实接口、无 fallback、无伪造）：
 * - rewriteToCompliant 内部直接调用同模块函数 runComplianceCheck（同模块内的局部引用，
 *   无法被 vi.mock 单独拦截）。因此本测试驱动 runComplianceCheck「随机 riskLevel」的方式
 *   是控制其真实依赖输入，而非伪造该被测函数自身的协作者：
 *     · 对 @/lib/content-entropy-service 的 calculateContentEntropy 做内存桩，按场景返回
 *       随机 uniquenessScore（<40→BLOCKED 维度，[40,60)→MEDIUM 维度，≥60→无熵风险）；
 *     · 对 LLM 改写（全局 fetch）做内存桩，按场景产出改写后文案——在 HIGH 场景注入一个
 *       绝对化用语（ABSOLUTE_CLAIMS）使重跑命中 HIGH。
 *   两个独立杠杆覆盖 LOW/MEDIUM/HIGH/BLOCKED 四档真实 riskLevel，runComplianceCheck 全程
 *   走真实规则链计算，断言作用于真实重跑结果。
 * - 对 @/lib/db 的 prisma、@/lib/credit-service 的 getBalance、@/lib/merchant-billing-service
 *   的 reserve/charge/refund 做内存桩，复现 brief 文案写回→重跑的状态往返，不依赖真实数据库。
 */

// ========================
// 共享内存状态（每次迭代重置）
// ========================

const state = vi.hoisted(() => ({
  // ContentBrief 行：rewriteToCompliant 读取 → LLM 改写写回 → 重跑读取（同一引用，复现往返）
  brief: {
    id: 'brief_test',
    storeId: 'store_test',
    suggestedTitle: '' as string | null,
    suggestedCoverTitle: '' as string | null,
    suggestedCaption: '' as string | null,
    suggestedCta: '' as string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags: [] as any[],
  },
  store: { id: 'store_test', canShootCustomers: false },
  // VideoVariant 行：保持「干净」以中和 AIGC / 字幕维度
  variant: {
    id: 'variant_test',
    subtitles: null as unknown,
    renderParams: null as unknown,
    generationLog: null as unknown,
  },
  // 无 CUSTOMER_REACTION 镜头 → 中和顾客出镜维度
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shotTasks: [] as any[],
  // 最近一次合规检查（非空 → 跳过基线重跑，仅评估改写后的那次重跑）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  latestCheckIssues: [] as any[],
  // 同质化评分（由 calculateContentEntropy 桩返回，按场景随机）
  entropyScore: 80,
}))

// LLM 改写桩返回的下一条文案（每次迭代设置）
const fetchState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rewrittenCopy: null as any,
}))

// ========================
// Mock 依赖（内存桩）
// ========================

vi.mock('@/lib/shared/db', () => {
  const prisma = {
    contentBrief: {
      // rewriteToCompliant 加载 brief 草稿
      findUniqueOrThrow: vi.fn(async () => ({ ...state.brief })),
      // LLM 改写写回 suggested* + tags（落到共享行，使重跑作用于新文案）
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.brief, data)
        return { ...state.brief }
      }),
    },
    complianceCheck: {
      // 最近一次检查记录（非空 → 跳过基线 runComplianceCheck）
      findFirst: vi.fn(async () => ({ issues: state.latestCheckIssues })),
      // runComplianceCheck 保存记录：回显写入 data（riskLevel/passed 即计算结果）
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cc_test',
        acknowledgedAt: null,
        createdAt: new Date(),
        ...data,
      })),
    },
    // runComplianceCheck 内部：装配 variant + contentBrief（含已写回的 suggested*）
    videoVariant: {
      findUniqueOrThrow: vi.fn(async () => ({
        ...state.variant,
        contentBrief: {
          ...state.brief,
          store: state.store,
          shotTasks: state.shotTasks,
        },
      })),
    },
    publishMetric: { findFirst: vi.fn(async () => null) },
    consentRecord: { findFirst: vi.fn(async () => null) },
    // charge 走外部事务：透传一个空 tx（chargeMerchantCredits 已被桩为 no-op）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({})),
  }
  return { prisma }
})

vi.mock('@/lib/merchant/content-entropy-service', () => ({
  // 按场景返回随机同质化评分，驱动重跑的 ENTROPY 维度（真实规则链据此判级）
  calculateContentEntropy: vi.fn(async () => ({ uniquenessScore: state.entropyScore })),
}))

vi.mock('@/lib/shared/credit-service', () => ({
  // 余额充足，使改写动作通过预检并执行（计费守恒由 Property 1 专门覆盖，此处不关注）
  getBalance: vi.fn(async () => 1000),
}))

vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  reserveMerchantCredits: vi.fn(async () => undefined),
  chargeMerchantCredits: vi.fn(async () => undefined),
  refundMerchantCredits: vi.fn(async () => undefined),
}))

// LLM 改写：桩全局 fetch，返回 fetchState.rewrittenCopy 的严格 JSON
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(fetchState.rewrittenCopy) } }],
    }),
  })),
)

// LLM 配置：模块级常量在导入时读取 env，必须在动态导入前设置（否则改写动作会因配置缺失抛错）
process.env.MERCHANT_LLM_API_URL = 'https://test.local/v1'
process.env.MERCHANT_LLM_API_KEY = 'test-key'

// 动态导入以确保上述 mock / env 生效
const { rewriteToCompliant } = await import('@/lib/merchant/compliance-service')

// ========================
// Arbitraries
// ========================

// 安全 ASCII 文本：违禁词库（ABSOLUTE_CLAIMS / FALSE_POPULARITY）均为中文，
// 纯 ASCII 文本可保证「干净」不误触发任何风险维度。
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyz '.split('')
const safeText = (maxLength: number) =>
  fc.array(fc.constantFrom(...SAFE_CHARS), { maxLength }).map((a) => a.join(''))

// 一个确定的绝对化用语（取自真实词库），HIGH 场景注入标题以命中重跑 HIGH 维度
const ABSOLUTE_WORD = ABSOLUTE_CLAIMS[0]

// 干净的改写后文案（不含任何违禁表达）
const cleanCopyArb = fc.record({
  title: safeText(20),
  coverTitle: safeText(10),
  caption: safeText(40),
  tags: fc.array(safeText(8), { maxLength: 5 }),
  cta: safeText(10),
})

// 场景：四档真实 riskLevel，各自配置驱动杠杆
//  LOW     : 熵≥60 且改写干净 → 无任何 issue
//  MEDIUM  : 熵∈[40,60) 且改写干净 → 仅 ENTROPY MEDIUM
//  HIGH    : 熵≥60 且改写标题注入绝对化用语 → ABSOLUTE_CLAIM HIGH
//  BLOCKED : 熵<40 且改写干净 → ENTROPY BLOCKED
const scenarioArb = fc.oneof(
  fc.record({ kind: fc.constant('LOW'), entropy: fc.integer({ min: 60, max: 100 }), injectAbsolute: fc.constant(false) }),
  fc.record({ kind: fc.constant('MEDIUM'), entropy: fc.integer({ min: 40, max: 59 }), injectAbsolute: fc.constant(false) }),
  fc.record({ kind: fc.constant('HIGH'), entropy: fc.integer({ min: 60, max: 100 }), injectAbsolute: fc.constant(true) }),
  fc.record({ kind: fc.constant('BLOCKED'), entropy: fc.integer({ min: 0, max: 39 }), injectAbsolute: fc.constant(false) }),
)

// 初始 brief 草稿文案（干净），改写前的状态，不影响最终判级（重跑作用于改写后文案）
const initialDraftArb = fc.record({
  suggestedTitle: safeText(20),
  suggestedCoverTitle: safeText(10),
  suggestedCaption: safeText(40),
  suggestedCta: safeText(10),
})

const BLOCKED_LEVELS = new Set(['HIGH', 'BLOCKED'])

// ========================
// Property 11: 改写后未通过不得标记通过
// ========================

describe('Property 11: 改写后未通过不得标记通过', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recheck.riskLevel∈{HIGH,BLOCKED} ⇒ stillBlocked=true 且未标记通过且显式返回剩余风险', async () => {
    /**
     * **Validates: Requirements 2.7**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        scenarioArb,
        cleanCopyArb,
        initialDraftArb,
        async (contentBriefId, videoVariantId, userId, scenario, cleanCopy, initialDraft) => {
          // ── 每次迭代重置共享内存状态（避免跨迭代污染）──
          state.entropyScore = scenario.entropy
          state.brief.id = contentBriefId
          state.brief.storeId = 'store_test'
          state.brief.suggestedTitle = initialDraft.suggestedTitle
          state.brief.suggestedCoverTitle = initialDraft.suggestedCoverTitle
          state.brief.suggestedCaption = initialDraft.suggestedCaption
          state.brief.suggestedCta = initialDraft.suggestedCta
          state.brief.tags = []
          state.variant.id = videoVariantId
          state.variant.subtitles = null
          state.variant.renderParams = null
          state.variant.generationLog = null
          state.shotTasks = []
          state.latestCheckIssues = [{ matchedText: '最便宜', reason: '历史命中示例' }]

          // 改写后文案：HIGH 场景在标题注入一个绝对化用语，其余场景保持干净
          fetchState.rewrittenCopy = {
            ...cleanCopy,
            title: scenario.injectAbsolute ? `${ABSOLUTE_WORD}${cleanCopy.title}` : cleanCopy.title,
          }

          const result = await rewriteToCompliant({ contentBriefId, videoVariantId, userId })
          const { recheck, stillBlocked } = result

          // 场景覆盖性校验：真实重跑判级与场景预期一致（确保 HIGH/BLOCKED 分支被真实触达）
          expect(recheck.riskLevel).toBe(scenario.kind)

          if (BLOCKED_LEVELS.has(recheck.riskLevel)) {
            // 不变式：未通过（HIGH/BLOCKED）必须 stillBlocked=true
            expect(stillBlocked).toBe(true)
            // 绝不标记为合规通过
            expect(recheck.passed).not.toBe(true)
            // 显式返回剩余风险点（命中项非空）
            expect(recheck.issues.length).toBeGreaterThan(0)
          } else {
            // LOW/MEDIUM：不视为「仍被阻断」
            expect(stillBlocked).toBe(false)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
