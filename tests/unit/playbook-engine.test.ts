/**
 * 单元测试: playbook-engine
 *
 * 验证行业剧本引擎的核心逻辑：
 * - selectPlaybooks: 按 goal+industry 过滤候选剧本
 * - pickNonConsecutive: 连续使用同一剧本不超上限
 * - replaceTemplateVars: 模板变量替换
 * - fallback: 无候选剧本时的兜底处理
 * - sortByScoreWeight: 剧本权重/优先级排序
 * - 门店权限约束: canShootKitchen/Staff/Customers 影响候选过滤
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    playbook: { findMany: vi.fn() },
    store: { findUnique: vi.fn() },
    contentBrief: { findMany: vi.fn() },
  },
}))

// Mock fetch（LLM 润色调用）
vi.stubGlobal('fetch', vi.fn())

import { prisma } from '@/lib/shared/db'
import { selectPlaybooks, instantiatePlaybook } from '@/lib/merchant/playbook-engine'
import type { Playbook, Store, StoreProfile, ProductOffer } from '@/lib/merchant/playbook-engine'
import { MAX_CONSECUTIVE_PLAYBOOK_USE } from '@/constants/merchant'

// ========================
// 测试数据工厂
// ========================

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'pb-1',
    industry: 'RESTAURANT',
    name: '爆款引流',
    goal: 'TRAFFIC',
    description: '通用引流剧本',
    structure: [{ name: '开场', purpose: '吸引', durationSec: 5 }],
    requiredShots: ['STOREFRONT', 'PRODUCT_CLOSEUP'],
    optionalShots: ['ENVIRONMENT'],
    hookTemplates: ['{storeName}的{productName}太好吃了！'],
    captionTemplates: ['在{location}发现了一家宝藏店，{sellingPoint}'],
    coverTitleTemplates: ['{productName}仅{price}'],
    ctaTemplates: ['{cta}'],
    complianceRules: null,
    scoreWeight: { views: 80, conversion: 60 },
    tierRequired: 'FREE',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: 'store-1',
    name: '老王牛肉面',
    industry: 'RESTAURANT',
    city: '杭州',
    district: '西湖区',
    businessArea: '黄龙商圈',
    address: '文三路100号',
    mainProducts: ['牛肉面', '红烧牛肉饭'],
    mainSellingPoints: ['现熬8小时骨汤', '手工拉面'],
    canShootKitchen: true,
    canShootStaff: true,
    canShootCustomers: false,
    ...overrides,
  }
}

function makeStoreProfile(overrides: Partial<StoreProfile> = {}): StoreProfile {
  return {
    id: 'profile-1',
    storeId: 'store-1',
    contentPositioning: '品质快餐',
    recommendedPersona: '踏实老板',
    hookKeywords: ['好吃', '实惠', '手工'],
    forbiddenClaims: ['最好吃', '第一名'],
    preferredCta: ['点击下方团购链接'],
    contentDos: ['拍厨房现做', '展示食材'],
    contentDonts: ['不拍脏乱环境'],
    ...overrides,
  }
}

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'offer-1',
    storeId: 'store-1',
    name: '招牌牛肉面套餐',
    description: '含小菜+饮品',
    originalPrice: 3800,
    salePrice: 2500,
    sellingPoints: ['超值', '现做现卖'],
    usageRules: '每人限购1份',
    isActive: true,
    ...overrides,
  }
}

const mockPlaybookFindMany = prisma.playbook.findMany as ReturnType<typeof vi.fn>
const mockStoreFindUnique = prisma.store.findUnique as ReturnType<typeof vi.fn>
const mockContentBriefFindMany = prisma.contentBrief.findMany as ReturnType<typeof vi.fn>
const mockFetch = fetch as ReturnType<typeof vi.fn>

// ========================
// selectPlaybooks 测试
// ========================

describe('playbook-engine / selectPlaybooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 store 返回全部拍摄能力
    mockStoreFindUnique.mockResolvedValue({
      canShootKitchen: true,
      canShootStaff: true,
      canShootCustomers: true,
    })
    // 默认无历史记录
    mockContentBriefFindMany.mockResolvedValue([])
  })

  describe('按 goal+industry 过滤候选剧本', () => {
    it('仅返回匹配 industry 的剧本', async () => {
      const pb1 = makePlaybook({ id: 'pb-restaurant', industry: 'RESTAURANT', goal: 'TRAFFIC' })
      mockPlaybookFindMany.mockResolvedValue([pb1])

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
      })

      // prisma 查询应过滤 industry
      expect(mockPlaybookFindMany).toHaveBeenCalledWith({
        where: { industry: 'RESTAURANT', isActive: true },
      })
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-restaurant')
    })

    it('按 goal 轮换分配剧本（days > goals.length 时循环）', async () => {
      const pbTraffic = makePlaybook({ id: 'pb-traffic', goal: 'TRAFFIC' })
      const pbPromo = makePlaybook({ id: 'pb-promo', goal: 'PROMOTION' })
      mockPlaybookFindMany.mockResolvedValue([pbTraffic, pbPromo])

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC', 'PROMOTION'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 4,
      })

      // 4 天应按 TRAFFIC, PROMOTION, TRAFFIC, PROMOTION 循环
      expect(result.length).toBe(4)
      expect(result[0].goal).toBe('TRAFFIC')
      expect(result[1].goal).toBe('PROMOTION')
      expect(result[2].goal).toBe('TRAFFIC')
      expect(result[3].goal).toBe('PROMOTION')
    })

    it('过滤掉需要不可用拍摄能力的剧本', async () => {
      const pbKitchen = makePlaybook({
        id: 'pb-kitchen',
        goal: 'TRAFFIC',
        requiredShots: ['COOKING_PROCESS'],
      })
      const pbStorefront = makePlaybook({
        id: 'pb-storefront',
        goal: 'TRAFFIC',
        requiredShots: ['STOREFRONT'],
      })
      mockPlaybookFindMany.mockResolvedValue([pbKitchen, pbStorefront])
      // 门店不能拍厨房
      mockStoreFindUnique.mockResolvedValue({
        canShootKitchen: false,
        canShootStaff: true,
        canShootCustomers: true,
      })

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [],
        days: 1,
      })

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-storefront')
    })
  })

  describe('连续使用同一剧本不超上限', () => {
    it('最近 N 次全用同一剧本时，应切换到其他候选', async () => {
      const pb1 = makePlaybook({ id: 'pb-1', goal: 'TRAFFIC', scoreWeight: { views: 90, conversion: 80 } })
      const pb2 = makePlaybook({ id: 'pb-2', goal: 'TRAFFIC', scoreWeight: { views: 70, conversion: 60 } })
      mockPlaybookFindMany.mockResolvedValue([pb1, pb2])
      // 模拟最近 MAX_CONSECUTIVE_PLAYBOOK_USE 次全用 pb-1
      mockContentBriefFindMany.mockResolvedValue(
        Array(MAX_CONSECUTIVE_PLAYBOOK_USE).fill({ playbookId: 'pb-1' })
      )

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
      })

      // 应避开 pb-1（已连续 N 次），选 pb-2
      expect(result[0].id).toBe('pb-2')
    })

    it('连续次数未达上限时仍可选用同一剧本', async () => {
      const pb1 = makePlaybook({ id: 'pb-1', goal: 'TRAFFIC', scoreWeight: { views: 90, conversion: 80 } })
      const pb2 = makePlaybook({ id: 'pb-2', goal: 'TRAFFIC', scoreWeight: { views: 50, conversion: 50 } })
      mockPlaybookFindMany.mockResolvedValue([pb1, pb2])
      // 只连续使用了 N-1 次，未达上限
      mockContentBriefFindMany.mockResolvedValue(
        Array(MAX_CONSECUTIVE_PLAYBOOK_USE - 1).fill({ playbookId: 'pb-1' })
      )

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
      })

      // 未达上限，仍可选高分的 pb-1
      expect(result[0].id).toBe('pb-1')
    })

    it('所有候选都连续超限时，取最高分剧本', async () => {
      const pb1 = makePlaybook({ id: 'pb-1', goal: 'TRAFFIC', scoreWeight: { views: 90, conversion: 80 } })
      mockPlaybookFindMany.mockResolvedValue([pb1])
      // 只有一个候选且已连续使用达上限
      mockContentBriefFindMany.mockResolvedValue(
        Array(MAX_CONSECUTIVE_PLAYBOOK_USE).fill({ playbookId: 'pb-1' })
      )

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
      })

      // 无其他选择时，仍返回最高分
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-1')
    })
  })

  describe('无候选剧本时 fallback 处理', () => {
    it('指定 goal 无匹配剧本时，fallback 到其他 goal 的最高分剧本', async () => {
      // 只有 PROMOTION 类剧本，没有 TRAFFIC 类
      const pbPromo = makePlaybook({ id: 'pb-promo', goal: 'PROMOTION', scoreWeight: { views: 70, conversion: 90 } })
      mockPlaybookFindMany.mockResolvedValue([pbPromo])

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'], // 请求 TRAFFIC 但没有匹配
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
      })

      // 应 fallback 到 PROMOTION 类剧本
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-promo')
    })

    it('excludePlaybookIds 排除后无候选时 fallback 到剩余最高分', async () => {
      const pb1 = makePlaybook({ id: 'pb-1', goal: 'TRAFFIC', scoreWeight: { views: 90, conversion: 80 } })
      const pb2 = makePlaybook({ id: 'pb-2', goal: 'PROMOTION', scoreWeight: { views: 60, conversion: 70 } })
      mockPlaybookFindMany.mockResolvedValue([pb1, pb2])

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [makeOffer()],
        days: 1,
        excludePlaybookIds: ['pb-1'], // 排除唯一的 TRAFFIC 剧本
      })

      // 应 fallback 到 pb-2
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-2')
    })
  })

  describe('门店权限约束（canShoot* 影响候选过滤）', () => {
    it('canShootStaff=false 过滤掉含 STAFF_ACTION 必拍镜头的剧本', async () => {
      const pbStaff = makePlaybook({
        id: 'pb-staff',
        goal: 'TRUST_BUILDING',
        requiredShots: ['STAFF_ACTION', 'STOREFRONT'],
      })
      const pbSimple = makePlaybook({
        id: 'pb-simple',
        goal: 'TRUST_BUILDING',
        requiredShots: ['STOREFRONT', 'PRODUCT_CLOSEUP'],
      })
      mockPlaybookFindMany.mockResolvedValue([pbStaff, pbSimple])
      mockStoreFindUnique.mockResolvedValue({
        canShootKitchen: true,
        canShootStaff: false,
        canShootCustomers: true,
      })

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRUST_BUILDING'],
        storeProfile: makeStoreProfile(),
        offers: [],
        days: 1,
      })

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-simple')
    })

    it('canShootCustomers=false 过滤掉含 CUSTOMER_REACTION 必拍镜头的剧本', async () => {
      const pbCustomer = makePlaybook({
        id: 'pb-customer',
        goal: 'TRAFFIC',
        requiredShots: ['CUSTOMER_REACTION'],
      })
      const pbNoCustomer = makePlaybook({
        id: 'pb-no-customer',
        goal: 'TRAFFIC',
        requiredShots: ['PRODUCT_CLOSEUP'],
      })
      mockPlaybookFindMany.mockResolvedValue([pbCustomer, pbNoCustomer])
      mockStoreFindUnique.mockResolvedValue({
        canShootKitchen: true,
        canShootStaff: true,
        canShootCustomers: false,
      })

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [],
        days: 1,
      })

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-no-customer')
    })

    it('OWNER_TALKING 需要 canShootStaff 权限', async () => {
      const pbOwner = makePlaybook({
        id: 'pb-owner',
        goal: 'BRAND_STORY',
        requiredShots: ['OWNER_TALKING'],
      })
      const pbEnv = makePlaybook({
        id: 'pb-env',
        goal: 'BRAND_STORY',
        requiredShots: ['ENVIRONMENT'],
      })
      mockPlaybookFindMany.mockResolvedValue([pbOwner, pbEnv])
      mockStoreFindUnique.mockResolvedValue({
        canShootKitchen: true,
        canShootStaff: false,
        canShootCustomers: true,
      })

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['BRAND_STORY'],
        storeProfile: makeStoreProfile(),
        offers: [],
        days: 1,
      })

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-env')
    })

    it('无能力限制的镜头类型（STOREFRONT/PRODUCT_CLOSEUP/ENVIRONMENT）不受 canShoot 影响', async () => {
      const pb = makePlaybook({
        id: 'pb-all-safe',
        goal: 'TRAFFIC',
        requiredShots: ['STOREFRONT', 'PRODUCT_CLOSEUP', 'ENVIRONMENT', 'OFFER_DISPLAY', 'CTA_SCREEN'],
      })
      mockPlaybookFindMany.mockResolvedValue([pb])
      // 所有 canShoot 都关闭
      mockStoreFindUnique.mockResolvedValue({
        canShootKitchen: false,
        canShootStaff: false,
        canShootCustomers: false,
      })

      const result = await selectPlaybooks({
        industry: 'RESTAURANT',
        goals: ['TRAFFIC'],
        storeProfile: makeStoreProfile(),
        offers: [],
        days: 1,
      })

      // 这些镜头不需要特殊拍摄能力，应通过
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('pb-all-safe')
    })
  })
})

// ========================
// instantiatePlaybook 测试 — 模板变量替换
// ========================

describe('playbook-engine / instantiatePlaybook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch 使 LLM 润色失败从而降级为模板原文（确保测试确定性）
    mockFetch.mockRejectedValue(new Error('LLM unavailable'))
  })

  it('正确替换 {storeName} 占位符', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['{storeName}开业大酬宾'],
      captionTemplates: ['快来{storeName}吃饭'],
      coverTitleTemplates: ['{storeName}特惠'],
      ctaTemplates: ['到{storeName}消费'],
    })
    const store = makeStore({ name: '张三烧烤' })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.hook).toContain('张三烧烤')
    expect(draft.mainMessage).toContain('张三烧烤')
  })

  it('正确替换 {productName} 占位符（优先使用 offer.name）', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['今天推荐{productName}'],
      captionTemplates: ['{productName}超好吃'],
      coverTitleTemplates: ['{productName}'],
      ctaTemplates: ['买{productName}'],
    })
    const store = makeStore({ mainProducts: ['牛肉面'] })
    const offer = makeOffer({ name: '招牌大排面' })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      offer,
      scheduledDate: new Date('2024-06-01'),
    })

    // 有 offer 时应使用 offer.name
    expect(draft.hook).toContain('招牌大排面')
  })

  it('无 offer 时 {productName} 使用 mainProducts[0]', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['今天推荐{productName}'],
      captionTemplates: ['{productName}真不错'],
      coverTitleTemplates: ['{productName}'],
      ctaTemplates: ['试试{productName}'],
    })
    const store = makeStore({ mainProducts: ['红烧排骨'] })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.hook).toContain('红烧排骨')
  })

  it('正确替换 {price} 和 {originalPrice} 占位符（分→元转换）', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['原价{originalPrice}现在只要{price}'],
      captionTemplates: ['仅需{price}'],
      coverTitleTemplates: ['{price}起'],
      ctaTemplates: ['{price}抢购'],
    })
    const store = makeStore()
    const offer = makeOffer({ originalPrice: 5000, salePrice: 2900 })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      offer,
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.hook).toContain('50元')
    expect(draft.hook).toContain('29元')
  })

  it('正确替换 {sellingPoint} 占位符（优先使用 offer.sellingPoints[0]）', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['亮点：{sellingPoint}'],
      captionTemplates: ['{sellingPoint}值得一试'],
      coverTitleTemplates: ['{sellingPoint}'],
      ctaTemplates: ['体验{sellingPoint}'],
    })
    const store = makeStore({ mainSellingPoints: ['现熬骨汤'] })
    const offer = makeOffer({ sellingPoints: ['当日现做', '不含添加剂'] })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      offer,
      scheduledDate: new Date('2024-06-01'),
    })

    // 有 offer.sellingPoints 时优先使用
    expect(draft.hook).toContain('当日现做')
  })

  it('正确替换 {location} 占位符（组合 city+district+businessArea）', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['在{location}发现宝藏店'],
      captionTemplates: ['{location}必去'],
      coverTitleTemplates: ['{location}美食'],
      ctaTemplates: ['来{location}'],
    })
    const store = makeStore({ city: '上海', district: '浦东新区', businessArea: '陆家嘴' })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id }),
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.hook).toContain('上海')
    expect(draft.hook).toContain('浦东新区')
    expect(draft.hook).toContain('陆家嘴')
  })

  it('正确替换 {cta} 占位符（使用 profile.preferredCta[0]）', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['快来体验'],
      captionTemplates: ['好吃不贵'],
      coverTitleTemplates: ['优惠'],
      ctaTemplates: ['{cta}'],
    })
    const store = makeStore()
    const profile = makeStoreProfile({ preferredCta: ['点击左下角立即抢购'] })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile,
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.suggestedCta).toContain('点击左下角立即抢购')
  })

  it('多个占位符同时替换正确', async () => {
    const playbook = makePlaybook({
      hookTemplates: ['{storeName}的{productName}只要{price}！'],
      captionTemplates: ['在{location}，{sellingPoint}'],
      coverTitleTemplates: ['{productName}{discount}'],
      ctaTemplates: ['{cta}'],
    })
    const store = makeStore({ name: '李四火锅', city: '成都', district: '锦江区', businessArea: '春熙路' })
    const offer = makeOffer({ name: '鸳鸯锅套餐', salePrice: 9900, originalPrice: 15800 })

    const draft = await instantiatePlaybook({
      playbook,
      store,
      profile: makeStoreProfile({ storeId: store.id, preferredCta: ['团购下单'] }),
      offer,
      scheduledDate: new Date('2024-06-01'),
    })

    expect(draft.hook).toContain('李四火锅')
    expect(draft.hook).toContain('鸳鸯锅套餐')
    expect(draft.hook).toContain('99元')
    expect(draft.suggestedCta).toBe('团购下单')
  })
})
