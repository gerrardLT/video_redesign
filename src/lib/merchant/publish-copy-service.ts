/**
 * 发布文案生成服务 — 按平台生成标题、封面、正文、标签和 CTA
 *
 * 使用 LLM（qwen）按平台分别生成文案，prompt 中注入门店信息、违禁表达、
 * 首选 CTA 和优惠信息。生成后对 forbiddenClaims 做二次扫描过滤。
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { randomUUID } from 'crypto'
import { PLATFORM_CAPTION_LIMITS, CREDIT_COST_COPY_REWRITE, LLM_MAX_TOKENS } from '@/constants/merchant'
import { prisma } from '../shared/db'
import { ApiError } from '../shared/api-error'
import { getBalance } from '../shared/credit-service'
import {
  reserveMerchantCredits,
  chargeMerchantCredits,
  refundMerchantCredits,
} from './merchant-billing-service'
import type {
  VideoVariantType,
  PublishPlatform,
  PlatformCopy,
} from '@/types/merchant'
import { generatePoiInjection, applyPoiToCopy } from './poi-injection-service'
import type { Store, StoreProfile, ProductOffer } from './playbook-engine'
import { asStringArray } from '@/lib/shared/prisma-json-helpers'
import { Prisma } from '@/generated/prisma'

// ========================
// LLM 配置（OpenAI 兼容接口，qwen 模型）
// ========================

/** LLM API 基址（阿里云百炼 DashScope OpenAI 兼容接口） */
const LLM_API_URL = process.env.MERCHANT_LLM_API_URL
  || (process.env.DASHSCOPE_API_KEY
    ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    : '')

/** LLM API 密钥 */
const LLM_API_KEY = process.env.MERCHANT_LLM_API_KEY
  || process.env.DASHSCOPE_API_KEY
  || ''

/** LLM 模型名称（默认 qwen-plus） */
const LLM_MODEL = process.env.MERCHANT_LLM_MODEL || 'qwen-plus'

// ========================
// Store / StoreProfile / ProductOffer 参数类型统一自 playbook-engine.ts
// ========================

// ========================
// 平台风格描述（用于 LLM prompt）
// ========================

/** 各平台的文案风格指导 */
const PLATFORM_STYLE_GUIDE: Record<string, string> = {
  DOUYIN: '短平快、带同城标签、突出价格利益点、适合快速刷屏、口语化表达、直接给出购买理由',
  XIAOHONGSHU: '体验分享风格、避免硬广、种草口吻、像闺蜜推荐一样自然、可以稍长但要有真实感受描写',
  WECHAT_CHANNELS: '简洁可信、熟人推荐语气、像微信群里朋友分享好店一样、适度克制不夸张',
  KUAISHOU: '接地气、价格利益点前置、实惠感强、生活化表达、让人看到就想去吃',
}

// ========================
// 主函数
// ========================

/**
 * 为指定内容任务生成各平台发布文案
 *
 * 按平台逐个调用 LLM 生成文案，生成后做 forbiddenClaims 二次扫描过滤。
 * 任何平台文案生成失败 → 抛错，不保存部分结果（Req 8.6）。
 *
 * @throws Error 当 LLM 配置缺失、生成失败或文案校验不通过时
 */
export async function generatePublishCopy(input: {
  contentBriefId: string
  variantType: VideoVariantType
  platforms: PublishPlatform[]
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
}): Promise<Record<PublishPlatform, PlatformCopy>> {
  const { variantType, platforms, store, profile, offer } = input

  // 配置校验
  if (!LLM_API_URL || !LLM_API_KEY) {
    throw new Error('[publish-copy] LLM 配置缺失：MERCHANT_LLM_API_URL 或 MERCHANT_LLM_API_KEY / DASHSCOPE_API_KEY 未设置')
  }

  if (!platforms.length) {
    throw new Error('[publish-copy] 平台列表不能为空')
  }

  // PROMOTION 版本必须包含 offer 信息（Req 8.4）
  if (variantType === 'PROMOTION' && !offer) {
    throw new Error('[publish-copy] PROMOTION 版本必须提供 ProductOffer 信息')
  }

  const preferredCtaList = profile.preferredCta ?? []

  // 逐平台生成文案
  const result: Partial<Record<PublishPlatform, PlatformCopy>> = {}

  for (const platform of platforms) {
    const copy = await generatePlatformCopy({
      platform,
      variantType,
      store,
      profile,
      offer,
    })

    if (!copy) {
      throw new Error(
        `[publish-copy] 平台 ${platform} 文案生成失败，无法获取完整文案`
      )
    }

    // 二次扫描过滤 forbiddenClaims（Req 8.5）
    const sanitized = sanitizeForbiddenClaims(copy, profile.forbiddenClaims ?? [])

    // CTA 必须从 preferredCta 选取（Req 8.5）
    const validatedCopy = enforcePreferredCta(sanitized, preferredCtaList)

    // 校验文案完整性
    validatePlatformCopy(validatedCopy, platform)

    result[platform] = validatedCopy
  }

  // 确保所有平台都有结果（Req 8.6）
  for (const platform of platforms) {
    if (!result[platform]) {
      throw new Error(
        `[publish-copy] 平台 ${platform} 文案缺失，不保存部分结果`
      )
    }
  }

  return result as Record<PublishPlatform, PlatformCopy>
}

// ========================
// 单平台文案生成
// ========================

/**
 * 为单个平台调用 LLM 生成文案
 *
 * 当传入 existingCopy 时进入「按平台改写」模式（需求 2.4）：把现有文案作为输入，
 * 要求 LLM 在保留核心卖点/优惠信息的前提下，按目标平台调性重写，而非凭空新作。
 */
async function generatePlatformCopy(input: {
  platform: PublishPlatform
  variantType: VideoVariantType
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
  /** 现有文案；存在时进入按平台改写模式（需求 2.4） */
  existingCopy?: PlatformCopy | null
}): Promise<PlatformCopy | null> {
  const { platform, variantType, store, profile, offer, existingCopy } = input

  const captionLimit = PLATFORM_CAPTION_LIMITS[platform as keyof typeof PLATFORM_CAPTION_LIMITS] ?? 300
  const styleGuide = PLATFORM_STYLE_GUIDE[platform] ?? '自然口语化表达'
  const forbiddenList = (profile.forbiddenClaims ?? []).join('、')
  const ctaList = (profile.preferredCta ?? []).join('、')
  const location = [store.city, store.district, store.businessArea].filter(Boolean).join(' ')

  // 构建系统 prompt
  const systemPrompt = `你是一位专业的本地生活短视频文案创作者。请严格按照要求为指定平台生成发布文案。

## 严格禁止使用的表达
以下词汇和表达绝对不能出现在任何输出中：
${forbiddenList || '（无特别限制）'}

## CTA（行动号召）必须从以下列表中选取一个
${ctaList || '点击下方链接、来店体验'}

## 输出要求
请严格按以下 JSON 格式输出，不要输出其他内容：
{
  "title": "标题，最多30个字符",
  "coverTitle": "封面文字，最多15个字符",
  "caption": "正文文案，最多${captionLimit}个字符",
  "tags": ["标签1", "标签2", ...],
  "cta": "从上方 CTA 列表选取一个"
}

## 标签要求
- 数量：3-10 个标签
- 内容：与门店行业、地理位置、当前优惠相关
- 格式：不带 # 号，纯文本

## 文案风格要求（${platform}）
${styleGuide}`

  // 构建用户 prompt
  let userPrompt = `## 门店信息
- 门店名称：${store.name}
- 行业：${store.industry}
- 位置：${location || '未提供'}
- 主打产品：${store.mainProducts.join('、')}
- 核心卖点：${store.mainSellingPoints.join('、')}
- 内容定位：${profile.contentPositioning || '未设置'}
- 推荐人设：${profile.recommendedPersona || '未设置'}

## 视频版本类型：${getVariantLabel(variantType)}`

  // PROMOTION 版本注入优惠信息（Req 8.4）
  if (offer) {
    userPrompt += `

## 优惠活动信息（必须在文案中体现）
- 活动名称：${offer.name}
- 原价：${offer.originalPrice ? `${(offer.originalPrice / 100).toFixed(0)}元` : '未设置'}
- 售价：${offer.salePrice ? `${(offer.salePrice / 100).toFixed(0)}元` : '未设置'}
- 卖点：${offer.sellingPoints?.join('、') ?? '无'}
- 使用规则：${offer.usageRules ?? '无特殊限制'}`
  }

  userPrompt += `

请为 ${platform} 平台生成发布文案，正文不超过 ${captionLimit} 个字符。`

  // POI 深度注入：注入平台原生 POI 标签、区域长尾词、团购 CTA
  const poiResult = generatePoiInjection({
    platform,
    storeName: store.name,
    industry: store.industry,
    city: store.city,
    district: store.district,
    businessArea: store.businessArea,
    hasGroupDeal: !!offer,
  })
  if (poiResult.promptSnippet) {
    userPrompt += poiResult.promptSnippet
  }

  // 按平台改写模式（需求 2.4）：注入现有文案，要求按目标平台调性重写而非凭空新作
  if (existingCopy) {
    userPrompt += `

## 待改写的现有文案（请按 ${platform} 平台调性重写，保留门店核心卖点与优惠信息，仅调整表达风格/结构/标签）
- 标题：${existingCopy.title}
- 封面文字：${existingCopy.coverTitle}
- 正文：${existingCopy.caption}
- 标签：${existingCopy.tags.join('、')}
- CTA：${existingCopy.cta}`
  }

  try {
    const response = await fetch(`${LLM_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: LLM_MAX_TOKENS,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error(
        `[publish-copy] LLM 调用失败 (${platform}): HTTP ${response.status}, body=${errText}`
      )
      return null
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      console.error(`[publish-copy] LLM 返回空内容 (${platform})`)
      return null
    }

    // 解析 JSON 输出
    const parsed = parseLLMResponse(content)
    if (!parsed) {
      console.error(`[publish-copy] LLM 输出解析失败 (${platform}): ${content.slice(0, 200)}`)
      return null
    }

    // 应用 POI 注入结果（追加区域标签、增强 CTA）
    const withPoi = applyPoiToCopy(parsed, poiResult)

    return withPoi
  } catch (error) {
    console.error(`[publish-copy] LLM 调用异常 (${platform}):`, error)
    return null
  }
}

// ========================
// 工具函数
// ========================

/**
 * 解析 LLM 返回的 JSON 文案内容
 * 容错处理：尝试从 markdown code block 或纯 JSON 中提取
 */
function parseLLMResponse(content: string): PlatformCopy | null {
  try {
    // 尝试从 markdown code block 中提取 JSON
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim()

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>

    // 校验必要字段存在
    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.coverTitle !== 'string' ||
      typeof parsed.caption !== 'string' ||
      !Array.isArray(parsed.tags) ||
      typeof parsed.cta !== 'string'
    ) {
      return null
    }

    return {
      title: String(parsed.title),
      coverTitle: String(parsed.coverTitle),
      caption: String(parsed.caption),
      tags: (parsed.tags as unknown[]).map(String),
      cta: String(parsed.cta),
    }
  } catch {
    return null
  }
}

/**
 * 强制 CTA 从 preferredCta 列表中选取（Req 8.5）
 * 如果 LLM 输出的 CTA 不在列表中，选取最匹配的或使用第一个
 */
function enforcePreferredCta(
  copy: PlatformCopy,
  preferredCtaList: string[]
): PlatformCopy {
  if (!preferredCtaList.length) return copy

  // 检查当前 CTA 是否在列表中（精确匹配或包含匹配）
  const exactMatch = preferredCtaList.find(
    cta => cta === copy.cta
  )
  if (exactMatch) return copy

  // 尝试模糊匹配（CTA 包含列表中的某项，或列表中某项包含 CTA）
  const fuzzyMatch = preferredCtaList.find(
    cta => copy.cta.includes(cta) || cta.includes(copy.cta)
  )
  if (fuzzyMatch) {
    return { ...copy, cta: fuzzyMatch }
  }

  // 无匹配，使用列表第一个
  return { ...copy, cta: preferredCtaList[0] }
}

/**
 * 二次扫描过滤 forbiddenClaims（Req 8.5）
 * 扫描所有文本字段，将匹配的违禁表达替换为空字符串
 */
function sanitizeForbiddenClaims(
  copy: PlatformCopy,
  forbiddenClaims: string[]
): PlatformCopy {
  if (!forbiddenClaims.length) return copy

  const sanitizeText = (text: string): string => {
    let result = text
    for (const claim of forbiddenClaims) {
      if (!claim) continue
      // 使用全局替换，不区分大小写
      const regex = new RegExp(escapeRegExp(claim), 'gi')
      result = result.replace(regex, '')
    }
    // 清理多余空格
    return result.replace(/\s{2,}/g, ' ').trim()
  }

  return {
    title: sanitizeText(copy.title),
    coverTitle: sanitizeText(copy.coverTitle),
    caption: sanitizeText(copy.caption),
    tags: copy.tags.map(tag => sanitizeText(tag)).filter(tag => tag.length > 0),
    cta: sanitizeText(copy.cta),
  }
}

/**
 * 校验单平台文案完整性和字数限制
 * 校验不通过时抛错（Req 8.6）
 */
function validatePlatformCopy(copy: PlatformCopy, platform: PublishPlatform): void {
  const errors: string[] = []

  // 标题校验 — max 30 chars
  if (!copy.title || copy.title.length === 0) {
    errors.push('title 为空')
  } else if (copy.title.length > 30) {
    errors.push(`title 超出 30 字符限制（当前 ${copy.title.length} 字符）`)
  }

  // 封面标题校验 — max 15 chars
  if (!copy.coverTitle || copy.coverTitle.length === 0) {
    errors.push('coverTitle 为空')
  } else if (copy.coverTitle.length > 15) {
    errors.push(`coverTitle 超出 15 字符限制（当前 ${copy.coverTitle.length} 字符）`)
  }

  // 正文校验 — 平台限制
  const captionLimit = PLATFORM_CAPTION_LIMITS[platform as keyof typeof PLATFORM_CAPTION_LIMITS] ?? 300
  if (!copy.caption || copy.caption.length === 0) {
    errors.push('caption 为空')
  } else if (copy.caption.length > captionLimit) {
    errors.push(
      `caption 超出 ${platform} 平台 ${captionLimit} 字符限制（当前 ${copy.caption.length} 字符）`
    )
  }

  // 标签校验 — 3-10 个
  if (!copy.tags || copy.tags.length < 3) {
    errors.push(`tags 数量不足（最少 3 个，当前 ${copy.tags?.length ?? 0} 个）`)
  } else if (copy.tags.length > 10) {
    errors.push(`tags 数量超限（最多 10 个，当前 ${copy.tags.length} 个）`)
  }

  // CTA 校验 — 不能为空
  if (!copy.cta || copy.cta.length === 0) {
    errors.push('cta 为空')
  }

  if (errors.length > 0) {
    throw new Error(
      `[publish-copy] 平台 ${platform} 文案校验失败: ${errors.join('; ')}`
    )
  }
}

/**
 * 获取视频版本类型的中文标签
 */
function getVariantLabel(variantType: VideoVariantType): string {
  const labels: Record<string, string> = {
    PROMOTION: '促销引流版（突出价格优惠和限时活动）',
    ATMOSPHERE: '氛围种草版（展示门店环境和用餐体验）',
    OWNER_TALKING: '老板口播版（老板/厨师真人推荐）',
    TRUST: '信任背书版（展示资质和顾客评价）',
    PRODUCT: '产品展示版（突出菜品特色和制作过程）',
  }
  return labels[variantType] ?? variantType
}

/**
 * 转义正则特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================
// 就地保存 / 重新生成 / 按平台改写（local-life-depth-enhancements 需求 2.1/2.2/2.4）
//
// 计费一致性（需求 0.6/0.7/0.8）：消耗积分的动作（重新生成文案 / 按平台改写）统一复用既有
// credit-service（reserve→charge/refund）+ withCreditLock 全局锁；执行外部 LLM 推理前先做
// 余额预检（不足显式抛 INSUFFICIENT_CREDITS，禁止先扣后退），绝不在 withCreditLock 内重入。
//
// 人工修改标记保护（需求 2.3/2.8）：目标 brief.copyEdited=true 且未 confirmOverwrite 时
// 抛 CONFIRM_OVERWRITE_REQUIRED 需确认，不替换文案、不清除标记；仅当 confirmOverwrite=true
// 或 copyEdited=false 时方可替换，并在替换后清除标记（置 copyEdited=false）。
// ============================================================

/** Prisma Json 数组字段安全转 string[]（复用共享 helper，非数组时返回空数组） */

/** 文案上下文：从 ContentBrief 装配 LLM 生成所需的门店 / 画像 / 优惠信息 */
interface CopyContext {
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
  variantType: VideoVariantType
  /** 现有平台文案（用于按平台改写模式的输入，可能不存在） */
  existingCopy: PlatformCopy | null
  /** 该 brief 是否已被人工编辑（人工修改标记） */
  copyEdited: boolean
}

/**
 * 装配指定 brief + 平台的文案生成上下文。
 *
 * 从 ContentBrief 读取关联门店与画像；存在 offerId 时加载优惠并采用 PROMOTION 版本类型
 * （PROMOTION 必须含 offer），否则采用 ATMOSPHERE。画像缺失时显式抛错（无 fallback）。
 */
async function loadCopyContext(
  contentBriefId: string,
  platform: PublishPlatform
): Promise<CopyContext> {
  const brief = await prisma.contentBrief.findUniqueOrThrow({
    where: { id: contentBriefId },
    include: { store: { include: { profile: true } } },
  })

  if (!brief.store.profile) {
    throw new ApiError(
      'NOT_FOUND',
      `[publish-copy] 门店画像缺失，无法生成文案：storeId=${brief.storeId}`,
      404
    )
  }

  // 加载关联优惠（若有）；PROMOTION 版本必须携带 offer
  let offer: ProductOffer | undefined
  if (brief.offerId) {
    const offerRow = await prisma.productOffer.findUnique({ where: { id: brief.offerId } })
    if (offerRow) {
      offer = {
        id: offerRow.id,
        storeId: offerRow.storeId,
        name: offerRow.name,
        description: offerRow.description,
        originalPrice: offerRow.originalPrice,
        salePrice: offerRow.salePrice,
        sellingPoints: asStringArray(offerRow.sellingPoints),
        usageRules: offerRow.usageRules,
        isActive: offerRow.isActive,
      }
    }
  }

  const variantType: VideoVariantType = offer ? 'PROMOTION' : 'ATMOSPHERE'

  const store: Store = {
    id: brief.store.id,
    name: brief.store.name,
    industry: brief.store.industry,
    city: brief.store.city,
    district: brief.store.district,
    businessArea: brief.store.businessArea,
    address: brief.store.address ?? null,
    mainProducts: asStringArray(brief.store.mainProducts),
    mainSellingPoints: asStringArray(brief.store.mainSellingPoints),
    canShootKitchen: brief.store.canShootKitchen,
    canShootStaff: brief.store.canShootStaff,
    canShootCustomers: brief.store.canShootCustomers,
  }

  const profile: StoreProfile = {
    id: brief.store.profile.id,
    storeId: brief.store.profile.storeId,
    contentPositioning: brief.store.profile.contentPositioning,
    recommendedPersona: brief.store.profile.recommendedPersona,
    hookKeywords: asStringArray(brief.store.profile.hookKeywords),
    forbiddenClaims: asStringArray(brief.store.profile.forbiddenClaims),
    preferredCta: asStringArray(brief.store.profile.preferredCta),
    contentDos: asStringArray(brief.store.profile.contentDos),
    contentDonts: asStringArray(brief.store.profile.contentDonts),
  }

  // 读取该平台现有文案（按平台改写模式的输入）
  const platformCopies = (brief.platformCopies as Record<string, PlatformCopy> | null) ?? {}
  const existingCopy = platformCopies[platform] ?? null

  return { store, profile, offer, variantType, existingCopy, copyEdited: brief.copyEdited }
}

/**
 * 对 LLM 原始文案做与 generatePublishCopy 一致的后处理：
 * forbiddenClaims 二次扫描过滤 → CTA 强制取自 preferredCta → 完整性/字数校验。
 */
function postProcessCopy(
  raw: PlatformCopy,
  platform: PublishPlatform,
  profile: StoreProfile
): PlatformCopy {
  const sanitized = sanitizeForbiddenClaims(raw, profile.forbiddenClaims ?? [])
  const withCta = enforcePreferredCta(sanitized, profile.preferredCta ?? [])
  validatePlatformCopy(withCta, platform)
  return withCta
}

/**
 * 重新生成 / 按平台改写的统一计费 + 落库流程（消耗积分）。
 *
 * 流程（严格遵循需求 0.6/0.7/0.8 计费一致性）：
 * 1) 人工修改标记保护：copyEdited=true 且未确认覆盖 → 抛 CONFIRM_OVERWRITE_REQUIRED（不动文案/标记）；
 * 2) 余额预检：余额 < 单价 → 抛 INSUFFICIENT_CREDITS，绝不 reserve、绝不调用 LLM（禁止先扣后退）；
 * 3) RESERVE 冻结积分（经 credit-service + withCreditLock；关联键用唯一 opKey，避免与渲染冻结串键）；
 * 4) 调用真实 LLM 生成/改写文案，无 fallback；返回空则抛错触发退款；
 * 5) 成功：同事务内替换 platformCopies[platform]、清除 copyEdited 标记、CHARGE 实扣；
 * 6) 失败：按 opKey 幂等 REFUND 全额退还，错误向上抛出（不静默）。
 *
 * @param mode 'GENERATE' 重新生成（需求 2.2）｜'REWRITE' 按平台改写（需求 2.4）
 */
async function produceCopyWithCredits(input: {
  contentBriefId: string
  platform: PublishPlatform
  userId: string
  confirmOverwrite: boolean
  mode: 'GENERATE' | 'REWRITE'
}): Promise<{ preview: PlatformCopy }> {
  const { contentBriefId, platform, userId, confirmOverwrite, mode } = input

  if (!LLM_API_URL || !LLM_API_KEY) {
    throw new Error('[publish-copy] LLM 配置缺失：MERCHANT_LLM_API_URL 或 MERCHANT_LLM_API_KEY / DASHSCOPE_API_KEY 未设置')
  }

  const ctx = await loadCopyContext(contentBriefId, platform)

  // Step 1: 人工修改标记保护（需求 2.3/2.8）——未确认覆盖则需确认，不动文案与标记
  if (ctx.copyEdited && !confirmOverwrite) {
    throw new ApiError(
      'CONFIRM_OVERWRITE_REQUIRED',
      '当前文案存在人工修改，重新生成/按平台改写将覆盖人工修改内容，请确认后重试',
      409
    )
  }

  // 按平台改写模式必须有现有文案作为输入（需求 2.4）
  if (mode === 'REWRITE' && !ctx.existingCopy) {
    throw new ApiError(
      'NOT_FOUND',
      `[publish-copy] 平台 ${platform} 暂无现有文案，无法按平台改写，请先生成文案`,
      404
    )
  }

  const cost = CREDIT_COST_COPY_REWRITE

  // Step 2: 余额预检（需求 0.7）——不足在预检阶段显式拒绝，绝不 reserve、绝不调用 LLM
  const balance = await getBalance(userId)
  if (balance < cost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：本次文案操作需 ${cost} 积分，当前余额 ${balance}`,
      402
    )
  }

  // 唯一计费关联键：避免与同一 brief 的渲染冻结（CONTENT_BRIEF + briefId）撞键导致幂等误跳过
  const opKey = `copy:${contentBriefId}:${platform}:${randomUUID()}`
  const remark = `[MERCHANT_COPY] ${mode === 'REWRITE' ? '按平台改写' : '重新生成'}文案冻结 ${cost} 积分（${platform}）`

  // Step 3: RESERVE 冻结（消耗外部资源前真实冻结，经 withCreditLock 全局锁串行化）
  await reserveMerchantCredits({
    userId,
    bizRefType: 'CONTENT_BRIEF',
    bizRefId: opKey,
    amount: cost,
    remark,
  })

  try {
    // Step 4: 调用真实 LLM 生成/改写文案（无 fallback）
    const raw = await generatePlatformCopy({
      platform,
      variantType: ctx.variantType,
      store: ctx.store,
      profile: ctx.profile,
      offer: ctx.offer,
      existingCopy: mode === 'REWRITE' ? ctx.existingCopy : null,
    })

    if (!raw) {
      throw new Error(`[publish-copy] 平台 ${platform} 文案${mode === 'REWRITE' ? '改写' : '生成'}失败，未获取到有效文案`)
    }

    const preview = postProcessCopy(raw, platform, ctx.profile)

    // Step 5: 成功——同事务内替换文案、清除人工修改标记、CHARGE 实扣
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.contentBrief.findUniqueOrThrow({
        where: { id: contentBriefId },
        select: { platformCopies: true },
      })
      const copies = (fresh.platformCopies as Record<string, PlatformCopy> | null) ?? {}
      copies[platform] = preview
      await tx.contentBrief.update({
        where: { id: contentBriefId },
        // 替换后清除人工修改标记（新文案为 AI 产出，不再视为人工修改）
        data: { platformCopies: copies as unknown as Prisma.InputJsonValue, copyEdited: false },
      })
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: opKey,
        actualAmount: cost,
      })
    })

    return { preview }
  } catch (error) {
    // Step 6: 失败——按 opKey 幂等全额退款（不静默），原始错误向上抛出
    try {
      await refundMerchantCredits({ userId, bizRefType: 'CONTENT_BRIEF', bizRefId: opKey })
    } catch (refundErr) {
      console.error('[publish-copy] 文案操作失败退款异常:', refundErr)
    }
    throw error
  }
}

/**
 * 就地保存人工编辑的平台文案（需求 2.1, 2.8）。
 *
 * 将商家手工编辑的标题/正文/标签/CTA 原样写回 ContentBrief.platformCopies[platform]，
 * 并置 copyEdited=true（人工修改标记）。后续自动流程不得静默覆盖该文案（需求 2.8），
 * 仅在显式二次确认（confirmOverwrite=true）后方可被重新生成/按平台改写替换并清除标记。
 *
 * 纯写库，不消耗积分。原样保存（不做违禁词过滤/CTA 强制等改写），保证编辑往返一致。
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.platform 目标平台
 * @param input.copy 人工编辑后的平台文案
 */
export async function saveManualCopy(input: {
  contentBriefId: string
  platform: PublishPlatform
  copy: PlatformCopy
}): Promise<void> {
  const { contentBriefId, platform, copy } = input

  await prisma.$transaction(async (tx) => {
    const brief = await tx.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      select: { platformCopies: true },
    })
    const copies = (brief.platformCopies as Record<string, PlatformCopy> | null) ?? {}
    // 原样写回（不改写），保证 saveManualCopy 后读取等于入参（编辑往返一致）
    copies[platform] = copy
    await tx.contentBrief.update({
      where: { id: contentBriefId },
      data: { platformCopies: copies as unknown as Prisma.InputJsonValue, copyEdited: true },
    })
  })
}

/**
 * 重新生成文案（需求 2.2）。基于 StoreProfile + brief 上下文调用真实 LLM 产出新文案，
 * 替换 platformCopies[platform] 并清除人工修改标记，返回新文案供前端展示采纳。
 *
 * 消耗积分：经 credit-service（reserve→charge/refund）+ withCreditLock 全局锁，先做余额预检
 * （不足抛 INSUFFICIENT_CREDITS，禁止先扣后退）。目标 copyEdited=true 且未 confirmOverwrite 时
 * 抛 CONFIRM_OVERWRITE_REQUIRED 需确认，不覆盖（需求 2.3）。
 *
 * @param input.confirmOverwrite 覆盖人工修改的显式确认（需求 2.3）
 */
export async function regenerateCopy(input: {
  contentBriefId: string
  platform: PublishPlatform
  userId: string
  confirmOverwrite: boolean
}): Promise<{ preview: PlatformCopy }> {
  return produceCopyWithCredits({ ...input, mode: 'GENERATE' })
}

/**
 * 按平台调性改写文案（需求 2.4）。以现有平台文案为输入，按抖音/小红书/视频号等平台调性
 * 重写（保留门店核心卖点与优惠信息），替换 platformCopies[platform] 并清除人工修改标记。
 *
 * 消耗积分：同 regenerateCopy 计费链路与余额预检；覆盖人工修改同样需 confirmOverwrite（需求 2.3）。
 */
export async function rewriteForPlatform(input: {
  contentBriefId: string
  platform: PublishPlatform
  userId: string
  confirmOverwrite: boolean
}): Promise<{ preview: PlatformCopy }> {
  return produceCopyWithCredits({ ...input, mode: 'REWRITE' })
}
