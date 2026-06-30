// Feature: local-life-depth-enhancements, Property 17: 溯源引用来自画像
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 17: 溯源引用来自画像
 *
 * 对任意由 instantiatePlaybookWithProvenance 产出的 BriefProvenance：
 * 其 references 中每条 value 必须属于 StoreProfile（及关联 offer/store）对应字段的取值集合：
 *   - field='sellingPoint' → value ∈ (offer.sellingPoints ∪ store.mainSellingPoints)
 *   - field='cta'          → value ∈ profile.preferredCta
 *   - field='hookKeyword'  → value ∈ profile.hookKeywords
 *   - field='persona'      → value ∈ {profile.recommendedPersona}
 * 即溯源引用恒来自真实画像取值，绝不伪造（兜底文案不在任何画像集合内，不应被记录）。
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * 测试手段：
 * - 对 @/lib/db 的 prisma 做空桩，打断 playbook-engine 模块加载期的 Prisma(DATABASE_URL) 初始化副作用；
 *   被测函数 instantiatePlaybookWithProvenance 本身不触达数据库。
 * - 对 LLM 润色走的 global.fetch 做桩使其失败（reject），令 polishWithLLM 降级为模板原文，保证测试确定性；
 *   溯源结构体的计算只依赖原始模板/画像取值，不依赖润色结果。
 */

// ========================
// Mock Prisma（仅为打断模块加载期的 db 初始化副作用，被测函数不使用数据库）
// ========================
vi.mock('@/lib/db', () => ({ prisma: {} }))

// 动态导入以确保 mock 生效
const { instantiatePlaybookWithProvenance } = await import('@/lib/playbook-engine')
type Inst = typeof instantiatePlaybookWithProvenance
type Store = Parameters<Inst>[0]['store']
type StoreProfile = Parameters<Inst>[0]['profile']
type ProductOffer = NonNullable<Parameters<Inst>[0]['offer']>
type Playbook = Parameters<Inst>[0]['playbook']

// ========================
// Arbitraries
// ========================

/** 非空中文短语取值（用作卖点/钩子词/CTA 等画像取值，避免空白被 uniqueNonEmpty 过滤） */
const phraseArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0)

/** 画像取值集合（0~5 个非空短语） */
const phraseSetArb = fc.array(phraseArb, { maxLength: 5 })

/**
 * 模板生成器：以一段随机字面文本拼接若干占位符，可能包含 {sellingPoint}/{cta} 等，
 * 用于真实触发卖点/CTA 的溯源引用记录路径。
 */
const placeholderArb = fc.constantFrom(
  '{sellingPoint}',
  '{cta}',
  '{storeName}',
  '{productName}',
  '{price}',
  '{location}',
  '' // 也可能不含占位符
)
const templateArb = fc
  .tuple(fc.string({ maxLength: 8 }), placeholderArb, fc.string({ maxLength: 8 }), placeholderArb)
  .map(([a, p1, b, p2]) => `${a}${p1}${b}${p2}`)

/** 模板数组（非空，pickRandom 要求至少一个元素） */
const templatesArb = fc.array(templateArb, { minLength: 1, maxLength: 4 })

/** 随机 ProductOffer（可选） */
const offerArb: fc.Arbitrary<ProductOffer | undefined> = fc.option(
  fc.record({
    id: fc.uuid(),
    storeId: fc.uuid(),
    name: phraseArb,
    description: fc.option(fc.string(), { nil: null }),
    originalPrice: fc.option(fc.integer({ min: 100, max: 100000 }), { nil: null }),
    salePrice: fc.option(fc.integer({ min: 100, max: 100000 }), { nil: null }),
    sellingPoints: fc.option(phraseSetArb, { nil: null }),
    usageRules: fc.option(fc.string(), { nil: null }),
    isActive: fc.boolean(),
  }),
  { nil: undefined }
)

/** 随机 Store */
const storeArb: fc.Arbitrary<Store> = fc.record({
  id: fc.uuid(),
  name: phraseArb,
  industry: fc.constantFrom('RESTAURANT', 'CAFE', 'BEAUTY') as fc.Arbitrary<Store['industry']>,
  city: fc.option(phraseArb, { nil: null }),
  district: fc.option(phraseArb, { nil: null }),
  businessArea: fc.option(phraseArb, { nil: null }),
  address: fc.option(fc.string(), { nil: null }),
  mainProducts: fc.array(phraseArb, { maxLength: 4 }),
  mainSellingPoints: phraseSetArb,
  canShootKitchen: fc.boolean(),
  canShootStaff: fc.boolean(),
  canShootCustomers: fc.boolean(),
})

/** 随机 StoreProfile */
const profileArb: fc.Arbitrary<StoreProfile> = fc.record({
  id: fc.uuid(),
  storeId: fc.uuid(),
  contentPositioning: fc.option(fc.string(), { nil: null }),
  recommendedPersona: fc.option(phraseArb, { nil: null }),
  hookKeywords: fc.option(phraseSetArb, { nil: null }),
  forbiddenClaims: fc.option(fc.array(phraseArb, { maxLength: 3 }), { nil: null }),
  preferredCta: fc.option(phraseSetArb, { nil: null }),
  contentDos: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: null }),
  contentDonts: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: null }),
})

/** 随机 Playbook（无镜头需求，聚焦文案模板溯源路径） */
const playbookArb: fc.Arbitrary<Playbook> = fc.record({
  id: fc.uuid(),
  industry: fc.constantFrom('RESTAURANT', 'CAFE', 'BEAUTY') as fc.Arbitrary<Playbook['industry']>,
  name: phraseArb,
  goal: fc.constantFrom('AWARENESS', 'TRAFFIC', 'CONVERSION') as fc.Arbitrary<Playbook['goal']>,
  description: fc.option(fc.string(), { nil: null }),
  structure: fc.constant([]),
  requiredShots: fc.constant([]),
  optionalShots: fc.constant(null),
  hookTemplates: templatesArb,
  captionTemplates: templatesArb,
  coverTitleTemplates: templatesArb,
  ctaTemplates: templatesArb,
  complianceRules: fc.constant(null),
  scoreWeight: fc.constant(null),
  tierRequired: fc.constant('FREE'),
  isActive: fc.constant(true),
  createdAt: fc.constant(new Date('2025-01-01T00:00:00Z')),
  updatedAt: fc.constant(new Date('2025-01-01T00:00:00Z')),
})

// ========================
// Property 17: 溯源引用来自画像
// ========================

describe('Property 17: 溯源引用来自画像 (instantiatePlaybookWithProvenance)', () => {
  beforeEach(() => {
    // 桩住 LLM 润色的 fetch：使其失败，强制降级为模板原文（确定性）
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch disabled in property test')
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('references 中每条 value 必属于对应画像字段取值集合', async () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    await fc.assert(
      fc.asyncProperty(
        playbookArb,
        storeArb,
        profileArb,
        offerArb,
        async (playbook, store, profile, offer) => {
          const { provenance } = await instantiatePlaybookWithProvenance({
            playbook,
            store,
            profile,
            offer,
            scheduledDate: new Date('2025-06-01T00:00:00Z'),
          })

          // 各字段真实取值集合（与实现取值口径一致）
          const sellingPointSet = [...(offer?.sellingPoints ?? []), ...store.mainSellingPoints]
          const ctaSet = profile.preferredCta ?? []
          const hookKeywordSet = profile.hookKeywords ?? []
          const personaSet = profile.recommendedPersona ? [profile.recommendedPersona] : []

          for (const ref of provenance.references) {
            switch (ref.field) {
              case 'sellingPoint':
                expect(sellingPointSet).toContain(ref.value)
                break
              case 'cta':
                expect(ctaSet).toContain(ref.value)
                break
              case 'hookKeyword':
                expect(hookKeywordSet).toContain(ref.value)
                break
              case 'persona':
                expect(personaSet).toContain(ref.value)
                break
              default:
                // 不应出现未知字段类别
                throw new Error(`未知溯源字段类别: ${ref.field}`)
            }
          }

          // isGenericTemplate 语义自洽：无任何引用 ⇔ 通用模板
          expect(provenance.isGenericTemplate).toBe(provenance.references.length === 0)
        }
      ),
      { numRuns: 150 }
    )
  })
})
