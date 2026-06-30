// Feature: local-life-depth-enhancements, Property 22: 换选题保留已拍素材
//
// 属性：对任意已含 RawAsset 的 brief，更换 playbook 后原 RawAsset SHALL 全部保留
//   （计数不减），且 SHALL 返回 assetWarning 提示，不自动丢弃；无已拍素材时不返回 assetWarning。
//
// 被测：src/lib/content-calendar-service.ts 的 editContentBrief(CHANGE_PLAYBOOK)。
// 隔离手法：对 @/lib/db 做内存桩。rawAsset 仅暴露 count（用于 assetWarning 判定）—— 服务
//   依赖数据库层 onDelete:SetNull 解除关联但保留素材行，业务代码不得主动删除 RawAsset；
//   故内存桩不提供 rawAsset.delete/deleteMany，若服务误删将因方法不存在而抛错被测出。
//   shotTask.deleteMany 仅删除镜头脚本，不影响 RawAsset 计数。
//
// **Validates: Requirements 6.4**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

const ASSET_WARNING = '选题已变更，原素材可能与新脚本不匹配，请确认是否重拍'

const h = vi.hoisted(() => {
  const state: {
    store: Record<string, unknown> | null
    profile: Record<string, unknown> | null
    brief: Record<string, unknown> | null
    newPlaybook: Record<string, unknown> | null
    rawAssetCount: number
    shotTaskDeleteCalls: number
  } = {
    store: null,
    profile: null,
    brief: null,
    newPlaybook: null,
    rawAssetCount: 0,
    shotTaskDeleteCalls: 0,
  }
  return { state }
})

vi.mock('@/lib/db', () => {
  const { state } = h
  const prisma = {
    store: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
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
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const data = args.data
        const shotTasksSpec = data.shotTasks as { create?: Record<string, unknown>[] } | undefined
        const shotTasks = (shotTasksSpec?.create ?? []).map((st, i) => ({ id: `shot-${i + 1}`, ...st }))
        const { shotTasks: _omit, ...scalar } = data
        return { id: args.where.id, ...scalar, shotTasks }
      }),
    },
    rawAsset: {
      // assetWarning 判定：统计该 brief 下所有 shotTask 关联的 RawAsset 数量
      count: vi.fn(async () => state.rawAssetCount),
      // 故意不提供 delete/deleteMany：若业务误删素材将抛错（保护性断言）
    },
    shotTask: {
      // 仅删除镜头脚本，不触及 RawAsset 计数（模拟 onDelete:SetNull 保留素材行）
      deleteMany: vi.fn(async () => {
        state.shotTaskDeleteCalls++
        return { count: 1 }
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  }
  return { prisma }
})

vi.mock('@/lib/playbook-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/playbook-engine')>()
  return {
    ...actual,
    instantiatePlaybookWithProvenance: vi.fn(async () => ({
      draft: {
        title: '测试内容',
        goal: 'BRAND_STORY',
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
          { order: 1, type: 'STOREFRONT', title: '拍门头', instruction: '对准招牌', durationSec: 5, required: true },
        ],
      },
      provenance: { references: [], isGenericTemplate: true },
    })),
  }
})

const { editContentBrief } = await import('@/lib/content-calendar-service')

const STORE_ID = 'store-1'
const BRIEF_ID = 'brief-1'

function reset(rawAssetCount: number) {
  const { state } = h
  state.rawAssetCount = rawAssetCount
  state.shotTaskDeleteCalls = 0
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
    goal: 'BRAND_STORY',
    description: null,
    structure: [],
    requiredShots: ['STOREFRONT'],
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

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Property 22: 换选题保留已拍素材
// ============================================================
describe('Property 22: 换选题保留已拍素材', () => {
  it('CHANGE_PLAYBOOK 保留全部 RawAsset（计数不减），有素材时返回 assetWarning', async () => {
    /** **Validates: Requirements 6.4** */
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (k) => {
        reset(k)

        const { reinstantiated, assetWarning } = await editContentBrief({
          briefId: BRIEF_ID,
          op: 'CHANGE_PLAYBOOK',
          payload: { newPlaybookId: 'pb-new' },
        })

        expect(reinstantiated).toBe(true)

        // RawAsset 全部保留：计数未减（业务从不删除素材）
        expect(h.state.rawAssetCount).toBe(k)

        // 旧镜头脚本被替换（重实例化），但素材保留
        expect(h.state.shotTaskDeleteCalls).toBe(1)

        // assetWarning：有已拍素材时返回提示，无素材时不返回
        if (k > 0) {
          expect(assetWarning).toBe(ASSET_WARNING)
        } else {
          expect(assetWarning).toBeUndefined()
        }
      }),
      { numRuns: 120 }
    )
  })
})
