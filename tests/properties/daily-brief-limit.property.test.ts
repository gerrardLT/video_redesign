// Feature: local-life-depth-enhancements, Property 20: 单日 brief 数量上界
//
// 属性：对任意 改期/新增 操作序列，任意一天的 brief 数量 SHALL NOT 超过单日上界
//   （默认 3，或 StoreProfile.weeklyCadence 对应日的 count 配置值）；超过上界的操作
//   SHALL 被显式拒绝（抛错）且该天的 brief 集合保持不变。
//
// 被测：src/lib/content-calendar-service.ts 的 addContentBrief / editContentBrief(RESCHEDULE)。
// 隔离手法：对 @/lib/db 做内存桩（store/storeProfile/playbook/contentBrief/$transaction），
//   其中 contentBrief.count 在事务内读取共享内存计数，模拟 assertDayCapacity 的行级约束；
//   instantiatePlaybookWithProvenance 走桩隔离 LLM 外部调用。addContentBrief 显式传入
//   playbookId，使其走 loadPlaybookById（playbook.findUnique）而非真实 selectPlaybooks。
//
// **Validates: Requirements 6.2**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { ContentGoal } from '@/types/merchant'

// ============================================================
// 内存桩状态（每次迭代由 reset() 重置）
// ============================================================
const h = vi.hoisted(() => {
  interface BriefRow {
    id: string
    storeId: string
    scheduledDate: Date
  }
  const state: {
    store: Record<string, unknown> | null
    profile: Record<string, unknown> | null
    playbook: Record<string, unknown> | null
    briefs: BriefRow[]
    seq: number
  } = { store: null, profile: null, playbook: null, briefs: [], seq: 0 }
  return { state }
})

// ============================================================
// prisma 内存桩
// ============================================================
vi.mock('@/lib/db', () => {
  const { state } = h

  // 与服务内 utcDayStart 一致：按自然日 UTC 零点归一化
  const dayStart = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

  const prisma = {
    store: {
      findUnique: vi.fn(async (args: { where: { id: string }; include?: unknown; select?: unknown }) => {
        if (!state.store || state.store.id !== args.where.id) return null
        if (args.select) {
          return {
            canShootKitchen: state.store.canShootKitchen,
            canShootStaff: state.store.canShootStaff,
            canShootCustomers: state.store.canShootCustomers,
          }
        }
        return { ...state.store, profile: state.profile, offers: [] }
      }),
    },
    storeProfile: {
      // editContentBrief(RESCHEDULE) 只取 weeklyCadence
      findUnique: vi.fn(async (args: { where: { storeId: string }; select?: unknown }) => {
        if (!state.profile || state.profile.storeId !== args.where.storeId) return null
        return { weeklyCadence: state.profile.weeklyCadence }
      }),
    },
    playbook: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (!state.playbook || state.playbook.id !== args.where.id) return null
        return state.playbook
      }),
    },
    contentBrief: {
      findUnique: vi.fn(async (args: { where: { id: string }; select?: unknown }) => {
        const row = state.briefs.find((b) => b.id === args.where.id)
        if (!row) return null
        return { id: row.id, storeId: row.storeId, scheduledDate: row.scheduledDate, offerId: null }
      }),
      // assertDayCapacity: count({ storeId, scheduledDate:{gte,lt}, id?:{not} })
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where
        const range = where.scheduledDate as { gte: Date; lt: Date }
        const exclude = where.id as { not: string } | undefined
        return state.briefs.filter((b) => {
          if (b.storeId !== where.storeId) return false
          const t = b.scheduledDate.getTime()
          if (!(t >= range.gte.getTime() && t < range.lt.getTime())) return false
          if (exclude && b.id === exclude.not) return false
          return true
        }).length
      }),
      create: vi.fn(async (args: { data: Record<string, unknown>; include?: unknown }) => {
        const data = args.data
        const id = `brief-${++state.seq}`
        state.briefs.push({
          id,
          storeId: data.storeId as string,
          scheduledDate: data.scheduledDate as Date,
        })
        const shotTasksSpec = data.shotTasks as { create?: Record<string, unknown>[] } | undefined
        const shotTasks = (shotTasksSpec?.create ?? []).map((st, i) => ({ id: `shot-${i + 1}`, ...st }))
        const { shotTasks: _omit, ...scalar } = data
        return { id, ...scalar, shotTasks }
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown>; include?: unknown }) => {
        const row = state.briefs.find((b) => b.id === args.where.id)
        if (!row) throw new Error('brief 不存在')
        if (args.data.scheduledDate) row.scheduledDate = args.data.scheduledDate as Date
        return { id: row.id, storeId: row.storeId, scheduledDate: row.scheduledDate, shotTasks: [] }
      }),
    },
    rawAsset: { count: vi.fn(async () => 0) },
    shotTask: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // 事务复用同一 stub，使 count/create 共享内存状态（模拟行级约束）
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    __dayStart: dayStart,
  }
  return { prisma }
})

// instantiatePlaybookWithProvenance 走桩：隔离 LLM，返回确定性 draft + provenance
vi.mock('@/lib/playbook-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/playbook-engine')>()
  return {
    ...actual,
    instantiatePlaybookWithProvenance: vi.fn(async () => ({
      draft: {
        title: '测试内容',
        goal: 'TRAFFIC',
        hook: '钩子',
        mainMessage: '正文',
        suggestedTitle: '标题',
        suggestedCoverTitle: '封面',
        suggestedCaption: '文案',
        suggestedCta: '到店',
        platformCopies: {},
        tags: ['本地生活'],
        aiReasoning: '理由',
        shotTasks: [
          { order: 1, type: 'PRODUCT_CLOSEUP', title: '拍特写', instruction: '靠近产品', durationSec: 5, required: true },
        ],
      },
      provenance: { references: [], isGenericTemplate: true },
    })),
  }
})

const { addContentBrief, editContentBrief } = await import('@/lib/content-calendar-service')

// ============================================================
// 测试夹具
// ============================================================
const STORE_ID = 'store-1'
const GOAL: ContentGoal = 'TRAFFIC'
const PLAYBOOK_ID = 'pb-traffic'
// 固定目标日：2026-01-07 为周三（UTC），ISO 星期 = 3
const TARGET_DATE = new Date(Date.UTC(2026, 0, 7))
const TARGET_ISO_DAY = 3

/** 重置内存库，并将目标日单日上界配置为 bound（通过 weeklyCadence 覆盖） */
function reset(bound: number) {
  const { state } = h
  state.briefs = []
  state.seq = 0
  state.store = {
    id: STORE_ID,
    name: '测试小馆',
    industry: 'RESTAURANT',
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
    // 单日上界覆盖：仅对周三（ISO 3）配置 bound
    weeklyCadence: [{ day: TARGET_ISO_DAY, count: bound }],
  }
  state.playbook = {
    id: PLAYBOOK_ID,
    industry: 'RESTAURANT',
    name: '引流剧本',
    goal: GOAL,
    description: null,
    structure: [],
    requiredShots: ['PRODUCT_CLOSEUP'],
    optionalShots: null,
    hookTemplates: ['钩子'],
    captionTemplates: ['文案'],
    coverTitleTemplates: ['封面'],
    ctaTemplates: ['到店'],
    complianceRules: null,
    scoreWeight: { views: 50, conversion: 40 },
    tierRequired: 'FREE',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

function dayCount(): number {
  const start = (h as unknown as { state: { briefs: { scheduledDate: Date }[] } }).state.briefs
  return start.filter((b) => {
    const d = b.scheduledDate
    return (
      d.getUTCFullYear() === 2026 && d.getUTCMonth() === 0 && d.getUTCDate() === 7
    )
  }).length
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 20: 单日 brief 数量上界
// ============================================================
describe('Property 20: 单日 brief 数量上界', () => {
  it('连续新增到同一天：成功数恰为 min(尝试数, 上界)，超出显式拒绝且不超过上界', async () => {
    /** **Validates: Requirements 6.2** */
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }), // 单日上界（weeklyCadence 覆盖）
        fc.integer({ min: 0, max: 8 }), // 新增尝试次数
        async (bound, attempts) => {
          reset(bound)

          let success = 0
          let rejected = 0
          for (let i = 0; i < attempts; i++) {
            try {
              await addContentBrief({ storeId: STORE_ID, date: TARGET_DATE, goal: GOAL, playbookId: PLAYBOOK_ID })
              success++
            } catch {
              rejected++
            }
            // 不变式：任意时刻该天数量都不超过上界
            expect(dayCount()).toBeLessThanOrEqual(bound)
          }

          // 成功数恰为 min(attempts, bound)，其余均被显式拒绝
          expect(success).toBe(Math.min(attempts, bound))
          expect(rejected).toBe(attempts - success)
          expect(dayCount()).toBe(Math.min(attempts, bound))
        }
      ),
      { numRuns: 120 }
    )
  })

  it('改期到已满当天被显式拒绝，且该天 brief 集合保持不变', async () => {
    /** **Validates: Requirements 6.2** */
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (bound) => {
        reset(bound)

        // 先把目标日填满到上界
        for (let i = 0; i < bound; i++) {
          await addContentBrief({ storeId: STORE_ID, date: TARGET_DATE, goal: GOAL, playbookId: PLAYBOOK_ID })
        }
        expect(dayCount()).toBe(bound)

        // 另起一条放在其它日期（同店，目标日上界不变）
        const otherDate = new Date(Date.UTC(2026, 0, 8)) // 周四
        const other = await addContentBrief({
          storeId: STORE_ID,
          date: otherDate,
          goal: GOAL,
          playbookId: PLAYBOOK_ID,
        })

        // 尝试把它改期到已满的目标日 → 显式拒绝
        await expect(
          editContentBrief({ briefId: other.id, op: 'RESCHEDULE', payload: { newDate: TARGET_DATE } })
        ).rejects.toThrow()

        // 目标日集合保持不变（仍为 bound 条）
        expect(dayCount()).toBe(bound)
      }),
      { numRuns: 60 }
    )
  })
})
