/**
 * 发布文案生成服务 — 按平台生成标题、封面、正文、标签和 CTA
 *
 * 使用 LLM（qwen）按平台分别生成文案，prompt 中注入门店信息、违禁表达、
 * 首选 CTA 和优惠信息。生成后对 forbiddenClaims 做二次扫描过滤。
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { PLATFORM_CAPTION_LIMITS } from '@/constants/merchant'
import type {
  VideoVariantType,
  PublishPlatform,
  PlatformCopy,
} from '@/types/merchant'

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
// 类型定义（Prisma 模型运行时类型别名，仅文案服务所需字段）
// ========================

/** 门店基本信息 */
export interface Store {
  id: string
  name: string
  industry: string
  city: string | null
  district: string | null
  businessArea: string | null
  mainProducts: string[]
  mainSellingPoints: string[]
}

/** 门店画像信息 */
export interface StoreProfile {
  id: string
  storeId: string
  contentPositioning: string | null
  recommendedPersona: string | null
  hookKeywords: string[] | null
  forbiddenClaims: string[] | null
  preferredCta: string[] | null
}

/** 商品/优惠信息 */
export interface ProductOffer {
  id: string
  name: string
  description: string | null
  originalPrice: number | null
  salePrice: number | null
  sellingPoints: string[] | null
  usageRules: string | null
}

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
 */
async function generatePlatformCopy(input: {
  platform: PublishPlatform
  variantType: VideoVariantType
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
}): Promise<PlatformCopy | null> {
  const { platform, variantType, store, profile, offer } = input

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
        max_tokens: 2000,
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

    return parsed
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
