/**
 * POI（兴趣点）深度注入服务
 *
 * 为发布文案生成平台原生的 POI 标签、区域长尾词和团购 CTA 关联：
 * - 平台原生 POI 标签（抖音 POI、快手位置、小红书地标等）
 * - 区域长尾关键词（城市+区域+商圈+行业 组合）
 * - 团购链接 CTA 增强（在已有 CTA 基础上注入团购引导语）
 *
 * 设计原则：
 * - POI 注入是增强型，不覆盖原有文案策略
 * - 各平台 POI 格式不同，按平台适配
 * - 区域长尾词自然融入标签和正文，不堆砌
 */

import type { PublishPlatform, PlatformCopy } from '@/types/merchant'

// ========================
// 类型
// ========================

/** POI 注入输入 */
export interface PoiInjectionInput {
  /** 目标平台 */
  platform: PublishPlatform
  /** 门店名称 */
  storeName: string
  /** 行业 */
  industry: string
  /** 城市 */
  city: string | null
  /** 区县 */
  district: string | null
  /** 商圈 */
  businessArea: string | null
  /** 详细地址（可选） */
  address?: string | null
  /** 是否有团购/优惠链接 */
  hasGroupDeal?: boolean
  /** 团购链接/小程序路径（可选） */
  groupDealUrl?: string | null
}

/** POI 注入结果 */
export interface PoiInjectionResult {
  /** 平台原生 POI 标签（用于发布时选择 POI 定位） */
  poiTag: string | null
  /** 区域长尾标签（追加到 tags 列表） */
  regionalTags: string[]
  /** 区域长尾关键词（建议融入正文） */
  regionalKeywords: string[]
  /** 增强的 CTA 文案（含团购引导） */
  enhancedCta: string | null
  /** POI 注入的 prompt 片段（供 LLM 文案生成时注入） */
  promptSnippet: string
}

// ========================
// 主入口
// ========================

/**
 * 生成 POI 注入内容
 *
 * @param input POI 注入参数
 * @returns POI 注入结果（POI 标签 + 区域长尾词 + 增强 CTA + prompt 片段）
 */
export function generatePoiInjection(input: PoiInjectionInput): PoiInjectionResult {
  const { platform, storeName, industry, city, district, businessArea, hasGroupDeal } = input

  // 1. 生成平台原生 POI 标签
  const poiTag = generatePoiTag({ platform, storeName, city, district, businessArea })

  // 2. 生成区域长尾标签
  const regionalTags = generateRegionalTags({ city, district, businessArea, industry, storeName })

  // 3. 生成区域长尾关键词
  const regionalKeywords = generateRegionalKeywords({ city, district, businessArea, industry })

  // 4. 增强 CTA（团购引导）
  const enhancedCta = hasGroupDeal
    ? generateGroupDealCta(platform)
    : null

  // 5. 生成 LLM prompt 注入片段
  const promptSnippet = buildPoiPromptSnippet({
    platform,
    poiTag,
    regionalTags,
    regionalKeywords,
    enhancedCta,
    storeName,
    city,
    district,
  })

  return {
    poiTag,
    regionalTags,
    regionalKeywords,
    enhancedCta,
    promptSnippet,
  }
}

// ========================
// 平台原生 POI 标签
// ========================

function generatePoiTag(params: {
  platform: PublishPlatform
  storeName: string
  city: string | null
  district: string | null
  businessArea: string | null
}): string | null {
  const { platform, storeName, city, district } = params

  switch (platform) {
    case 'DOUYIN':
      // 抖音 POI 格式：城市+门店名（如 "北京·海底捞火锅(望京SOHO店)"）
      return city ? `${city}·${storeName}` : storeName

    case 'KUAISHOU':
      // 快手位置格式：城市+区县+门店名
      return [city, district, storeName].filter(Boolean).join(' ')

    case 'XIAOHONGSHU':
      // 小红书地标格式：城市+商圈/门店（如 "北京三里屯·XX餐厅"）
      return params.businessArea
        ? `${city ?? ''}${params.businessArea}·${storeName}`
        : `${city ?? ''}·${storeName}`

    case 'WECHAT_CHANNELS':
      // 视频号位置格式：直接门店名（视频号 POI 基于微信位置库）
      return storeName

    default:
      return null
  }
}

// ========================
// 区域长尾标签
// ========================

function generateRegionalTags(params: {
  city: string | null
  district: string | null
  businessArea: string | null
  industry: string
  storeName: string
}): string[] {
  const { city, district, businessArea, industry } = params
  const tags: string[] = []

  const industryLabels = getIndustryLabels(industry)

  // 城市 + 行业（如 "北京火锅"）
  if (city) {
    for (const label of industryLabels) {
      tags.push(`${city}${label}`)
    }
  }

  // 区县 + 行业（如 "朝阳区火锅"）
  if (district) {
    for (const label of industryLabels.slice(0, 2)) {
      tags.push(`${district}${label}`)
    }
  }

  // 商圈标签（如 "三里屯美食"）
  if (businessArea) {
    tags.push(`${businessArea}${industryLabels[0] ?? '探店'}`)
    tags.push(`${businessArea}推荐`)
  }

  // 同城标签
  if (city) {
    tags.push(`${city}同城`)
    tags.push(`${city}探店`)
  }

  return [...new Set(tags)] // 去重
}

// ========================
// 区域长尾关键词
// ========================

function generateRegionalKeywords(params: {
  city: string | null
  district: string | null
  businessArea: string | null
  industry: string
}): string[] {
  const { city, district, businessArea, industry } = params
  const keywords: string[] = []

  const industryLabels = getIndustryLabels(industry)

  // "城市+区域+行业+推荐" 组合
  if (city && district) {
    keywords.push(`${city}${district}${industryLabels[0] ?? '推荐'}`)
  }

  // "区域+商圈+行业" 组合
  if (district && businessArea) {
    keywords.push(`${district}${businessArea}${industryLabels[0] ?? '探店'}`)
  }

  // "城市+行业+排行/攻略" 长尾
  if (city) {
    keywords.push(`${city}${industryLabels[0] ?? '美食'}推荐`)
    keywords.push(`${city}${industryLabels[0] ?? '美食'}排行`)
  }

  return [...new Set(keywords)]
}

// ========================
// 团购 CTA 增强
// ========================

function generateGroupDealCta(platform: PublishPlatform): string | null {
  switch (platform) {
    case 'DOUYIN':
      return '点击左下角链接抢购团购优惠'
    case 'KUAISHOU':
      return '点击下方小黄车下单'
    case 'XIAOHONGSHU':
      return '收藏+关注，主页有团购链接哦'
    case 'WECHAT_CHANNELS':
      return '点击下方链接预约'
    default:
      return null
  }
}

// ========================
// LLM Prompt 注入片段
// ========================

function buildPoiPromptSnippet(params: {
  platform: PublishPlatform
  poiTag: string | null
  regionalTags: string[]
  regionalKeywords: string[]
  enhancedCta: string | null
  storeName: string
  city: string | null
  district: string | null
}): string {
  const { poiTag, regionalTags, regionalKeywords, enhancedCta, storeName, city, district } = params

  let snippet = ''

  // POI 定位注入
  if (poiTag) {
    snippet += `\n## POI 定位\n- 发布时请选择位置：${poiTag}\n`
  }

  // 区域长尾标签注入
  if (regionalTags.length > 0) {
    snippet += `\n## 区域标签（请从中选取 2-4 个融入标签列表）\n${regionalTags.map(t => `- ${t}`).join('\n')}\n`
  }

  // 区域关键词注入
  if (regionalKeywords.length > 0) {
    snippet += `\n## 区域长尾关键词（请自然融入正文，不堆砌）\n${regionalKeywords.map(k => `- ${k}`).join('\n')}\n`
  }

  // 团购 CTA 注入
  if (enhancedCta) {
    snippet += `\n## 团购引导\n- 本门店有团购优惠，请在正文末尾自然引导用户点击团购链接\n- 推荐引导语：${enhancedCta}\n`
  }

  return snippet
}

// ========================
// 行业标签映射
// ========================

function getIndustryLabels(industry: string): string[] {
  const mapping: Record<string, string[]> = {
    RESTAURANT: ['美食', '餐厅', '好吃'],
    DRINK: ['饮品', '奶茶', '好喝'],
    BAKERY: ['烘焙', '面包', '甜品'],
    CAFE: ['咖啡', '下午茶', '甜品'],
    HOTPOT: ['火锅', '涮锅', '好吃'],
    BBQ: ['烧烤', '烤串', '夜宵'],
    FAST_FOOD: ['快餐', '简餐', '实惠'],
    OTHER_LOCAL: ['探店', '推荐'],
  }
  return mapping[industry] ?? ['探店', '推荐']
}

// ========================
// 辅助：将 POI 注入应用到已有 PlatformCopy
// ========================

/**
 * 将 POI 注入结果应用到已有的 PlatformCopy 上
 *
 * - 追加区域标签到 tags 列表（不超过平台限制）
 * - 如果有 enhancedCta，替换原有 CTA（仅在文案不含团购引导时）
 *
 * @param copy 原有文案
 * @param poiResult POI 注入结果
 * @param maxTags 平台最大标签数（默认 10）
 */
export function applyPoiToCopy(
  copy: PlatformCopy,
  poiResult: PoiInjectionResult,
  maxTags = 10,
): PlatformCopy {
  let updated = { ...copy }

  // 追加区域标签（保留原有标签，追加至上限）
  if (poiResult.regionalTags.length > 0) {
    const existingTags = new Set(updated.tags)
    const newTags = [...updated.tags]
    for (const tag of poiResult.regionalTags) {
      if (newTags.length >= maxTags) break
      if (!existingTags.has(tag)) {
        newTags.push(tag)
        existingTags.add(tag)
      }
    }
    updated = { ...updated, tags: newTags }
  }

  // 增强 CTA（仅在原有 CTA 不含团购关键词时替换）
  if (poiResult.enhancedCta && !hasGroupDealKeywords(updated.cta)) {
    updated = { ...updated, cta: poiResult.enhancedCta }
  }

  return updated
}

function hasGroupDealKeywords(cta: string): boolean {
  return /团购|优惠|抢购|下单|链接|小黄车/.test(cta)
}
