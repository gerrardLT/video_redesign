/**
 * 数据录入服务单元测试
 *
 * 测试范围：
 * - MetricsValidationError / MetricsBusinessError 错误类型
 * - recordManualMetrics 验证逻辑（字段校验、状态前置条件、上限检查）
 *
 * 隔离手法：mock prisma 的 contentBrief.findUnique / publishMetric.create，
 * 测试各业务规则分支。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_METRICS_PER_BRIEF } from '@/constants/merchant'

// ============================================================
// Mock prisma
// ============================================================

vi.mock('@/lib/shared/db', () => {
  const findUniqueMock = vi.fn()
  const createMock = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'metric-1',
    ...args.data,
  }))

  return {
    prisma: {
      contentBrief: { findUnique: findUniqueMock },
      publishMetric: { create: createMock },
    },
    __findUnique: findUniqueMock,
  }
})

// mock performance-learning 避免真实调用
vi.mock('@/lib/merchant/performance-learning-service', () => ({
  generatePerformanceInsights: vi.fn(async () => ({
    recommendedNextGoals: [],
    playbooksToAvoid: [],
  })),
}))

const { recordManualMetrics, MetricsValidationError, MetricsBusinessError } = await import(
  '@/lib/merchant/metrics-ingestor'
)
const dbModule = await import('@/lib/shared/db')
const findUnique = (dbModule as unknown as { __findUnique: ReturnType<typeof vi.fn> }).__findUnique

// ============================================================
// 测试夹具
// ============================================================

/** 合法的最小 metrics 输入 */
const VALID_METRICS = {
  views: 100,
  likes: 10,
  comments: 5,
  shares: 2,
  saves: 3,
  linkClicks: 1,
  messages: 0,
  orders: 0,
  redemptions: 0,
  revenueCents: 0,
}

const VALID_INPUT = {
  contentBriefId: 'cb-1',
  platform: 'DOUYIN' as const,
  metrics: VALID_METRICS,
  userId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// 状态前置条件验证
// ============================================================

describe('状态前置条件验证', () => {
  it('EXPORTED 状态允许录入', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'EXPORTED',
      _count: { metrics: 0 },
    })

    const result = await recordManualMetrics(VALID_INPUT)
    expect(result).toBeDefined()
    expect(result.id).toBe('metric-1')
  })

  it('PUBLISHED 状态允许录入', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'PUBLISHED',
      _count: { metrics: 0 },
    })

    const result = await recordManualMetrics(VALID_INPUT)
    expect(result).toBeDefined()
  })

  it('ARCHIVED 状态允许录入', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'ARCHIVED',
      _count: { metrics: 0 },
    })

    const result = await recordManualMetrics(VALID_INPUT)
    expect(result).toBeDefined()
  })

  it('DRAFT 状态拒绝录入', async () => {
    findUnique.mockResolvedValue({
      id: 'cb-1',
      status: 'DRAFT',
      _count: { metrics: 0 },
    })

    await expect(recordManualMetrics(VALID_INPUT)).rejects.toThrow(MetricsBusinessError)
    await expect(recordManualMetrics(VALID_INPUT)).rejects.toThrow(/仅 EXPORTED/)
  })

  it('RENDERING 状态拒绝录入', async () => {
    findUnique.mockResolvedValue({
      id: 'cb-1',
      status: 'RENDERING',
      _count: { metrics: 0 },
    })

    await expect(recordManualMetrics(VALID_INPUT)).rejects.toThrow(MetricsBusinessError)
  })

  it('ContentBrief 不存在时抛 CONTENT_BRIEF_NOT_FOUND', async () => {
    findUnique.mockResolvedValueOnce(null)

    try {
      await recordManualMetrics(VALID_INPUT)
      expect.fail('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MetricsBusinessError)
      expect((e as InstanceType<typeof MetricsBusinessError>).code).toBe('CONTENT_BRIEF_NOT_FOUND')
    }
  })
})

// ============================================================
// 数据录入上限
// ============================================================

describe('数据录入上限', () => {
  it(`已达 ${MAX_METRICS_PER_BRIEF} 条时拒绝`, async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'EXPORTED',
      _count: { metrics: MAX_METRICS_PER_BRIEF },
    })

    try {
      await recordManualMetrics(VALID_INPUT)
      expect.fail('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MetricsBusinessError)
      expect((e as InstanceType<typeof MetricsBusinessError>).code).toBe('METRICS_LIMIT_EXCEEDED')
    }
  })

  it(`未达上限（${MAX_METRICS_PER_BRIEF - 1} 条）时允许`, async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'EXPORTED',
      _count: { metrics: MAX_METRICS_PER_BRIEF - 1 },
    })

    const result = await recordManualMetrics(VALID_INPUT)
    expect(result).toBeDefined()
  })
})

// ============================================================
// 字段验证
// ============================================================

describe('字段验证', () => {
  it('负数指标被拒绝', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'EXPORTED',
      _count: { metrics: 0 },
    })

    await expect(
      recordManualMetrics({
        ...VALID_INPUT,
        metrics: { ...VALID_METRICS, views: -1 },
      })
    ).rejects.toThrow(MetricsValidationError)
  })

  it('非法平台名被拒绝', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'cb-1',
      status: 'EXPORTED',
      _count: { metrics: 0 },
    })

    await expect(
      recordManualMetrics({
        ...VALID_INPUT,
        platform: 'INVALID' as 'DOUYIN',
      })
    ).rejects.toThrow(MetricsValidationError)
  })
})

// ============================================================
// 错误类型结构
// ============================================================

describe('自定义错误类型', () => {
  it('MetricsValidationError 包含 fieldErrors', () => {
    const error = new MetricsValidationError({
      views: ['必须为非负数'],
      platform: ['不在可选范围内'],
    })
    expect(error.name).toBe('MetricsValidationError')
    expect(error.fieldErrors.views).toContain('必须为非负数')
    expect(error.fieldErrors.platform).toContain('不在可选范围内')
    expect(error.message).toContain('views')
  })

  it('MetricsBusinessError 包含 code', () => {
    const error = new MetricsBusinessError('CONTENT_BRIEF_NOT_FOUND', '不存在')
    expect(error.name).toBe('MetricsBusinessError')
    expect(error.code).toBe('CONTENT_BRIEF_NOT_FOUND')
    expect(error.message).toBe('不存在')
  })
})
