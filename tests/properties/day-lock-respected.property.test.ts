// Feature: local-life-depth-enhancements, Property 23: 锁定/跳过被尊重
//
// 属性：对任意被标记为 LOCKED 或 SKIPPED 的日期集合，下一轮自动计划生成
//   （generateContentPlan）SHALL NOT 在这些日期创建/覆盖/改写任何 brief，
//   且 SHALL NOT 在 SKIPPED 天填充内容；NORMAL（未标记）日期照常各生成一条。
//
// 被测：src/lib/content-calendar-service.ts 的 generateContentPlan（尊重 CalendarDayState）。
// 隔离手法：
//   - 对 @/lib/playbook-engine 桩接 selectPlaybooks（每天返回一个固定剧本）与
//     instantiatePlaybookWithProvenance（返回确定性 draft + provenance），隔离 LLM 与剧本选择查询；
//   - 对 @/lib/db 做内存桩：store/planGenerationInput/contentBrief.findMany/calendarDayState/
//     contentPlan/contentBrief.create/$transaction，其中 calendarDayState.findMany 返回本次
//     随机生成的锁定/跳过状态，contentBrief.create 记录被实际创建的 brief 日期。
//
// **Validates: Requirements 6.5, 6.7**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ============================================================
// 内存桩状态（每次迭代由 reset() 重置）
// ============================================================
const h = vi.hoisted(() => {
  const state: {
    /** 计划区间内每天的状态：'LOCKED' | 'SKIPPED' | 'NORMAL'，下标 = 距 startDate 的天数 */
    dayStateByOffset: ('LOCKED' | 'SKIPPED' | 'NORMAL')[]
    /** startDate 的 UTC 零点毫秒（用于把 calendarDayState 行映射回 offset） */
    startMs: number
    /** 被实际创建的 brief 的排期日（UTC 零点毫秒） */
    createdDayMs: number[]
    seq: number
  } = { dayStateByOffset: [], startMs: 0, createdDayMs: [], seq: 0 }
  return { state }
})

/** UTC 自然日零点归一化（与服务内 utcDayStart 口径一致） */
function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// ============================================================
// playbook-engine 桩：隔离剧本选择与 LLM 实例化
// ============================================================
vi.mock('@/lib/merchant/playbook-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/merchant/playbook-engine')>()
  const fakePlaybook = {
    id: 'pb-1',
    industry: 'RESTAURANT',
    name: '引流剧本',
    goal: 'TRAFFIC',
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
  return {
    ...actual,
    // 每天都返回一个可用剧本，使「未锁定/未跳过」天必然能生成（从而锁定/跳过天若有 brief 必属违例）
    selectPlaybooks: vi.fn(async (input: { days: number }) =>
      Array.from({ length: input.days }, () => fakePlaybook)
    ),
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

// ============================================================
// prisma 内存桩
// ============================================================
vi.mock('@/lib/shared/db', () => {
  const { state } = h
  const prisma = {
    store: {
      findUnique: vi.fn(async (args: { where: { id: string }; include?: unknown; select?: unknown }) => {
        const store = {
          id: 'store-1',
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
        if (args.where.id !== store.id) return null
        if (args.select) {
          return {
            canShootKitchen: store.canShootKitchen,
            canShootStaff: store.canShootStaff,
            canShootCustomers: store.canShootCustomers,
          }
        }
        const profile = {
          id: 'profile-1',
          storeId: 'store-1',
          contentPositioning: '街坊熟客小馆',
          recommendedPersona: '热情老板',
          hookKeywords: ['现熬8小时骨汤'],
          forbiddenClaims: [],
          preferredCta: ['到店体验'],
          contentDos: [],
          contentDonts: [],
          weeklyCadence: null,
        }
        return { ...store, profile, offers: [] }
      }),
    },
    // performance-learning 与 selectPlaybooks 的 recent 查询：一律返回空，走默认策略
    contentBrief: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args: { data: Record<string, unknown>; include?: unknown }) => {
        const data = args.data
        const id = `brief-${++state.seq}`
        const scheduled = data.scheduledDate as Date
        state.createdDayMs.push(utcDayStart(scheduled).getTime())
        const { shotTasks: _omit, ...scalar } = data
        return { id, ...scalar, shotTasks: [] }
      }),
    },
    // 无未消费的复盘反哺输入
    planGenerationInput: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    // 返回本次随机生成的锁定/跳过状态（仅在区间内的天）
    calendarDayState: {
      findMany: vi.fn(async () => {
        return state.dayStateByOffset
          .map((s, offset) => ({
            storeId: 'store-1',
            date: new Date(state.startMs + offset * 86_400_000),
            state: s,
          }))
          .filter((r) => r.state === 'LOCKED' || r.state === 'SKIPPED')
      }),
    },
    contentPlan: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'plan-1',
        ...args.data,
      })),
    },
    // 事务复用同一 stub，使 create 共享内存状态
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  }
  return { prisma }
})

const { generateContentPlan } = await import('@/lib/merchant/content-calendar-service')

// 固定起始日：2026-01-05（周一，UTC），便于稳定推导每天偏移
const START_DATE = new Date(Date.UTC(2026, 0, 5))

function reset(states: ('LOCKED' | 'SKIPPED' | 'NORMAL')[]) {
  const { state } = h
  state.dayStateByOffset = states
  state.startMs = utcDayStart(START_DATE).getTime()
  state.createdDayMs = []
  state.seq = 0
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 23: 锁定/跳过被尊重
// ============================================================
describe('Property 23: 锁定/跳过被尊重', () => {
  it('自动生成不在 LOCKED/SKIPPED 天创建内容，且 NORMAL 天各生成恰一条', async () => {
    /** **Validates: Requirements 6.5, 6.7** */
    await fc.assert(
      fc.asyncProperty(
        // 为每一天随机分配状态（1~7 天）
        fc.array(fc.constantFrom('LOCKED', 'SKIPPED', 'NORMAL'), { minLength: 1, maxLength: 7 }),
        async (states) => {
          reset(states as ('LOCKED' | 'SKIPPED' | 'NORMAL')[])
          const days = states.length

          await generateContentPlan({ storeId: 'store-1', startDate: START_DATE, days })

          const { state } = h
          const blockedOffsets = new Set(
            states.map((s, i) => (s === 'LOCKED' || s === 'SKIPPED' ? i : -1)).filter((i) => i >= 0)
          )
          // 被实际创建内容的天偏移集合
          const createdOffsets = new Set(
            state.createdDayMs.map((ms) => Math.round((ms - state.startMs) / 86_400_000))
          )

          // 不变式 1：锁定/跳过天绝不被创建内容（不覆盖、不填充）
          for (const off of blockedOffsets) {
            expect(createdOffsets.has(off)).toBe(false)
          }
          // 不变式 2：每个 NORMAL 天恰生成一条（NORMAL 天数 == 创建条数 == 创建天数）
          const normalCount = states.filter((s) => s === 'NORMAL').length
          expect(state.createdDayMs.length).toBe(normalCount)
          expect(createdOffsets.size).toBe(normalCount)
        }
      ),
      { numRuns: 120 }
    )
  })

  it('全部 LOCKED/SKIPPED 时不生成任何 brief（允许整段空缺，不伪造补位）', async () => {
    /** **Validates: Requirements 6.5, 6.7** */
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('LOCKED', 'SKIPPED'), { minLength: 1, maxLength: 7 }),
        async (states) => {
          reset(states as ('LOCKED' | 'SKIPPED')[])
          await generateContentPlan({ storeId: 'store-1', startDate: START_DATE, days: states.length })
          expect(h.state.createdDayMs.length).toBe(0)
        }
      ),
      { numRuns: 60 }
    )
  })
})
