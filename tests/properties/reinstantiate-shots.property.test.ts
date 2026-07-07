// Feature: local-life-depth-enhancements, Property 21: 换选题重实例化
//
// 属性：对任意 更换 playbook 的 brief，重实例化后该 brief 的 shotTasks 类型集合
//   SHALL 与新 playbook 的 requiredShots 相符（脚本与文案草稿基于新 playbook 重建）。
//
// 被测：src/lib/content-calendar-service.ts 的 editContentBrief(CHANGE_PLAYBOOK)。
// 隔离手法：对 @/lib/db 做内存桩；instantiatePlaybookWithProvenance 走桩，
//   按入参 playbook.requiredShots 确定性派生 shotTasks（隔离 LLM 润色外部调用），
//   从而验证 editContentBrief 确实把「新 playbook」透传至重实例化并写回其镜头脚本，
//   而非沿用旧 shotTasks。
//
// **Validates: Requirements 6.3**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { ShotTaskType } from '@/types/merchant'

const ALL_SHOT_TYPES: ShotTaskType[] = [
  'STOREFRONT',
  'PRODUCT_CLOSEUP',
  'COOKING_PROCESS',
  'STAFF_ACTION',
  'CUSTOMER_REACTION',
  'OWNER_TALKING',
  'ENVIRONMENT',
  'OFFER_DISPLAY',
  'CTA_SCREEN',
  'AI_GENERATED_FILLER',
]

// ============================================================
// 内存桩状态
// ============================================================
const h = vi.hoisted(() => {
  const state: {
    store: Record<string, unknown> | null
    profile: Record<string, unknown> | null
    brief: Record<string, unknown> | null
    newPlaybook: Record<string, unknown> | null
  } = { store: null, profile: null, brief: null, newPlaybook: null }
  return { state }
})

vi.mock('@/lib/shared/db', () => {
  const { state } = h
  const prisma = {
    store: {
      findUnique: vi.fn(async (args: { where: { id: string }; include?: unknown; select?: unknown }) => {
        if (!state.store || state.store.id !== args.where.id) return null
        return { ...state.store, profile: state.profile, offers: [] }
      }),
    },
    playbook: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (!state.newPlaybook || state.newPlaybook.id !== args.where.id) return null
        return state.newPlaybook
      }),
    },
    contentBrief: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (!state.brief || state.brief.id !== args.where.id) return null
        return {
          id: state.brief.id,
          storeId: state.brief.storeId,
          scheduledDate: state.brief.scheduledDate,
          offerId: null,
        }
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown>; include?: unknown }) => {
        const data = args.data
        const shotTasksSpec = data.shotTasks as { create?: Record<string, unknown>[] } | undefined
        const shotTasks = (shotTasksSpec?.create ?? []).map((st, i) => ({ id: `shot-${i + 1}`, ...st }))
        const { shotTasks: _omit, ...scalar } = data
        return { id: args.where.id, ...scalar, shotTasks }
      }),
    },
    rawAsset: { count: vi.fn(async () => 0) },
    shotTask: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  }
  return { prisma }
})

// instantiatePlaybookWithProvenance 走桩：按 playbook.requiredShots 派生 shotTasks（每类型一条）
vi.mock('@/lib/merchant/playbook-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/merchant/playbook-engine')>()
  return {
    ...actual,
    instantiatePlaybookWithProvenance: vi.fn(
      async (input: { playbook: { requiredShots?: string[]; name?: string } }) => {
        const required = input.playbook?.requiredShots ?? []
        const shotTasks = required.map((type, i) => ({
          order: i + 1,
          type,
          title: `镜头-${type}`,
          instruction: '按脚本拍摄',
          durationSec: 5,
          required: true,
        }))
        return {
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
            aiReasoning: '理由',
            shotTasks,
          },
          provenance: { references: [], isGenericTemplate: true },
        }
      }
    ),
  }
})

const { editContentBrief } = await import('@/lib/merchant/content-calendar-service')

// ============================================================
// 测试夹具
// ============================================================
const STORE_ID = 'store-1'
const BRIEF_ID = 'brief-1'

function reset(requiredShots: ShotTaskType[]) {
  const { state } = h
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
    weeklyCadence: null,
  }
  state.brief = {
    id: BRIEF_ID,
    storeId: STORE_ID,
    scheduledDate: new Date(Date.UTC(2026, 0, 7)),
  }
  state.newPlaybook = {
    id: 'pb-new',
    industry: 'RESTAURANT',
    name: '新剧本',
    goal: 'BRAND_STORY', // 非产品引用 goal → 无需 offer
    description: null,
    structure: [],
    requiredShots,
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

// 1-5 个互异镜头类型（buildShotTaskCreateData 收敛到 ≤5 条，约束以保证集合相等可判定）
const requiredShotsArb = fc
  .uniqueArray(fc.constantFrom<ShotTaskType>(...ALL_SHOT_TYPES), { minLength: 1, maxLength: 5 })

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 21: 换选题重实例化
// ============================================================
describe('Property 21: 换选题重实例化', () => {
  it('CHANGE_PLAYBOOK 后 brief 的 shotTasks 类型集合与新 playbook.requiredShots 相符', async () => {
    /** **Validates: Requirements 6.3** */
    await fc.assert(
      fc.asyncProperty(requiredShotsArb, async (requiredShots) => {
        reset(requiredShots)

        const { brief, reinstantiated } = await editContentBrief({
          briefId: BRIEF_ID,
          op: 'CHANGE_PLAYBOOK',
          payload: { newPlaybookId: 'pb-new' },
        })

        expect(reinstantiated).toBe(true)
        expect(brief).not.toBeNull()

        // 持久化的镜头类型集合 == 新 playbook 的 requiredShots 集合
        const persistedTypes = new Set(
          (brief!.shotTasks as { type: string }[]).map((s) => s.type)
        )
        expect(persistedTypes).toStrictEqual(new Set(requiredShots))

        // 换选题跟随新 playbook 的 goal（脚本与文案基于新 playbook 重建）
        expect(brief!.goal).toBe('BRAND_STORY')
        expect(brief!.playbookId).toBe('pb-new')
      }),
      { numRuns: 120 }
    )
  })
})
