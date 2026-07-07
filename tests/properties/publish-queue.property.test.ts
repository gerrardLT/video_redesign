// Feature: local-life-depth-enhancements, Property 29: 导出与清单一一对应
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 29: 导出与清单一一对应
 *
 * 对任意「成功导出的 VideoVariant 序列」（其中允许对同一 variant 重复 enqueue），
 * publish-queue-service.enqueueForPublish 调用完成后，待发布清单中：
 *  - 每个已导出 variant 恰存在一个 PublishQueueItem（一一对应）；
 *  - 重复 enqueue 同一 variant 不产生重复项（幂等）。
 *
 * **Validates: Requirements 8.1**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——用内存集合（Map/数组）模拟
 * videoVariant.findUnique、contentBrief.findUnique、publishQueueItem.findFirst/create，
 * 真实执行 enqueueForPublish 的校验→幂等检查→创建逻辑。
 * 不依赖真实数据库、无 fallback、无伪造数据。fast-check 运行 ≥100 次迭代，Node 环境。
 */

// ========================
// 内存数据库状态（vi.hoisted 保证 mock 工厂可引用）
// ========================
const db = vi.hoisted(() => ({
  // 既有 variant：id -> { id, contentBriefId }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variants: new Map<string, any>(),
  // 既有 brief：id -> { id, storeId }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  briefs: new Map<string, any>(),
  // 待发布清单（内存集合，模拟 PublishQueueItem 表）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queue: [] as any[],
  seq: 0,
}))

vi.mock('@/lib/shared/db', () => {
  const videoVariant = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: vi.fn(async ({ where }: any) => {
      const v = db.variants.get(where.id)
      // 模拟真实 select：仅返回 id 与 contentBriefId
      return v ? { id: v.id, contentBriefId: v.contentBriefId } : null
    }),
  }
  const contentBrief = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: vi.fn(async ({ where }: any) => {
      const b = db.briefs.get(where.id)
      return b ? { storeId: b.storeId } : null
    }),
  }
  const publishQueueItem = {
    // findFirst：按 videoVariantId 查找既有清单项（幂等检查依据）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findFirst: vi.fn(async ({ where }: any) => {
      const found = db.queue.find((q) => q.videoVariantId === where.videoVariantId)
      return found ? { ...found } : null
    }),
    // upsert：原子幂等入列（源码实际使用 upsert 而非 findFirst + create）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: vi.fn(async ({ where, create }: any) => {
      const existing = db.queue.find((q) => q.videoVariantId === where.videoVariantId)
      if (existing) return { ...existing }
      const row = {
        id: `pq_${db.seq++}`,
        exportedAt: new Date(),
        remindAfterH: 24,
        reminded: false,
        publishedPlatforms: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...create,
      }
      db.queue.push(row)
      return { ...row }
    }),
    // create：追加一条新清单项（兼容旧测试引用）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `pq_${db.seq++}`,
        exportedAt: new Date(),
        remindAfterH: 24,
        reminded: false,
        publishedPlatforms: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      db.queue.push(row)
      return { ...row }
    }),
  }
  return { prisma: { videoVariant, contentBrief, publishQueueItem } }
})

// 动态导入以确保 mock 生效
const { enqueueForPublish } = await import('@/lib/merchant/publish-queue-service')

// ========================
// Arbitraries
// ========================

/**
 * 场景：先确定门店与若干 brief，再为每个 brief 生成若干 variant；
 * 然后生成一个「导出 enqueue 序列」（从已有 variant 中抽取，含重复），断言一一对应。
 */
const scenarioArb = fc
  .record({
    storeId: fc.uuid(),
    briefIds: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 4 }),
  })
  .chain((base) => {
    const briefIdArb = fc.constantFrom(...base.briefIds)
    return fc
      .record({
        base: fc.constant(base),
        // 至少 1 个 variant，每个归属某个 brief
        variants: fc.uniqueArray(
          fc.record({ id: fc.uuid(), contentBriefId: briefIdArb }),
          { minLength: 1, maxLength: 8, selector: (v) => v.id }
        ),
      })
      .chain(({ base: b, variants }) => {
        const variantArb = fc.constantFrom(...variants)
        return fc.record({
          base: fc.constant(b),
          variants: fc.constant(variants),
          // enqueue 序列：从已有 variant 抽取（含重复），保证存在重复 enqueue 的机会
          enqueueSeq: fc.array(variantArb, { minLength: 1, maxLength: 24 }),
        })
      })
  })

// ========================
// Property 29: 导出与清单一一对应
// ========================

describe('Property 29: 导出与清单一一对应', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('每个已导出 variant 在待发布清单中恰存在一个 PublishQueueItem（重复 enqueue 幂等）', async () => {
    /**
     * **Validates: Requirements 8.1**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ base, variants, enqueueSeq }) => {
        // ── 每次迭代重置内存状态 ──
        db.variants = new Map()
        db.briefs = new Map()
        db.queue = []
        db.seq = 0

        // 预置门店下的 brief
        for (const id of base.briefIds) {
          db.briefs.set(id, { id, storeId: base.storeId })
        }
        // 预置已导出 variant
        for (const v of variants) {
          db.variants.set(v.id, { id: v.id, contentBriefId: v.contentBriefId })
        }

        // 依次执行 enqueue（序列含重复 variant，模拟重复导出/重复入列）
        for (const v of enqueueSeq) {
          const item = await enqueueForPublish({
            videoVariantId: v.id,
            contentBriefId: v.contentBriefId,
          })
          // 返回项的归属正确
          expect(item.videoVariantId).toBe(v.id)
          expect(item.contentBriefId).toBe(v.contentBriefId)
          expect(item.storeId).toBe(base.storeId)
        }

        // 本次序列中出现过的不同 variantId 集合
        const enqueuedIds = new Set(enqueueSeq.map((v) => v.id))

        // ── 断言 1：每个被 enqueue 的 variant 在清单中恰有一项 ──
        for (const id of enqueuedIds) {
          const matches = db.queue.filter((q) => q.videoVariantId === id)
          expect(matches.length).toBe(1)
        }

        // ── 断言 2：清单总项数 == 不同 variant 数（无重复项、无遗漏）──
        expect(db.queue.length).toBe(enqueuedIds.size)

        // ── 断言 3：清单中 videoVariantId 全局唯一（幂等不变式）──
        const uniqueInQueue = new Set(db.queue.map((q) => q.videoVariantId))
        expect(uniqueInQueue.size).toBe(db.queue.length)
      }),
      { numRuns: 200 }
    )
  })
})
