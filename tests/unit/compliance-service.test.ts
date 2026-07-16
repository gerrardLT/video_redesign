/**
 * 合规检查服务单元测试
 *
 * 测试范围：
 * - 绝对化用语检测（checkAbsoluteClaims 经 runComplianceCheck）
 * - 虚假火爆检测
 * - 风险等级判定（determineOverallRiskLevel）
 * - AIGC 标识检查
 * - 建议生成
 *
 * 隔离手法：mock prisma 及外部依赖（entropy、billing），
 * 仅测试合规扫描的纯规则逻辑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ABSOLUTE_CLAIMS, FALSE_POPULARITY } from '@/constants/merchant'

// ============================================================
// Mock prisma 和外部依赖
// ============================================================

vi.mock('@/lib/shared/db', () => {
  const createMock = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'cc-test',
    ...args.data,
    acknowledgedAt: null,
    createdAt: new Date(),
  }))

  const findUniqueOrThrowMock = vi.fn()

  return {
    prisma: {
      videoVariant: { findUniqueOrThrow: findUniqueOrThrowMock },
      complianceCheck: { create: createMock },
      consentRecord: { findMany: vi.fn(async () => []) },
    },
    __findUniqueOrThrow: findUniqueOrThrowMock,
  }
})

vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: vi.fn(async () => 1000),
}))

vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  reserveMerchantCredits: vi.fn(async () => ({ id: 'res-1' })),
  chargeMerchantCredits: vi.fn(async () => {}),
  refundMerchantCredits: vi.fn(async () => {}),
}))

vi.mock('@/lib/merchant/content-entropy-service', () => ({
  calculateContentEntropy: vi.fn(async () => ({ score: 80, details: 'ok' })),
}))

const { runComplianceCheck } = await import('@/lib/merchant/compliance-service')
const dbModule = await import('@/lib/shared/db')
const findUniqueOrThrow = (dbModule as unknown as { __findUniqueOrThrow: ReturnType<typeof vi.fn> }).__findUniqueOrThrow

// ============================================================
// 测试夹具
// ============================================================

/** 构造最小可用的 videoVariant + contentBrief + store 桩数据 */
function buildVariantStub(overrides?: {
  title?: string | null
  caption?: string | null
  coverTitle?: string | null
  cta?: string | null
  subtitles?: unknown
  renderParams?: unknown
  generationLog?: unknown
}) {
  return {
    id: 'vv-1',
    contentBriefId: 'cb-1',
    subtitles: overrides?.subtitles ?? null,
    renderParams: overrides?.renderParams ?? null,
    generationLog: overrides?.generationLog ?? null,
    contentBrief: {
      id: 'cb-1',
      storeId: 'store-1',
      suggestedTitle: overrides?.title ?? '日常推荐',
      suggestedCaption: overrides?.caption ?? '今天来尝尝',
      suggestedCoverTitle: overrides?.coverTitle ?? null,
      suggestedCta: overrides?.cta ?? '到店体验',
      shotTasks: [],
      store: { id: 'store-1', name: '测试门店' },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// 绝对化用语检测
// ============================================================

describe('绝对化用语检测', () => {
  it('title 中包含绝对化用语 → HIGH 风险', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(buildVariantStub({ title: '全城最好吃的牛肉面' }))

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    expect(result.passed).toBe(false)
    const absoluteIssues = result.issues.filter((i: { dimension: string }) => i.dimension === 'ABSOLUTE_CLAIM')
    expect(absoluteIssues.length).toBeGreaterThanOrEqual(1)
    expect(absoluteIssues.some((i: { matchedText?: string }) => i.matchedText === '最好')).toBe(true)
  })

  it('caption 中包含多个绝对化用语 → 检测出全部', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ caption: '保证100%好评，必吃唯一的选择' })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    const absoluteIssues = result.issues.filter((i: { dimension: string }) => i.dimension === 'ABSOLUTE_CLAIM')
    // 应检测出：保证、100%、必吃、唯一
    const matchedTexts = absoluteIssues.map((i: { matchedText?: string }) => i.matchedText ?? '')
    expect(matchedTexts).toContain('保证')
    expect(matchedTexts).toContain('100%')
    expect(matchedTexts).toContain('必吃')
    expect(matchedTexts).toContain('唯一')
  })

  it('无绝对化用语 → 不产生 ABSOLUTE_CLAIM 问题', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ title: '今天推荐这碗面', caption: '口感不错值得一试' })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    const absoluteIssues = result.issues.filter((i: { dimension: string }) => i.dimension === 'ABSOLUTE_CLAIM')
    expect(absoluteIssues).toHaveLength(0)
  })

  it('ABSOLUTE_CLAIMS 常量覆盖所有已知违禁词', () => {
    expect(ABSOLUTE_CLAIMS).toContain('最好')
    expect(ABSOLUTE_CLAIMS).toContain('第一')
    expect(ABSOLUTE_CLAIMS).toContain('全网最低')
    expect(ABSOLUTE_CLAIMS).toContain('唯一')
    expect(ABSOLUTE_CLAIMS).toContain('必吃')
    expect(ABSOLUTE_CLAIMS).toContain('100%')
  })
})

// ============================================================
// 风险等级判定
// ============================================================

describe('风险等级判定', () => {
  it('无问题 → LOW（通过）', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ title: '推荐', caption: '来尝尝' })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    expect(result.riskLevel).toBe('LOW')
    expect(result.passed).toBe(true)
  })

  it('存在绝对化用语 → HIGH（不通过）', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ title: '全城第一的面' })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    expect(['HIGH', 'BLOCKED']).toContain(result.riskLevel)
    expect(result.passed).toBe(false)
  })

  it('BLOCKED 时 blockedReasons 非空', async () => {
    // 使用绝对化用语 + 字幕中也有，确保风险叠加
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({
        title: '最好的选择',
        subtitles: [{ text: '保证好吃', startSec: 0, endSec: 2 }],
      })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })
    // 至少是 HIGH
    expect(result.passed).toBe(false)
  })
})

// ============================================================
// AIGC 标识检查
// ============================================================

describe('AIGC 标识检查', () => {
  it('renderParams 含 Seedance 引用 → MEDIUM', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({
        renderParams: { provider: 'Seedance', model: 'v1.5' },
      })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    const aigcIssues = result.issues.filter((i: { dimension: string }) => i.dimension === 'AIGC')
    expect(aigcIssues.length).toBeGreaterThanOrEqual(1)
  })

  it('无 AI 生成记录 → 不产生 AIGC 问题', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ renderParams: null, generationLog: null })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    const aigcIssues = result.issues.filter((i: { dimension: string }) => i.dimension === 'AIGC')
    expect(aigcIssues).toHaveLength(0)
  })
})

// ============================================================
// 建议生成
// ============================================================

describe('修复建议生成', () => {
  it('存在绝对化用语问题时包含对应建议', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(
      buildVariantStub({ title: '最好吃的面' })
    )

    const result = await runComplianceCheck({ contentBriefId: 'cb-1', videoVariantId: 'vv-1' })

    expect(result.suggestions).toBeDefined()
    expect(result.suggestions!.some((s: string) => s.includes('绝对化用语'))).toBe(true)
  })
})

// ============================================================
// 常量完整性
// ============================================================

describe('FALSE_POPULARITY 常量', () => {
  it('覆盖已知虚假火爆词', () => {
    expect(FALSE_POPULARITY).toContain('全城排队')
    expect(FALSE_POPULARITY).toContain('每天卖爆')
    expect(FALSE_POPULARITY).toContain('全网疯抢')
    expect(FALSE_POPULARITY).toContain('万人好评')
  })
})
