// Feature: local-life-depth-enhancements, Property 4: 复盘建议应用保真
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 4: 复盘建议应用保真
 *
 * 对任意商家采纳的建议集合（goals / reusePlaybookIds / avoidPlaybookIds / summaries），
 * performance-learning-service.applyInsights 写入的 PlanGenerationInput
 * 必须与采纳集合逐项一致（无丢失、无新增、无伪造）。
 *
 * **Validates: Requirements 1.3**
 *
 * 测试手段：对 @/lib/db 的 prisma 写入做内存桩，捕获 planGenerationInput.create 的入参，
 * 断言写入 data 与 applyInsights 入参逐项一致；不依赖真实数据库。
 */

// ========================
// Mock Prisma（内存桩，捕获写入参数）
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    store: {
      findUnique: vi.fn(),
    },
    planGenerationInput: {
      create: vi.fn(),
    },
  },
}))

// 动态导入以确保 mock 生效
const { prisma } = await import('@/lib/shared/db')
const { applyInsights } = await import('@/lib/merchant/performance-learning-service')

// 类型收窄：mock 后的 prisma 方法
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storeFindUnique = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const planInputCreate = prisma.planGenerationInput.create as unknown as ReturnType<typeof vi.fn>

// ContentGoal 枚举取值（与 src/types/merchant.ts ContentGoalSchema 对齐）
const CONTENT_GOALS = [
  'TRAFFIC',
  'PROMOTION',
  'NEW_PRODUCT',
  'TRUST_BUILDING',
  'BRAND_STORY',
  'CUSTOMER_TESTIMONIAL',
  'WEEKEND_BOOST',
  'REPEAT_PURCHASE',
] as const

// ========================
// Arbitraries
// ========================

const goalsArb = fc.array(fc.constantFrom(...CONTENT_GOALS), { maxLength: 8 })
const playbookIdsArb = fc.array(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 6 })
const summariesArb = fc.array(fc.string({ minLength: 0, maxLength: 40 }), { maxLength: 6 })

// 采纳建议集合输入生成器：可选字段可能缺省（undefined）
const acceptedInputArb = fc.record({
  storeId: fc.uuid(),
  acceptedNextGoals: fc.option(goalsArb, { nil: undefined }),
  reusePlaybookIds: fc.option(playbookIdsArb, { nil: undefined }),
  avoidPlaybookIds: fc.option(playbookIdsArb, { nil: undefined }),
  acceptedSuggestionSummaries: summariesArb,
})

// ========================
// Property 4: 复盘建议应用保真
// ========================

describe('Property 4: 复盘建议应用保真', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applyInsights 写入的 PlanGenerationInput 与采纳集合逐项一致（无丢失、无新增）', async () => {
    /**
     * **Validates: Requirements 1.3**
     */
    await fc.assert(
      fc.asyncProperty(acceptedInputArb, async (input) => {
        // 每次迭代重置桩，避免跨迭代污染捕获
        storeFindUnique.mockReset()
        planInputCreate.mockReset()

        // 门店存在（applyInsights 会先校验门店）
        storeFindUnique.mockResolvedValue({ id: input.storeId })
        // create 回显写入 data，附带数据库生成字段，模拟真实返回
        planInputCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'pgi_test',
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        }))

        const result = await applyInsights(input)

        // 必须发生且仅发生一次写入
        expect(planInputCreate).toHaveBeenCalledTimes(1)
        const writtenData = planInputCreate.mock.calls[0][0].data as Record<string, unknown>

        // storeId 逐项一致
        expect(writtenData.storeId).toBe(input.storeId)

        // acceptedNextGoals：非空时逐项一致；空/缺省时不写入（undefined），不伪造
        const expectedGoals =
          input.acceptedNextGoals && input.acceptedNextGoals.length > 0 ? input.acceptedNextGoals : undefined
        expect(writtenData.acceptedNextGoals).toStrictEqual(expectedGoals)

        // reusePlaybookIds：同上
        const expectedReuse =
          input.reusePlaybookIds && input.reusePlaybookIds.length > 0 ? input.reusePlaybookIds : undefined
        expect(writtenData.reusePlaybookIds).toStrictEqual(expectedReuse)

        // avoidPlaybookIds：同上
        const expectedAvoid =
          input.avoidPlaybookIds && input.avoidPlaybookIds.length > 0 ? input.avoidPlaybookIds : undefined
        expect(writtenData.avoidPlaybookIds).toStrictEqual(expectedAvoid)

        // acceptedSummaries：必填 Json 列，原样保存（含空数组），逐项一致
        expect(writtenData.acceptedSummaries).toStrictEqual(input.acceptedSuggestionSummaries)

        // 无新增：写入 data 的键集合不得超出已知字段（杜绝伪造额外输入）
        const allowedKeys = new Set([
          'storeId',
          'acceptedNextGoals',
          'reusePlaybookIds',
          'avoidPlaybookIds',
          'acceptedSummaries',
        ])
        for (const key of Object.keys(writtenData)) {
          expect(allowedKeys.has(key)).toBe(true)
        }

        // 返回值回显写入内容，保真往返
        expect(result.storeId).toBe(input.storeId)
        expect(result.acceptedSummaries).toStrictEqual(input.acceptedSuggestionSummaries)
      }),
      { numRuns: 200 }
    )
  })

  it('采纳集合逐项保真：写入值正是采纳项本身（顺序与内容均不变）', async () => {
    /**
     * **Validates: Requirements 1.3**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        goalsArb.filter((g) => g.length > 0),
        playbookIdsArb.filter((p) => p.length > 0),
        playbookIdsArb.filter((p) => p.length > 0),
        summariesArb,
        async (storeId, goals, reuse, avoid, summaries) => {
          storeFindUnique.mockReset()
          planInputCreate.mockReset()
          storeFindUnique.mockResolvedValue({ id: storeId })
          planInputCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'pgi_test',
            consumedAt: null,
            createdAt: new Date(),
            ...data,
          }))

          await applyInsights({
            storeId,
            acceptedNextGoals: goals,
            reusePlaybookIds: reuse,
            avoidPlaybookIds: avoid,
            acceptedSuggestionSummaries: summaries,
          })

          const writtenData = planInputCreate.mock.calls[0][0].data as Record<string, unknown>

          // 逐项一致：长度相同且每一项按序相等（无丢失、无新增、无重排）
          expect((writtenData.acceptedNextGoals as string[]).length).toBe(goals.length)
          ;(writtenData.acceptedNextGoals as string[]).forEach((v, i) => expect(v).toBe(goals[i]))

          expect((writtenData.reusePlaybookIds as string[]).length).toBe(reuse.length)
          ;(writtenData.reusePlaybookIds as string[]).forEach((v, i) => expect(v).toBe(reuse[i]))

          expect((writtenData.avoidPlaybookIds as string[]).length).toBe(avoid.length)
          ;(writtenData.avoidPlaybookIds as string[]).forEach((v, i) => expect(v).toBe(avoid[i]))

          expect((writtenData.acceptedSummaries as string[]).length).toBe(summaries.length)
          ;(writtenData.acceptedSummaries as string[]).forEach((v, i) => expect(v).toBe(summaries[i]))
        }
      ),
      { numRuns: 200 }
    )
  })
})
