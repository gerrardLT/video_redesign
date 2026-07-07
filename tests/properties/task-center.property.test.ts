// Feature: local-life-depth-enhancements, Property 32: 任务中心作用域、真实性与可跳转
//
// 属性测试：对任意门店 storeId 与多店混合数据，getTaskCenter(storeId) 返回的每一项：
//   1) 作用域：briefId（及 variantId）必属于该 store 的真实数据，绝不混入其它门店；
//   2) 状态真实性：status 文案 ∈ {待拍摄, 渲染中, 待导出, 待发布}，且数量与真实状态项严格一致——
//      待拍摄/渲染中/待导出来自 ContentBrief 三种真实状态，待发布来自尚未发布的 PublishQueueItem，
//      不含任何占位/伪造项（多出或凭空生成的项均会被计数断言捕获）；
//   3) 可跳转：actionHref 非空，且指向对应可操作页面——SHOOT→shoot 路由，其余→variants 路由。
//
// 被测：src/lib/task-center-service.ts 的 getTaskCenter。
// 对 @/lib/db 的 prisma 做内存桩——contentBrief.findMany 按 where.storeId + where.status.in 真实过滤，
// publishQueueItem.findMany 按 where.storeId 真实过滤，忠实复现数据库作用域语义；
// 构造多店混合数据（含目标状态/非目标状态的 brief、已发布/未发布的队列项），不依赖真实数据库、无伪造数据。
//
// **Validates: Requirements 9.1, 9.4, 9.5**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ============================================================
// 内存桩状态（vi.hoisted 在所有 import 之前执行，供 mock 工厂引用）
// ============================================================
const h = vi.hoisted(() => {
  interface BriefRow {
    id: string
    storeId: string
    status: string
    scheduledDate: Date
  }
  interface QueueRow {
    id: string
    storeId: string
    contentBriefId: string
    videoVariantId: string
    publishedPlatforms: Array<{ platform: string; publishedAt: string }>
    exportedAt: Date
  }
  const state: { briefs: BriefRow[]; queueItems: QueueRow[] } = {
    briefs: [],
    queueItems: [],
  }
  return { state }
})

// ============================================================
// prisma 内存桩：忠实复现作用域过滤语义
// ============================================================
vi.mock('@/lib/shared/db', () => {
  const { state } = h
  const prisma = {
    contentBrief: {
      findMany: vi.fn(
        async (args: {
          where: { storeId: string; status: { in: string[] } }
          select?: unknown
          orderBy?: unknown
        }) => {
          const { storeId, status } = args.where
          return state.briefs
            .filter((b) => b.storeId === storeId && status.in.includes(b.status))
            .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
            .map((b) => ({ id: b.id, status: b.status }))
        }
      ),
    },
    publishQueueItem: {
      findMany: vi.fn(
        async (args: { where: { storeId: string }; select?: unknown; orderBy?: unknown }) => {
          const { storeId } = args.where
          return state.queueItems
            .filter((q) => q.storeId === storeId)
            .sort((a, b) => a.exportedAt.getTime() - b.exportedAt.getTime())
            .map((q) => ({
              contentBriefId: q.contentBriefId,
              videoVariantId: q.videoVariantId,
              publishedPlatforms: q.publishedPlatforms,
            }))
        }
      ),
    },
  }
  return { prisma }
})

// 动态导入以确保 mock 生效
const { getTaskCenter } = await import('@/lib/merchant/task-center-service')

// ============================================================
// 常量
// ============================================================

// ContentBrief 目标状态（会进入任务中心）与其对应状态文案 / 任务类型
const TARGET_STATUS_MAP: Record<string, { text: string; type: string }> = {
  READY_TO_SHOOT: { text: '待拍摄', type: 'SHOOT' },
  RENDERING: { text: '渲染中', type: 'RENDER' },
  READY_TO_EXPORT: { text: '待导出', type: 'EXPORT' },
}
const TARGET_STATUSES = Object.keys(TARGET_STATUS_MAP)
// 非目标状态：不应进入任务中心（用于验证「不含占位」与真实过滤）
const OTHER_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED', 'FAILED']
const ALL_STATUSES = [...TARGET_STATUSES, ...OTHER_STATUSES]

// 允许的状态文案集合（Property 32）
const ALLOWED_STATUS_TEXT = new Set(['待拍摄', '渲染中', '待导出', '待发布'])

// PublishPlatform 取值（与 src/types/merchant.ts 对齐）
const PLATFORMS = ['DOUYIN', 'KUAISHOU', 'XIAOHONGSHU', 'WECHAT_CHANNELS', 'MANUAL_EXPORT'] as const

// ============================================================
// Arbitraries
// ============================================================

// 单门店的 brief 状态序列（含目标/非目标状态混合）
const briefStatusesArb = fc.array(fc.constantFrom(...ALL_STATUSES), { maxLength: 8 })

// 单门店的队列项序列：每项的已发布平台列表（空数组 = 待发布）
const queueItemsArb = fc.array(
  fc.array(
    fc.record({
      platform: fc.constantFrom(...PLATFORMS),
      publishedAt: fc.constant('2024-01-01T00:00:00Z'),
    }),
    { maxLength: 3 }
  ),
  { maxLength: 6 }
)

// 多店场景：≥2 个门店，每店各自的 brief 状态与队列项
const scenarioArb = fc.array(
  fc.record({ briefStatuses: briefStatusesArb, queueItems: queueItemsArb }),
  { minLength: 2, maxLength: 4 }
)

// ============================================================
// 工具：按场景重置内存数据库，返回每个门店的元信息（id 与归属 id 集合）
// ============================================================
interface StoreMeta {
  storeId: string
  ownBriefIds: Set<string>
  ownQueueBriefIds: Set<string>
  ownVariantIds: Set<string>
  // 真实统计（用于「数量与真实状态一致」断言）
  shootCount: number
  renderCount: number
  exportCount: number
  publishCount: number
}

function seed(scenario: Array<{ briefStatuses: string[]; queueItems: Array<Array<unknown>> }>): StoreMeta[] {
  const { state } = h
  state.briefs = []
  state.queueItems = []
  const metas: StoreMeta[] = []

  scenario.forEach((store, si) => {
    const storeId = `store-${si}`
    const ownBriefIds = new Set<string>()
    const ownQueueBriefIds = new Set<string>()
    const ownVariantIds = new Set<string>()
    let shootCount = 0
    let renderCount = 0
    let exportCount = 0

    store.briefStatuses.forEach((status, bi) => {
      const id = `brief-${si}-${bi}`
      ownBriefIds.add(id)
      state.briefs.push({
        id,
        storeId,
        status,
        scheduledDate: new Date(2026, 0, 1 + bi),
      })
      if (status === 'READY_TO_SHOOT') shootCount++
      else if (status === 'RENDERING') renderCount++
      else if (status === 'READY_TO_EXPORT') exportCount++
    })

    let publishCount = 0
    store.queueItems.forEach((published, qi) => {
      const contentBriefId = `qbrief-${si}-${qi}`
      const videoVariantId = `variant-${si}-${qi}`
      ownQueueBriefIds.add(contentBriefId)
      ownVariantIds.add(videoVariantId)
      state.queueItems.push({
        id: `queue-${si}-${qi}`,
        storeId,
        contentBriefId,
        videoVariantId,
        publishedPlatforms: published as Array<{ platform: string; publishedAt: string }>,
        exportedAt: new Date(2026, 1, 1 + qi),
      })
      if ((published as unknown[]).length === 0) publishCount++
    })

    metas.push({
      storeId,
      ownBriefIds,
      ownQueueBriefIds,
      ownVariantIds,
      shootCount,
      renderCount,
      exportCount,
      publishCount,
    })
  })

  return metas
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 32: 任务中心作用域、真实性与可跳转
// ============================================================

describe('Property 32: 任务中心作用域、真实性与可跳转', () => {
  it('每项属于该 store、状态文案合法、actionHref 非空且指向 shoot/variants，数量与真实状态项一致（无占位）', async () => {
    /**
     * **Validates: Requirements 9.1, 9.4, 9.5**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const metas = seed(scenario)

        // 对每个门店独立查询，验证作用域隔离（不混入其它门店数据）
        for (const meta of metas) {
          const items = await getTaskCenter({ storeId: meta.storeId })

          // ── 断言 1：数量与真实状态项严格一致（无占位/伪造、无遗漏）──
          const expectedTotal =
            meta.shootCount + meta.renderCount + meta.exportCount + meta.publishCount
          expect(items.length).toBe(expectedTotal)

          // 按类型计数，逐类与真实状态计数对齐（真实性的强校验）
          const byType = { SHOOT: 0, RENDER: 0, EXPORT: 0, PUBLISH: 0 }

          for (const item of items) {
            // ── 断言 2：状态文案 ∈ 允许集合（待拍摄/渲染中/待导出/待发布）──
            expect(ALLOWED_STATUS_TEXT.has(item.status)).toBe(true)

            // ── 断言 3：actionHref 非空 ──
            expect(typeof item.actionHref).toBe('string')
            expect(item.actionHref.length).toBeGreaterThan(0)
            // href 必含当前查询门店 id（不指向其它门店）
            expect(item.actionHref).toContain(`/merchant/stores/${meta.storeId}/`)

            if (item.type === 'PUBLISH') {
              byType.PUBLISH++
              // ── 作用域：待发布项的 briefId/variantId 属于该 store 的队列数据 ──
              expect(meta.ownQueueBriefIds.has(item.briefId)).toBe(true)
              expect(item.variantId).toBeDefined()
              expect(meta.ownVariantIds.has(item.variantId as string)).toBe(true)
              // 文案与可跳转：待发布 → variants 路由
              expect(item.status).toBe('待发布')
              expect(item.actionHref).toBe(
                `/merchant/stores/${meta.storeId}/briefs/${item.briefId}/variants`
              )
            } else {
              // SHOOT / RENDER / EXPORT 来自 ContentBrief 真实状态
              byType[item.type as 'SHOOT' | 'RENDER' | 'EXPORT']++
              // ── 作用域：briefId 属于该 store 的 brief 集合 ──
              expect(meta.ownBriefIds.has(item.briefId)).toBe(true)
              if (item.type === 'SHOOT') {
                // 可跳转：待拍摄 → shoot 路由
                expect(item.status).toBe('待拍摄')
                expect(item.actionHref).toBe(
                  `/merchant/stores/${meta.storeId}/briefs/${item.briefId}/shoot`
                )
              } else {
                // 渲染中/待导出 → variants 路由
                expect(item.status).toBe(item.type === 'RENDER' ? '渲染中' : '待导出')
                expect(item.actionHref).toBe(
                  `/merchant/stores/${meta.storeId}/briefs/${item.briefId}/variants`
                )
              }
            }
          }

          // ── 断言 4：逐类数量 = 真实状态计数（仅来自真实状态，不含占位）──
          expect(byType.SHOOT).toBe(meta.shootCount)
          expect(byType.RENDER).toBe(meta.renderCount)
          expect(byType.EXPORT).toBe(meta.exportCount)
          expect(byType.PUBLISH).toBe(meta.publishCount)
        }
      }),
      { numRuns: 200 }
    )
  })
})
