// Feature: local-life-depth-enhancements, Property 3: 每条建议必带 evidence
/**
 * 属性测试：表现学习服务「每条建议必带 evidence」（Property 3）
 *
 * **Validates: Requirements 1.2**
 *
 * 不变式：对任意门店历史 metrics 数据集，generatePerformanceInsights 返回的
 * 每一条 suggestion 都必须携带「非空」evidence（可解释），以保证复盘建议
 * 始终可被通俗话术溯源、不出现「无证据的空建议」。
 *
 * 隔离策略：generatePerformanceInsights 仅经 prisma.contentBrief.findMany 读库，
 * 其余为纯规则引擎逻辑。参照既有属性测试约定（src/__tests__/property/
 * playbook-engine.property.test.ts），对 @/lib/db 做内存桩，仅参数化注入
 * 「带 metrics 的 brief 数据集」，从而隔离纯断言逻辑——不 mock 任何关键外部
 * 业务推理，仅以测试夹具替代 DB 读取。fast-check 运行 ≥100 次迭代，Node 环境。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ========================
// Mock Prisma：仅替换 DB 读取，隔离纯规则逻辑
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    contentBrief: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { generatePerformanceInsights } from '@/lib/performance-learning-service'
import type { ContentGoal } from '@/types/merchant'

// ========================
// 生成器：构造门店历史 metrics 数据集
// ========================

/** 有效内容目标枚举（决定 goal 分布，覆盖推荐目标聚合） */
const goalArb = fc.constantFrom(
  'TRAFFIC',
  'PROMOTION',
  'NEW_PRODUCT',
  'TRUST_BUILDING',
  'BRAND_STORY',
  'CUSTOMER_TESTIMONIAL',
  'WEEKEND_BOOST',
  'REPEAT_PURCHASE',
) as fc.Arbitrary<ContentGoal>

/**
 * 单指标计数值：覆盖 0 与较大值，使 TOP 30% / BOTTOM 30% 阈值与
 * 「连续低播放」等规则都可能被触发，从而真正产出各类 suggestion。
 */
const metricCountArb = fc.nat({ max: 100000 })

/** 一条 PublishMetric 的关键计数字段（函数 reduce 仅读取这些字段） */
const metricRecordArb = fc.record({
  views: metricCountArb,
  likes: metricCountArb,
  comments: metricCountArb,
  shares: metricCountArb,
  saves: metricCountArb,
  linkClicks: metricCountArb,
  orders: metricCountArb,
  redemptions: metricCountArb,
})

/**
 * playbookId 取自小规模池（或 null），使「同一 Playbook 连续低播放」规则
 * 有机会被触发（需同一 playbookId 连续出现 ≥3 次）。
 */
const playbookIdArb = fc.option(fc.constantFrom('pb-A', 'pb-B', 'pb-C'), { nil: null })

/** 基准日期，scheduledDate 在其上叠加天偏移，保证可排序 */
const BASE_DATE = new Date('2026-01-01T00:00:00.000Z')

/**
 * 构造一个含 metrics 的 brief（形如 prisma.contentBrief.findMany include:{metrics:true} 的返回项）。
 * dayOffset 决定 scheduledDate，使序列有时间分布。
 */
const briefArb = (index: number) =>
  fc.record({
    playbookId: playbookIdArb,
    goal: goalArb,
    hook: fc.option(fc.string(), { nil: null }),
    dayOffset: fc.nat({ max: 60 }),
    // 每条 brief 含 1-3 条 metrics（多平台/多次录入聚合），保证 metrics: { some: {} } 命中
    metrics: fc.array(metricRecordArb, { minLength: 1, maxLength: 3 }),
  }).map((b) => ({
    id: `brief-${index}`,
    playbookId: b.playbookId,
    goal: b.goal,
    hook: b.hook,
    scheduledDate: new Date(BASE_DATE.getTime() + b.dayOffset * 24 * 60 * 60 * 1000),
    metrics: b.metrics,
  }))

/**
 * 门店历史数据集：≥3 条带 metrics 的 brief（达到解锁门槛，确保规则引擎实际产出建议），
 * 上界 20 控制单次迭代规模。
 */
const briefsArb = fc
  .integer({ min: 3, max: 20 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => briefArb(i))))

// ========================
// 属性测试
// ========================

describe('Property 3: 每条建议必带 evidence (Validates: Requirements 1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generatePerformanceInsights 返回的每条 suggestion 均携带非空 evidence', async () => {
    await fc.assert(
      fc.asyncProperty(briefsArb, async (briefs) => {
        // 注入测试夹具：findMany 返回参数化的门店历史 brief+metrics 数据集
        vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(briefs as never)

        const insights = await generatePerformanceInsights({ storeId: 'store-1' })

        // 不变式：每条建议都必须有非空字符串 evidence（去除首尾空白后仍非空）
        for (const suggestion of insights.suggestions) {
          expect(typeof suggestion.evidence).toBe('string')
          expect(suggestion.evidence.trim().length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('示例：触发多类规则的数据集，所有 suggestion 仍带非空 evidence', async () => {
    // 构造能稳定触发 CTA / structure / hook / offer 多条规则的数据集
    const mkMetric = (over: Partial<Record<string, number>>) => ({
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
      linkClicks: 0, orders: 0, redemptions: 0, ...over,
    })
    const briefs = [
      // 高播放低转化 → CTA 规则
      { id: 'b1', playbookId: 'pb-A', goal: 'TRAFFIC', hook: '钩子1', scheduledDate: new Date('2026-01-01'), metrics: [mkMetric({ views: 10000, linkClicks: 0, orders: 0, redemptions: 0 })] },
      // 高收藏高评论 → structure 规则 + 高链接点击 → offer 规则
      { id: 'b2', playbookId: 'pb-B', goal: 'PROMOTION', hook: '钩子2', scheduledDate: new Date('2026-01-02'), metrics: [mkMetric({ saves: 9999, comments: 9999, linkClicks: 9999 })] },
      // 同一 playbook 连续低播放 → hook 规则
      { id: 'b3', playbookId: 'pb-C', goal: 'NEW_PRODUCT', hook: '钩子3', scheduledDate: new Date('2026-01-03'), metrics: [mkMetric({ views: 1 })] },
      { id: 'b4', playbookId: 'pb-C', goal: 'NEW_PRODUCT', hook: '钩子4', scheduledDate: new Date('2026-01-04'), metrics: [mkMetric({ views: 1 })] },
      { id: 'b5', playbookId: 'pb-C', goal: 'NEW_PRODUCT', hook: '钩子5', scheduledDate: new Date('2026-01-05'), metrics: [mkMetric({ views: 1 })] },
    ]
    vi.mocked(prisma.contentBrief.findMany).mockResolvedValue(briefs as never)

    const insights = await generatePerformanceInsights({ storeId: 'store-1' })

    expect(insights.suggestions.length).toBeGreaterThan(0)
    for (const suggestion of insights.suggestions) {
      expect(suggestion.evidence.trim().length).toBeGreaterThan(0)
    }
  })
})
