// Feature: local-life-depth-enhancements, Property 8: 反哺标注可见性（一次性消费）
//
// 属性测试：对任意被某次 content-plan 生成消费的 PlanGenerationInput——
//   1) 生成的计划必须携带包含其 acceptedSummaries 的「已采纳上轮复盘建议」标注；
//   2) 命中消费的所有 ContentBrief 必须回填 planInputId；
//   3) consumedAt 被置位恰一次（不重复消费）：再次生成不再带反哺标注、不再回填，
//      原子条件更新（where consumedAt:null）在并发/重复时仅一方 count===1。
//
// 被测：src/lib/content-calendar-service.ts 的 generateContentPlan 消费逻辑。
// 对 prisma 做内存桩（store/profile/offers/playbook/contentBrief/contentPlan/
// planGenerationInput/calendarDayState/$transaction），其中 planGenerationInput.updateMany
// 以条件 consumedAt:null 模拟数据库行级写锁的原子抢占（一次性消费）。
// instantiatePlaybookWithProvenance 走桩以隔离 LLM 外部调用；selectPlaybooks 保持真实，
// 真实查询 prisma.playbook 内存桩。
//
// **Validates: Requirements 1.7**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { ContentGoal } from '@/types/merchant'

// ============================================================
// 内存桩状态与 hoisted mock 函数（vi.hoisted 在所有 import 之前执行）
// ============================================================
const h = vi.hoisted(() => {
  // PlanGenerationInput 行（被 findFirst 读取、被 updateMany 原子抢占）
  interface PlanInputRow {
    id: string
    storeId: string
    acceptedNextGoals: unknown
    reusePlaybookIds: unknown
    avoidPlaybookIds: unknown
    acceptedSummaries: unknown
    consumedAt: Date | null
    createdAt: Date
  }

  // Playbook 行（供真实 selectPlaybooks 查询）
  interface PlaybookRow {
    id: string
    industry: string
    name: string
    goal: string
    description: string | null
    structure: unknown
    requiredShots: unknown
    optionalShots: unknown
    hookTemplates: string[]
    captionTemplates: string[]
    coverTitleTemplates: string[]
    ctaTemplates: string[]
    complianceRules: unknown
    scoreWeight: { views: number; conversion: number } | null
    tierRequired: string
    isActive: boolean
    createdAt: Date
    updatedAt: Date
  }

  // 可变内存数据库状态（每次迭代由 seed() 重置）
  const state: {
    store: Record<string, unknown> | null
    profile: Record<string, unknown> | null
    offers: Record<string, unknown>[]
    playbooks: PlaybookRow[]
    planInputs: PlanInputRow[]
    // updateMany 抢占记录：每次条件更新返回的 count
    updateManyCounts: number[]
  } = {
    store: null,
    profile: null,
    offers: [],
    playbooks: [],
    planInputs: [],
    updateManyCounts: [],
  }

  return { state }
})

// ============================================================
// prisma 内存桩
// ============================================================
vi.mock('@/lib/shared/db', () => {
  const { state } = h

  const prisma = {
    store: {
      // generateContentPlan: include profile + active offers；selectPlaybooks: select 拍摄能力
      findUnique: vi.fn(async (args: { where: { id: string }; include?: unknown; select?: unknown }) => {
        if (!state.store || state.store.id !== args.where.id) return null
        if (args.select) {
          // selectPlaybooks 仅取拍摄能力字段
          return {
            canShootKitchen: state.store.canShootKitchen,
            canShootStaff: state.store.canShootStaff,
            canShootCustomers: state.store.canShootCustomers,
          }
        }
        // 主流程：返回门店 + 画像 + 已激活优惠
        return {
          ...state.store,
          profile: state.profile,
          offers: state.offers.filter((o) => o.isActive),
        }
      }),
    },

    playbook: {
      // selectPlaybooks: where { industry, isActive: true }
      findMany: vi.fn(async (args: { where: { industry: string; isActive: boolean } }) => {
        return state.playbooks.filter(
          (p) => p.industry === args.where.industry && p.isActive === args.where.isActive
        )
      }),
    },

    contentBrief: {
      // generatePerformanceInsights（metrics 过滤）与 selectPlaybooks（最近 3 条）均无预置 brief → []
      findMany: vi.fn(async () => []),
      // 事务内逐天创建 brief（含 shotTasks 嵌套创建 + include shotTasks）
      create: vi.fn(async (args: { data: Record<string, unknown>; include?: unknown }) => {
        const data = args.data
        const shotTasksSpec = data.shotTasks as { create?: Record<string, unknown>[] } | undefined
        const shotTasks = (shotTasksSpec?.create ?? []).map((st, idx) => ({
          id: `shot-${idx + 1}`,
          ...st,
        }))
        // 移除嵌套写入描述符，回显标量字段 + shotTasks 数组
        const { shotTasks: _omit, ...scalar } = data
        return {
          id: `brief-${Math.random().toString(36).slice(2, 10)}`,
          ...scalar,
          shotTasks,
        }
      }),
    },

    contentPlan: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const data = args.data
        return {
          id: (data.id as string | undefined) ?? `plan-${Math.random().toString(36).slice(2, 10)}`,
          ...data,
        }
      }),
    },

    planGenerationInput: {
      // 读取门店最新一条未消费输入（createdAt 降序）
      findFirst: vi.fn(
        async (args: { where: { storeId: string; consumedAt: null }; orderBy?: unknown }) => {
          const candidates = state.planInputs
            .filter((p) => p.storeId === args.where.storeId && p.consumedAt === null)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          return candidates[0] ?? null
        }
      ),
      // 原子条件更新（模拟数据库行级写锁）：仅当该行 consumedAt 仍为 null 时置位并 count=1，否则 count=0
      updateMany: vi.fn(
        async (args: { where: { id: string; consumedAt: null }; data: { consumedAt: Date } }) => {
          const row = state.planInputs.find((p) => p.id === args.where.id)
          let count = 0
          if (row && row.consumedAt === null) {
            row.consumedAt = args.data.consumedAt
            count = 1
          }
          state.updateManyCounts.push(count)
          return { count }
        }
      ),
    },

    calendarDayState: {
      // 无锁定/跳过
      findMany: vi.fn(async () => []),
    },

    // 事务：注入同一 stub 作为 tx（行状态共享）
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  }

  return { prisma }
})

// ============================================================
// playbook-engine 部分桩：保留真实 selectPlaybooks（查询 prisma.playbook 内存桩），
// 仅替换 instantiatePlaybookWithProvenance 以隔离 LLM 外部调用，返回确定性 draft + provenance。
// ============================================================
vi.mock('@/lib/merchant/playbook-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/merchant/playbook-engine')>()
  return {
    ...actual,
    instantiatePlaybookWithProvenance: vi.fn(
      async (input: { playbook: { name?: string } }) => ({
        draft: {
          title: `测试内容·${input.playbook?.name ?? '剧本'}`,
          goal: 'TRAFFIC',
          hook: '钩子',
          mainMessage: '正文',
          suggestedTitle: '标题',
          suggestedCoverTitle: '封面',
          suggestedCaption: '文案',
          suggestedCta: '到店',
          platformCopies: {},
          tags: ['本地生活'],
          aiReasoning: '测试理由',
          shotTasks: [
            {
              order: 1,
              type: 'PRODUCT_CLOSEUP',
              title: '拍产品特写',
              instruction: '把手机靠近产品',
              durationSec: 5,
              required: true,
            },
          ],
        },
        provenance: { references: [], isGenericTemplate: true },
      })
    ),
  }
})

// 动态导入以确保上述 mock 生效
const { prisma } = await import('@/lib/shared/db')
const { generateContentPlan } = await import('@/lib/merchant/content-calendar-service')

// ============================================================
// 测试夹具
// ============================================================

const STORE_ID = 'store-1'
const INDUSTRY = 'RESTAURANT'

// 七日目标排程涉及的所有 ContentGoal + 兜底目标，确保每天都有可用剧本
const SEED_GOALS: ContentGoal[] = [
  'TRAFFIC',
  'NEW_PRODUCT',
  'TRUST_BUILDING',
  'BRAND_STORY',
  'WEEKEND_BOOST',
  'PROMOTION',
  'REPEAT_PURCHASE',
]

/** 构造一条合法的 playbook 种子（requiredShots 为空 → 始终兼容拍摄能力） */
function makePlaybook(goal: ContentGoal, idx: number) {
  return {
    id: `pb-${goal}-${idx}`,
    industry: INDUSTRY,
    name: `剧本-${goal}`,
    goal,
    description: null,
    structure: [],
    requiredShots: [],
    optionalShots: null,
    hookTemplates: ['钩子模板'],
    captionTemplates: ['文案模板'],
    coverTitleTemplates: ['封面模板'],
    ctaTemplates: ['到店体验'],
    complianceRules: null,
    scoreWeight: { views: 50 + idx, conversion: 40 + idx },
    tierRequired: 'FREE',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

/**
 * 重置内存数据库并写入一条未消费的 PlanGenerationInput。
 * @returns 写入的 PlanGenerationInput.id
 */
function seed(input: {
  summaries: string[]
  nextGoals: ContentGoal[]
  reuseIds: string[]
  avoidIds: string[]
}): string {
  const { state } = h
  state.store = {
    id: STORE_ID,
    name: '测试小馆',
    industry: INDUSTRY,
    city: '杭州',
    district: '西湖区',
    businessArea: '文三路',
    address: '某街1号',
    mainProducts: ['牛肉面'],
    mainSellingPoints: ['现熬骨汤'],
    canShootKitchen: true,
    canShootStaff: true,
    canShootCustomers: true,
  }
  state.profile = {
    id: 'profile-1',
    storeId: STORE_ID,
    contentPositioning: '街坊熟客小馆',
    recommendedPersona: '热情老板',
    hookKeywords: ['现熬8小时骨汤'],
    forbiddenClaims: [],
    preferredCta: ['到店体验'],
    contentDos: [],
    contentDonts: [],
  }
  state.offers = []
  state.playbooks = SEED_GOALS.map((g, i) => makePlaybook(g, i))
  state.updateManyCounts = []

  const pgiId = `pgi-${Math.random().toString(36).slice(2, 10)}`
  state.planInputs = [
    {
      id: pgiId,
      storeId: STORE_ID,
      acceptedNextGoals: input.nextGoals,
      reusePlaybookIds: input.reuseIds,
      avoidPlaybookIds: input.avoidIds,
      acceptedSummaries: input.summaries,
      consumedAt: null,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    },
  ]
  return pgiId
}

// 固定起始日（周一），days 由属性生成
const START_DATE = new Date('2026-01-05T00:00:00Z')

// ============================================================
// Arbitraries
// ============================================================

const summariesArb = fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
  minLength: 1,
  maxLength: 5,
})
const goalsArb = fc.array(fc.constantFrom<ContentGoal>(...SEED_GOALS), { maxLength: 4 })
// 规避/复用名单使用与种子 playbook 不相交的命名空间，避免清空候选导致无剧本
const disjointIdsArb = fc.array(fc.string({ minLength: 1, maxLength: 12 }).map((s) => `ext-${s}`), {
  maxLength: 4,
})
const daysArb = fc.integer({ min: 1, max: 7 })

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 8: 反哺标注可见性（一次性消费）
// ============================================================

describe('Property 8: 反哺标注可见性（一次性消费）', () => {
  it('命中消费的计划携带含 acceptedSummaries 的反哺标注且回填 planInputId；再次生成不重复消费', async () => {
    /**
     * **Validates: Requirements 1.7**
     */
    await fc.assert(
      fc.asyncProperty(
        summariesArb,
        goalsArb,
        disjointIdsArb,
        disjointIdsArb,
        daysArb,
        async (summaries, nextGoals, reuseIds, avoidIds, days) => {
          const pgiId = seed({ summaries, nextGoals, reuseIds, avoidIds })

          // 第一次生成：成功抢占消费权（命中消费）
          const r1 = await generateContentPlan({ storeId: STORE_ID, startDate: START_DATE, days })

          // —— 反哺可见标注：strategy 携带含 acceptedSummaries 的「已采纳上轮复盘建议」 ——
          const s1 = r1.contentPlan.strategy as Record<string, unknown>
          expect(s1.planInputId).toBe(pgiId)
          expect(s1.adoptedSummaries).toStrictEqual(summaries)
          expect(s1.adoptedInsightNote).toBe(`已采纳上轮复盘建议:${summaries.join('；')}`)

          // —— 命中消费的所有 brief 回填 planInputId ——
          expect(r1.briefs.length).toBeGreaterThan(0)
          for (const b of r1.briefs) {
            expect((b as { planInputId: string | null }).planInputId).toBe(pgiId)
          }

          // —— consumedAt 已置位恰一次 ——
          const consumedAfterR1 = h.state.planInputs.find((p) => p.id === pgiId)!.consumedAt
          expect(consumedAfterR1).toBeInstanceOf(Date)

          // 第二次生成：该输入已被消费（consumedAt 非空）→ 不再命中、不带标注、不回填
          const r2 = await generateContentPlan({ storeId: STORE_ID, startDate: START_DATE, days })
          const s2 = r2.contentPlan.strategy as Record<string, unknown>
          expect(s2.planInputId).toBeNull()
          expect(s2.adoptedInsightNote).toBeNull()
          expect(s2.adoptedSummaries).toStrictEqual([])
          for (const b of r2.briefs) {
            expect((b as { planInputId: string | null }).planInputId).toBeNull()
          }

          // —— 一次性消费：consumedAt 在第二次生成后保持不变（未被重复置位）——
          const consumedAfterR2 = h.state.planInputs.find((p) => p.id === pgiId)!.consumedAt
          expect(consumedAfterR2).toBe(consumedAfterR1)

          // —— 原子抢占：整个过程仅发生一次条件更新且 count===1（第二次因已消费不再尝试 updateMany）——
          const successfulClaims = h.state.updateManyCounts.filter((c) => c === 1).length
          expect(successfulClaims).toBe(1)
          expect(h.state.updateManyCounts.filter((c) => c === 0).length).toBe(0)
        }
      ),
      { numRuns: 120 }
    )
  })

  it('并发/重复抢占同一未消费输入时条件更新仅一方 count===1（其余 count===0）', async () => {
    /**
     * 直接对 planGenerationInput.updateMany 以条件 consumedAt:null 连续抢占，
     * 模拟两次并发/重复消费：第一次 count===1（置位），其后均 count===0（已消费）。
     *
     * **Validates: Requirements 1.7**
     */
    await fc.assert(
      fc.asyncProperty(summariesArb, fc.integer({ min: 2, max: 5 }), async (summaries, attempts) => {
        const pgiId = seed({ summaries, nextGoals: [], reuseIds: [], avoidIds: [] })

        const counts: number[] = []
        for (let i = 0; i < attempts; i++) {
          const res = await (
            prisma.planGenerationInput.updateMany as unknown as (a: unknown) => Promise<{ count: number }>
          )({ where: { id: pgiId, consumedAt: null }, data: { consumedAt: new Date() } })
          counts.push(res.count)
        }

        // 恰一次成功置位（count===1），其余均失败（count===0）→ 一次性消费
        expect(counts.filter((c) => c === 1).length).toBe(1)
        expect(counts.filter((c) => c === 0).length).toBe(attempts - 1)
        // 首次抢占即成功
        expect(counts[0]).toBe(1)
      }),
      { numRuns: 120 }
    )
  })
})
