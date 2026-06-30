// Feature: local-life-depth-enhancements, Property 19: 无引用即通用模板
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 19: 无引用即通用模板
 *
 * 对任意「无任何画像引用」的剧本实例化输入，instantiatePlaybookWithProvenance 产出的
 * BriefProvenance 必须满足：references 为空数组，且 isGenericTemplate=true（前端如实显示
 * 「通用模板」），绝不伪造溯源。
 *
 * **Validates: Requirements 5.6**
 *
 * 「无任何画像引用」的两类构造（覆盖 buildProvenance 的全部记录入口）：
 *   A. 模板不含任何画像占位符（{sellingPoint}/{cta}）——
 *      即使画像里有真实卖点/CTA，因模板未引用，溯源亦不记录；
 *   B. 模板可含占位符，但画像取值落在引用集合之外（卖点/CTA 集合为空 → 实例化取兜底默认值
 *      「新鲜现做」「点击下方团购链接」，不属于任何画像集合）。
 *
 * 两类场景均强制 hookKeywords 为空：钩子词溯源不依赖模板（落入标签即记录），故无引用前提
 * 必须钩子词集合为空。
 *
 * 测试手段（确定性、无真实网络）：instantiatePlaybookWithProvenance 内部仅在 LLM 润色处
 * 调用全局 fetch，provenance 由原始模板 + 画像取值纯计算得出，与润色结果无关。此处对 fetch
 * 打桩返回固定内容，仅保证润色路径确定、不触发真实网络，断言作用于真实溯源计算结果。
 */

import type {
  MerchantIndustry,
  ContentGoal,
  ShotTaskType,
} from '@/types/merchant'

// LLM 配置：模块级常量在导入时读取 env，须在动态导入前设置，使润色走 fetch 桩（确定性）
process.env.MERCHANT_LLM_API_URL = 'https://test.local/v1'
process.env.MERCHANT_LLM_API_KEY = 'test-key'

// 全局 fetch 桩：返回固定润色内容（hook --- caption）。provenance 不依赖此结果，仅保证确定性与零网络。
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { content: '润色后的钩子\n---\n润色后的正文' } }],
    }),
  })),
)

// 动态导入以确保上述 env / fetch 桩生效
const { instantiatePlaybookWithProvenance } = await import('@/lib/playbook-engine')
type Playbook = Awaited<ReturnType<typeof import('@/lib/playbook-engine')['selectPlaybooks']>>[number]
type Store = Parameters<typeof instantiatePlaybookWithProvenance>[0]['store']
type StoreProfile = Parameters<typeof instantiatePlaybookWithProvenance>[0]['profile']
type ProductOffer = NonNullable<Parameters<typeof instantiatePlaybookWithProvenance>[0]['offer']>

// ========================
// 常量取值集合
// ========================

const INDUSTRIES: MerchantIndustry[] = [
  'RESTAURANT', 'DRINK', 'OTHER_LOCAL',
]
const GOALS: ContentGoal[] = [
  'TRAFFIC', 'PROMOTION', 'NEW_PRODUCT', 'TRUST_BUILDING',
  'BRAND_STORY', 'CUSTOMER_TESTIMONIAL', 'WEEKEND_BOOST', 'REPEAT_PURCHASE',
]
// 不依赖特殊拍摄能力的镜头类型（必拍镜头不做能力过滤，但取无能力依赖项更贴近真实剧本）
const SHOT_TYPES: ShotTaskType[] = [
  'STOREFRONT', 'PRODUCT_CLOSEUP', 'ENVIRONMENT', 'OFFER_DISPLAY', 'CTA_SCREEN',
]

// 实例化取兜底默认值时的固定文案（buildTemplateVars 中的兜底，不属于任何画像集合）
const FALLBACK_SELLING_POINT = '新鲜现做'
const FALLBACK_CTA = '点击下方团购链接'

// ========================
// Arbitraries
// ========================

// 安全文本：不含花括号，确保不会意外引入占位符
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyz饭面香鲜店家美味早午晚 '.split('')
const safeText = (maxLength: number) =>
  fc.array(fc.constantFrom(...SAFE_CHARS), { minLength: 0, maxLength }).map((a) => a.join('').trim() || 'x')

// 允许出现的「非画像」占位符（出现与否都不产生溯源引用）
const NEUTRAL_PLACEHOLDERS = ['{storeName}', '{productName}', '{price}', '{location}', '{discount}']

// A 类模板：不含 {sellingPoint}/{cta}（可含中性占位符），保证无 sellingPoint/cta 溯源入口
const noProfilePlaceholderTemplateArb = fc
  .tuple(safeText(20), fc.subarray(NEUTRAL_PLACEHOLDERS, { minLength: 0, maxLength: 2 }))
  .map(([text, ph]) => `${text}${ph.join('')}`)

// B 类模板：可含 {sellingPoint}/{cta}（即便引用，取值也是兜底默认值，不在画像集合内）
const profilePlaceholderTemplateArb = fc
  .tuple(safeText(16), fc.subarray(['{sellingPoint}', '{cta}', '{storeName}'], { minLength: 1, maxLength: 3 }))
  .map(([text, ph]) => `${text}${ph.join('')}`)

// 非空模板数组（pickRandom 要求非空）
const templateListArb = (tmpl: fc.Arbitrary<string>) => fc.array(tmpl, { minLength: 1, maxLength: 4 })

// 构造 Playbook（templates 由场景决定）
function buildPlaybookArb(templateArb: fc.Arbitrary<string>): fc.Arbitrary<Playbook> {
  return fc.record({
    id: fc.uuid(),
    industry: fc.constantFrom(...INDUSTRIES),
    name: safeText(10),
    goal: fc.constantFrom(...GOALS),
    requiredShots: fc.subarray(SHOT_TYPES, { minLength: 1, maxLength: 3 }),
    hookTemplates: templateListArb(templateArb),
    captionTemplates: templateListArb(templateArb),
    coverTitleTemplates: templateListArb(templateArb),
    ctaTemplates: templateListArb(templateArb),
  }).map((p) => ({
    id: p.id,
    industry: p.industry,
    name: p.name,
    goal: p.goal,
    description: null,
    structure: [],
    requiredShots: p.requiredShots,
    optionalShots: null,
    hookTemplates: p.hookTemplates,
    captionTemplates: p.captionTemplates,
    coverTitleTemplates: p.coverTitleTemplates,
    ctaTemplates: p.ctaTemplates,
    complianceRules: null,
    scoreWeight: null,
    tierRequired: 'FREE',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as fc.Arbitrary<Playbook>
}

// Store（mainSellingPoints 由场景决定）
function buildStoreArb(sellingPointsArb: fc.Arbitrary<string[]>): fc.Arbitrary<Store> {
  return fc.record({
    id: fc.uuid(),
    name: safeText(8),
    industry: fc.constantFrom(...INDUSTRIES),
    city: fc.option(safeText(4), { nil: null }),
    district: fc.option(safeText(4), { nil: null }),
    mainProducts: fc.array(safeText(6), { maxLength: 3 }),
    mainSellingPoints: sellingPointsArb,
  }).map((s) => ({
    id: s.id,
    name: s.name,
    industry: s.industry,
    city: s.city,
    district: s.district,
    businessArea: null,
    address: null,
    mainProducts: s.mainProducts,
    mainSellingPoints: s.mainSellingPoints,
    canShootKitchen: true,
    canShootStaff: true,
    canShootCustomers: true,
  })) as unknown as fc.Arbitrary<Store>
}

// StoreProfile：hookKeywords 恒为空（无引用前提）；preferredCta 由场景决定
function buildProfileArb(preferredCtaArb: fc.Arbitrary<string[] | null>): fc.Arbitrary<StoreProfile> {
  return fc.record({
    id: fc.uuid(),
    storeId: fc.uuid(),
    preferredCta: preferredCtaArb,
  }).map((p) => ({
    id: p.id,
    storeId: p.storeId,
    contentPositioning: null,
    recommendedPersona: null,
    // 钩子词恒为空：钩子词溯源不依赖模板，落入标签即记录，无引用前提必须为空
    hookKeywords: null,
    forbiddenClaims: null,
    preferredCta: p.preferredCta,
    contentDos: null,
    contentDonts: null,
  })) as unknown as fc.Arbitrary<StoreProfile>
}

// 可选 offer：sellingPoints 由场景决定
function buildOfferArb(sellingPointsArb: fc.Arbitrary<string[] | null>): fc.Arbitrary<ProductOffer | undefined> {
  return fc.option(
    fc.record({
      id: fc.uuid(),
      storeId: fc.uuid(),
      name: safeText(6),
      sellingPoints: sellingPointsArb,
    }).map((o) => ({
      id: o.id,
      storeId: o.storeId,
      name: o.name,
      description: null,
      originalPrice: null,
      salePrice: null,
      sellingPoints: o.sellingPoints,
      usageRules: null,
      isActive: true,
    })) as unknown as fc.Arbitrary<ProductOffer>,
    { nil: undefined },
  )
}

// ── 场景 A：模板无画像占位符；画像可有真实卖点/CTA（证明无占位符即无引用）──
const scenarioNoPlaceholderArb = fc.record({
  playbook: buildPlaybookArb(noProfilePlaceholderTemplateArb),
  // 卖点/CTA 故意给真实非空值：唯一不记录原因是模板未引用
  store: buildStoreArb(fc.array(safeText(8), { maxLength: 3 })),
  profile: buildProfileArb(fc.option(fc.array(safeText(8), { minLength: 1, maxLength: 3 }), { nil: null })),
  offer: buildOfferArb(fc.option(fc.array(safeText(8), { maxLength: 3 }), { nil: null })),
  scheduledDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }),
})

// ── 场景 B：模板可含占位符；画像卖点/CTA 集合为空 → 取兜底默认值（不在任何画像集合）──
const scenarioFallbackArb = fc.record({
  playbook: buildPlaybookArb(profilePlaceholderTemplateArb),
  // 卖点集合必须为空（store + offer 均空），实例化取兜底「新鲜现做」
  store: buildStoreArb(fc.constant([])),
  // CTA 集合为空 → 取兜底「点击下方团购链接」
  profile: buildProfileArb(fc.constantFrom(null, [])),
  offer: buildOfferArb(fc.constant([])),
  scheduledDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }),
})

const genericInputArb = fc.oneof(scenarioNoPlaceholderArb, scenarioFallbackArb)

// ========================
// Property 19: 无引用即通用模板
// ========================

describe('Property 19: 无引用即通用模板', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无任何画像引用的 brief ⇒ references 为空且 isGenericTemplate=true（不伪造溯源）', async () => {
    /**
     * **Validates: Requirements 5.6**
     */
    await fc.assert(
      fc.asyncProperty(genericInputArb, async (input) => {
        const { provenance } = await instantiatePlaybookWithProvenance({
          playbook: input.playbook,
          store: input.store,
          profile: input.profile,
          offer: input.offer,
          scheduledDate: input.scheduledDate,
        })

        // 无引用：references 必为空数组
        expect(provenance.references).toEqual([])
        // 如实标记为通用模板
        expect(provenance.isGenericTemplate).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
