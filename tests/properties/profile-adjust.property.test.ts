// Feature: local-life-depth-enhancements, Property 18: 画像调整仅对后续生效且不回溯
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 18: 画像调整仅对后续生效且不回溯
 *
 * 对任意画像调整 adjustStoreProfile（剔除钩子词 / 修改卖点 / 修改人设 / 修改 CTA）：
 *   1) 调整只更新「当前」画像（StoreProfile）与门店卖点（Store），被剔除的钩子词不再
 *      出现于调整后的画像；
 *   2) 调整后新发起的实例化（instantiatePlaybookWithProvenance）采用调整后的画像，
 *      被剔除的钩子词不再出现于新 provenance；
 *   3) 既有 brief 的 provenance 快照在调整前后保持不变 —— adjustStoreProfile 全程不
 *      读取、不写入任何 ContentBrief 行（既有快照天然不被触碰）。
 *
 * **Validates: Requirements 5.3, 5.4**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——用内存状态模拟 Store / StoreProfile 行的读写，
 * 并对 ContentBrief 行布设「调用探针」（任意方法被调用即记录），从而真实验证「调整只触碰
 * 当前画像、绝不触碰既有 brief 溯源」的不变式。$transaction 透传同一组内存读写方法。
 * 不依赖真实数据库、不发起真实网络（LLM 润色在未配置环境变量时走模板原文，且 fetch 被桩为拒绝）。
 */

// ========================
// Mock Prisma（内存桩：Store / StoreProfile 读写 + ContentBrief 调用探针）
// ========================

const dbState = vi.hoisted(() => ({
  // 当前门店卖点（adjustStoreProfile 的 updateSellingPoints 作用对象）
  storeSellingPoints: [] as string[],
  // 当前画像字段（adjustStoreProfile 的作用对象）
  profile: {
    storeId: 'store_test',
    hookKeywords: [] as string[],
    recommendedPersona: '老板人设' as string | null,
    preferredCta: ['到店品尝'] as string[],
  },
  // 既有 brief 的 provenance 快照（绝不应被调整流程触碰）
  briefProvenance: null as unknown,
  // ContentBrief 任意方法被调用的次数（必须恒为 0）
  briefTouchCount: 0,
}))

vi.mock('@/lib/db', () => {
  const store = {
    findUnique: vi.fn(async () => ({
      id: dbState.profile.storeId,
      mainSellingPoints: dbState.storeSellingPoints,
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ('mainSellingPoints' in data) {
        dbState.storeSellingPoints = data.mainSellingPoints as string[]
      }
      return { id: dbState.profile.storeId, ...data }
    }),
  }
  const storeProfile = {
    findUnique: vi.fn(async () => ({ ...dbState.profile })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ('hookKeywords' in data) dbState.profile.hookKeywords = data.hookKeywords as string[]
      if ('recommendedPersona' in data) {
        dbState.profile.recommendedPersona = data.recommendedPersona as string
      }
      if ('preferredCta' in data) dbState.profile.preferredCta = data.preferredCta as string[]
      return { ...dbState.profile }
    }),
  }
  // ContentBrief 调用探针：任意方法被调用都视为「触碰了既有 brief」，记入 briefTouchCount
  const briefProbe = new Proxy(
    {},
    {
      get() {
        return vi.fn(async () => {
          dbState.briefTouchCount++
          return null
        })
      },
    }
  )
  return {
    prisma: {
      store,
      storeProfile,
      contentBrief: briefProbe,
      // $transaction 透传同一组内存读写方法（callback 形式）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) =>
        fn({ store, storeProfile, contentBrief: briefProbe })
      ),
    },
  }
})

// 避免实例化时 LLM 润色发起真实网络（未配置环境变量时本就走模板原文，此处再加一层保险）
vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    throw new Error('禁止在测试中发起真实网络')
  })
)

// 动态导入以确保 mock 生效
const { adjustStoreProfile } = await import('@/lib/store-profile-service')
const { instantiatePlaybookWithProvenance } = await import('@/lib/playbook-engine')
import type { Playbook, Store, StoreProfile, BriefProvenance } from '@/lib/playbook-engine'

// ========================
// 固定门店/剧本脚手架（与钩子词无关的字段固定，确保不与钩子词标签冲突）
// ========================

const FIXED_STORE: Store = {
  id: 'store_test',
  name: '测试门店XYZ',
  industry: 'CAFE',
  city: '杭州',
  district: '西湖',
  businessArea: '文三路',
  address: '某街1号',
  mainProducts: ['手冲咖啡A'],
  mainSellingPoints: ['现磨豆子'],
  canShootKitchen: false,
  canShootStaff: true,
  canShootCustomers: false,
}

function makeProfile(hookKeywords: string[]): StoreProfile {
  return {
    id: 'profile_test',
    storeId: 'store_test',
    contentPositioning: '第三空间生活方式',
    recommendedPersona: '老板人设',
    hookKeywords,
    forbiddenClaims: ['纯天然'],
    preferredCta: ['到店品尝'],
    contentDos: ['拍摄竖屏视频(9:16)'],
    contentDonts: ['不要使用横屏拍摄'],
  }
}

const PLAYBOOK: Playbook = {
  id: 'pb_test',
  industry: 'CAFE',
  name: '招牌种草',
  goal: 'TRAFFIC',
  description: null,
  structure: [{ name: '产品特写', purpose: '展示卖点', durationSec: 5 }],
  requiredShots: ['PRODUCT_CLOSEUP'],
  optionalShots: [],
  hookTemplates: ['来{storeName}尝尝{productName}'],
  captionTemplates: ['{location}的{sellingPoint}，{cta}'],
  coverTitleTemplates: ['{productName}'],
  ctaTemplates: ['{cta}'],
  complianceRules: null,
  scoreWeight: { views: 1, conversion: 1 },
  tierRequired: 'FREE',
  isActive: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

/** 取 provenance 中所有钩子词引用的实际值集合 */
function hookKeywordRefs(prov: BriefProvenance): string[] {
  return prov.references.filter((r) => r.field === 'hookKeyword').map((r) => r.value)
}

// ========================
// Arbitraries
// ========================

// 钩子词：使用专属前缀，确保不与固定门店标签（门店名/城市/区/产品）冲突
const hookKwArb = fc.integer({ min: 0, max: 9999 }).map((n) => `钩子词_${n}`)
const hookKeywordsArb = fc.uniqueArray(hookKwArb, { minLength: 1, maxLength: 6 })

// 卖点替换补丁
const sellingPointArb = fc.integer({ min: 0, max: 9999 }).map((n) => `卖点_${n}`)

// ========================
// Part A：调整只更新当前画像，且绝不触碰既有 brief 溯源
// ========================

describe('Property 18: 画像调整仅对后续生效且不回溯', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adjustStoreProfile 仅更新当前画像/卖点，被剔除钩子词消失，且全程不触碰 ContentBrief', async () => {
    /**
     * **Validates: Requirements 5.3, 5.4**
     */
    await fc.assert(
      fc.asyncProperty(
        hookKeywordsArb,
        fc.uniqueArray(sellingPointArb, { minLength: 1, maxLength: 4 }),
        fc.string({ maxLength: 12 }),
        fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }),
        async (hookKeywords, sellingPoints, newPersona, newCta) => {
          // ---- 重置内存状态（含既有 brief 的 provenance 快照）----
          const existingProvenance = {
            references: [
              { field: 'hookKeyword', value: hookKeywords[0], usedIn: 'caption', plainText: 'x' },
            ],
            isGenericTemplate: false,
          }
          dbState.storeSellingPoints = [...sellingPoints]
          dbState.profile = {
            storeId: 'store_test',
            hookKeywords: [...hookKeywords],
            recommendedPersona: '老板人设',
            preferredCta: ['到店品尝'],
          }
          dbState.briefProvenance = JSON.parse(JSON.stringify(existingProvenance))
          const snapshotBefore = JSON.parse(JSON.stringify(dbState.briefProvenance))
          dbState.briefTouchCount = 0

          // 剔除首个钩子词；替换首个卖点；改人设；改 CTA
          const removed = hookKeywords[0]
          const fromPoint = sellingPoints[0]
          const toPoint = '卖点_已替换'

          const updated = await adjustStoreProfile({
            storeId: 'store_test',
            patch: {
              removeHookKeywords: [removed],
              updateSellingPoints: [{ from: fromPoint, to: toPoint }],
              updatePersona: newPersona,
              updateCta: newCta,
            },
          })

          // 1) 被剔除钩子词不再出现于调整后的画像；其余钩子词保留
          expect(updated.hookKeywords).not.toContain(removed)
          for (const kw of hookKeywords.slice(1)) {
            expect(updated.hookKeywords).toContain(kw)
          }

          // 2) 卖点 from→to 替换生效，未命中卖点保持不变
          expect(dbState.storeSellingPoints).toContain(toPoint)
          expect(dbState.storeSellingPoints).not.toContain(fromPoint)
          for (const p of sellingPoints.slice(1)) {
            if (p !== fromPoint) expect(dbState.storeSellingPoints).toContain(p)
          }

          // 3) 人设/CTA 覆盖生效
          expect(updated.recommendedPersona).toBe(newPersona)
          expect(updated.preferredCta).toStrictEqual(newCta)

          // 4) 不回溯：全程未触碰任何 ContentBrief 行，既有 provenance 快照原样不变
          expect(dbState.briefTouchCount).toBe(0)
          expect(dbState.briefProvenance).toStrictEqual(snapshotBefore)
        }
      ),
      { numRuns: 150 }
    )
  })

  // ========================
  // Part B：调整后新实例化采用调整后画像（被剔除钩子词不再出现于新 provenance）
  // ========================

  it('调整后新实例化不再引用被剔除的钩子词，调整前的既有 provenance 快照保持不变', async () => {
    /**
     * **Validates: Requirements 5.3, 5.4**
     */
    await fc.assert(
      fc.asyncProperty(hookKeywordsArb, async (hookKeywords) => {
        // 选取一个位于前 3 个（必落入标签 → 必被溯源引用）的钩子词作为剔除对象
        const removeIdx = Math.min(hookKeywords.length, 3) - 1
        const removed = hookKeywords[removeIdx]

        // ---- 调整前：用原画像实例化，得到「既有 brief」的 provenance 快照 ----
        const provBefore = (
          await instantiatePlaybookWithProvenance({
            playbook: PLAYBOOK,
            store: FIXED_STORE,
            profile: makeProfile([...hookKeywords]),
            scheduledDate: new Date('2025-01-06T00:00:00Z'),
          })
        ).provenance
        // 前置条件：被剔除钩子词在调整前确实被引用（否则该样例无意义）
        expect(hookKeywordRefs(provBefore)).toContain(removed)
        const provBeforeSnapshot = JSON.parse(JSON.stringify(provBefore))

        // ---- 执行画像调整（经被测 adjustStoreProfile + 内存桩）----
        dbState.storeSellingPoints = [...FIXED_STORE.mainSellingPoints]
        dbState.profile = {
          storeId: 'store_test',
          hookKeywords: [...hookKeywords],
          recommendedPersona: '老板人设',
          preferredCta: ['到店品尝'],
        }
        dbState.briefTouchCount = 0
        const updated = await adjustStoreProfile({
          storeId: 'store_test',
          patch: { removeHookKeywords: [removed] },
        })

        // 调整流程不得触碰既有 brief
        expect(dbState.briefTouchCount).toBe(0)

        // ---- 调整后：用调整后的画像实例化新 brief ----
        const provAfter = (
          await instantiatePlaybookWithProvenance({
            playbook: PLAYBOOK,
            store: FIXED_STORE,
            profile: makeProfile(updated.hookKeywords as string[]),
            scheduledDate: new Date('2025-01-13T00:00:00Z'),
          })
        ).provenance

        // 新实例化采用调整后画像：被剔除钩子词不再出现于新 provenance
        expect(hookKeywordRefs(provAfter)).not.toContain(removed)

        // 不回溯：调整前已生成的既有 provenance 快照保持不变
        expect(provBefore).toStrictEqual(provBeforeSnapshot)
      }),
      { numRuns: 150 }
    )
  })
})
