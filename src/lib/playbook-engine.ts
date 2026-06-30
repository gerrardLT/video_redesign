/**
 * 行业剧本引擎
 *
 * 根据门店画像和内容目标选择合适的剧本集，并将剧本模板实例化为具体的 ContentBrief 数据。
 * LLM 调用使用 OpenAI 兼容接口（qwen 模型），失败时降级为模板原文（不静默，记录错误日志）。
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { prisma } from '@/lib/db'
import { MAX_CONSECUTIVE_PLAYBOOK_USE } from '@/constants/merchant'
import type {
  MerchantIndustry,
  ContentGoal,
  ContentBriefDraft,
  ShotTaskDraft,
  ShotTaskType,
  PlatformCopy,
  PublishPlatform,
} from '@/types/merchant'

// ========================
// 类型定义（Prisma 模型的运行时类型别名）
// ========================

/** Prisma Playbook 模型运行时类型 */
export interface Playbook {
  id: string
  industry: MerchantIndustry
  name: string
  goal: ContentGoal
  description: string | null
  structure: PlaybookSegment[]
  requiredShots: ShotTaskType[]
  optionalShots: ShotTaskType[] | null
  hookTemplates: string[]
  captionTemplates: string[]
  coverTitleTemplates: string[]
  ctaTemplates: string[]
  complianceRules: Record<string, unknown> | null
  scoreWeight: { views: number; conversion: number } | null
  tierRequired: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** 剧本结构段定义 */
export interface PlaybookSegment {
  name: string
  purpose: string
  durationSec: number
}

/** 溯源引用所属的画像字段（需求 5.1, 5.2） */
export type ProvenanceField = 'sellingPoint' | 'hookKeyword' | 'persona' | 'cta'

/** 溯源引用被使用的位置 */
export type ProvenanceUsedIn = 'hook' | 'caption' | 'title' | 'cta' | 'shot'

/**
 * 内容任务溯源结构体（生成时快照，落库到 ContentBrief.provenance）
 *
 * 记录本条 brief 在剧本实例化时实际引用了门店画像的哪些依据，用于前端「可解释」展示。
 * - references 每条 value 必须来自画像真实取值集合（卖点/钩子词/人设/CTA），绝不伪造（需求 5.1, 5.2）
 * - 无任何画像引用时 isGenericTemplate=true，前端如实显示「通用模板」（需求 5.6）
 */
export interface BriefProvenance {
  /** 本条 brief 引用的画像依据（需求 5.1, 5.2） */
  references: {
    /** 引用的画像字段类别 */
    field: ProvenanceField
    /** 实际引用的画像内容，如「现熬8小时骨汤」 */
    value: string
    /** 引用被用在哪里 */
    usedIn: ProvenanceUsedIn
    /** 通俗话术（不暴露字段名），如「这条用了你的招牌『现熬8小时骨汤』」 */
    plainText: string
  }[]
  /** 无任何画像引用时为 true → 前端显示「通用模板」（需求 5.6），不伪造 */
  isGenericTemplate: boolean
}

/** Prisma Store 模型简化类型（仅剧本引擎所需字段） */
export interface Store {
  id: string
  name: string
  industry: MerchantIndustry
  city: string | null
  district: string | null
  businessArea: string | null
  address: string | null
  mainProducts: string[]
  mainSellingPoints: string[]
  canShootKitchen: boolean
  canShootStaff: boolean
  canShootCustomers: boolean
}

/** Prisma StoreProfile 模型简化类型 */
export interface StoreProfile {
  id: string
  storeId: string
  contentPositioning: string | null
  recommendedPersona: string | null
  hookKeywords: string[] | null
  forbiddenClaims: string[] | null
  preferredCta: string[] | null
  contentDos: string[] | null
  contentDonts: string[] | null
}

/** Prisma ProductOffer 模型简化类型 */
export interface ProductOffer {
  id: string
  storeId: string
  name: string
  description: string | null
  originalPrice: number | null
  salePrice: number | null
  sellingPoints: string[] | null
  usageRules: string | null
  isActive: boolean
}

// ========================
// LLM 配置（OpenAI 兼容接口，qwen 模型）
// ========================

/** LLM API 基址（阿里云百炼 DashScope OpenAI 兼容接口） */
const LLM_API_URL = process.env.MERCHANT_LLM_API_URL
  || process.env.VISION_API_URL
  || ''

/** LLM API 密钥 */
const LLM_API_KEY = process.env.MERCHANT_LLM_API_KEY
  || process.env.DASHSCOPE_API_KEY
  || process.env.VISION_API_KEY
  || ''

/** LLM 模型名称（默认 qwen-plus） */
const LLM_MODEL = process.env.MERCHANT_LLM_MODEL || 'qwen-plus'

// ========================
// 镜头类型与拍摄能力的映射
// ========================

/** 需要特定拍摄能力的镜头类型映射 */
const SHOT_CAPABILITY_MAP: Record<ShotTaskType, keyof Store | null> = {
  COOKING_PROCESS: 'canShootKitchen',
  STAFF_ACTION: 'canShootStaff',
  CUSTOMER_REACTION: 'canShootCustomers',
  OWNER_TALKING: 'canShootStaff',
  STOREFRONT: null,
  PRODUCT_CLOSEUP: null,
  ENVIRONMENT: null,
  OFFER_DISPLAY: null,
  CTA_SCREEN: null,
  AI_GENERATED_FILLER: null,
}

// ========================
// selectPlaybooks — 剧本选择算法
// ========================

/**
 * 根据门店画像和内容目标选择合适的剧本集
 *
 * 选择算法：
 * 1. 从 DB 查询 industry + isActive=true 的所有 Playbook
 * 2. 按 ContentGoal 分组
 * 3. 过滤掉需要不可用拍摄能力的剧本
 * 4. 按 scoreWeight 加权排序
 * 5. 确保同一剧本不连续使用超过 3 次（查最近 3 个 ContentBrief 的 playbookId）
 * 6. 如指定 goal 无匹配，fallback 到最高分可用剧本
 * 7. 排除 excludePlaybookIds（来自 performance-learning 避免列表）
 */
export async function selectPlaybooks(input: {
  industry: MerchantIndustry
  goals: ContentGoal[]
  storeProfile: StoreProfile
  offers: ProductOffer[]
  days: number
  excludePlaybookIds?: string[]
  // 复用权重名单（需求 1.3）：来自上轮复盘建议「复用剧本」，命中的剧本在同 goal 候选中优先选用
  preferredPlaybookIds?: string[]
}): Promise<Playbook[]> {
  const { industry, goals, storeProfile, offers, days, excludePlaybookIds = [], preferredPlaybookIds = [] } = input

  // 1. 从 DB 查询该行业所有激活的剧本
  const rawPlaybooks = await prisma.playbook.findMany({
    where: {
      industry,
      isActive: true,
    },
  })

  // 转为类型安全的 Playbook 对象
  const allPlaybooks: Playbook[] = rawPlaybooks.map(castPlaybook)

  // 7. 排除 performance-learning 建议避免的剧本
  const availablePlaybooks = allPlaybooks.filter(
    (pb) => !excludePlaybookIds.includes(pb.id)
  )

  // 3. 过滤掉需要不可用拍摄能力的剧本（仅过滤必拍镜头）
  const store: Pick<Store, 'canShootKitchen' | 'canShootStaff' | 'canShootCustomers'> = {
    canShootKitchen: storeProfile.contentDos?.some(d => d.includes('厨房')) ?? false,
    canShootStaff: true, // 默认可以拍员工
    canShootCustomers: false,
  }
  // 使用 storeProfile 关联的 store 拍摄能力，需要从 storeProfile.storeId 查询
  const storeRecord = await prisma.store.findUnique({
    where: { id: storeProfile.storeId },
    select: { canShootKitchen: true, canShootStaff: true, canShootCustomers: true },
  })
  if (storeRecord) {
    store.canShootKitchen = storeRecord.canShootKitchen
    store.canShootStaff = storeRecord.canShootStaff
    store.canShootCustomers = storeRecord.canShootCustomers
  }

  const capablePlaybooks = availablePlaybooks.filter((pb) =>
    isPlaybookCompatible(pb, store)
  )

  // 5. 查询最近 3 个 ContentBrief 的 playbookId，防止连续重复使用
  const recentBriefs = await prisma.contentBrief.findMany({
    where: { storeId: storeProfile.storeId },
    orderBy: { scheduledDate: 'desc' },
    take: MAX_CONSECUTIVE_PLAYBOOK_USE,
    select: { playbookId: true },
  })
  const recentPlaybookIds = recentBriefs.map((b) => b.playbookId).filter(Boolean) as string[]

  // 按 goal 为每天选择剧本
  const selectedPlaybooks: Playbook[] = []
  // 跟踪本次选择中连续使用同一剧本的次数
  const consecutiveTracker: string[] = [...recentPlaybookIds]

  for (let i = 0; i < days; i++) {
    const goal = goals[i % goals.length]

    // 2. 按 ContentGoal 分组筛选
    let candidates = capablePlaybooks.filter((pb) => pb.goal === goal)

    // 6. 如指定 goal 无匹配，fallback 到最高分可用剧本
    if (candidates.length === 0) {
      candidates = [...capablePlaybooks]
    }

    if (candidates.length === 0) {
      // 无可用剧本，跳过（理论上不应发生，种子数据保证覆盖）
      continue
    }

    // 4. 按 scoreWeight 加权排序（views + conversion 之和，越高越优先）
    const sorted = sortByScoreWeight(candidates, offers)

    // 4.1 复用权重（需求 1.3）：上轮复盘采纳的「复用剧本」在同 goal 候选中前置，
    //     保持原有评分次序作为次级排序，命中名单者整体提到队首
    const reuseBoosted = preferredPlaybookIds.length > 0
      ? [
          ...sorted.filter((pb) => preferredPlaybookIds.includes(pb.id)),
          ...sorted.filter((pb) => !preferredPlaybookIds.includes(pb.id)),
        ]
      : sorted

    // 5. 排除连续使用超过 MAX_CONSECUTIVE_PLAYBOOK_USE 次的剧本
    const selected = pickNonConsecutive(reuseBoosted, consecutiveTracker)

    if (selected) {
      selectedPlaybooks.push(selected)
      consecutiveTracker.push(selected.id)
    } else {
      // 所有剧本都连续使用超限，取最高分的
      selectedPlaybooks.push(reuseBoosted[0])
      consecutiveTracker.push(reuseBoosted[0].id)
    }
  }

  return selectedPlaybooks
}

// ========================
// instantiatePlaybook — 剧本实例化
// ========================

/**
 * 将剧本模板实例化为具体的 ContentBrief 数据
 *
 * 实例化逻辑：
 * - 模板变量替换：{storeName}, {productName}, {price}, {cta}, {location},
 *   {originalPrice}, {discount}, {sellingPoint}
 * - 使用 LLM（qwen）润色 hook 和 caption，确保自然且不违规
 * - 生成 ShotTask 时使用日常用语描述（不用专业术语）
 * - 返回 ContentBriefDraft 类型
 *
 * 注意：内部委托给 instantiatePlaybookWithProvenance，仅返回 draft（保持向后兼容）。
 */
export async function instantiatePlaybook(input: {
  playbook: Playbook
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
  scheduledDate: Date
}): Promise<ContentBriefDraft> {
  const { draft } = await instantiatePlaybookWithProvenance(input)
  return draft
}

/**
 * 将剧本模板实例化为 ContentBrief 数据，同时记录画像引用溯源（需求 5.1, 5.2, 5.6）
 *
 * 在 instantiatePlaybook 的基础上，于「生成时」记录本条 brief 实际引用了门店画像的哪些依据：
 * - 仅当模板真实引用了画像取值（卖点/钩子词/人设/CTA）才记录，value 必属于对应取值集合，绝不伪造
 * - 每条引用附带通俗话术 plainText（不暴露字段名），供前端「可解释」展示
 * - 无任何引用时 isGenericTemplate=true，前端如实显示「通用模板」（需求 5.6）
 *
 * 返回的 provenance 由调用方落库到 ContentBrief.provenance，作为生成时快照（需求 5.4 不回溯）。
 */
export async function instantiatePlaybookWithProvenance(input: {
  playbook: Playbook
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
  scheduledDate: Date
}): Promise<{ draft: ContentBriefDraft; provenance: BriefProvenance }> {
  const { playbook, store, profile, offer, scheduledDate } = input

  // 构建模板变量上下文
  const vars = buildTemplateVars(store, profile, offer)

  // 从模板中随机选取原始模板（保留未替换的占位符，用于溯源定位）
  const rawHookTemplate = pickRandom(playbook.hookTemplates)
  const rawCaptionTemplate = pickRandom(playbook.captionTemplates)
  const rawCoverTitleTemplate = pickRandom(playbook.coverTitleTemplates)
  const rawCtaTemplate = pickRandom(playbook.ctaTemplates)

  // 替换变量
  const rawHook = replaceTemplateVars(rawHookTemplate, vars)
  const rawCaption = replaceTemplateVars(rawCaptionTemplate, vars)
  const rawCoverTitle = replaceTemplateVars(rawCoverTitleTemplate, vars)
  const rawCta = replaceTemplateVars(rawCtaTemplate, vars)

  // 使用 LLM 润色 hook 和 caption（失败降级为模板原文）
  const [polishedHook, polishedCaption] = await polishWithLLM(
    rawHook,
    rawCaption,
    store,
    profile,
    offer
  )

  // 生成标题
  const title = `${store.name} · ${playbook.name}`

  // 生成 ShotTask 列表（使用日常用语，不用专业术语）
  const shotTasks = buildShotTasks(playbook, store, offer)

  // 构建各平台文案（简化版，后续由 publish-copy-service 精细化生成）
  const platformCopies = buildPlatformCopies(
    polishedHook,
    polishedCaption,
    rawCta,
    store,
    profile,
    offer
  )

  // 构建 aiReasoning 说明
  const aiReasoning = buildAiReasoning(playbook, store, offer, scheduledDate)

  const tags = buildTags(store, profile, offer)

  const draft: ContentBriefDraft = {
    title,
    goal: playbook.goal,
    hook: polishedHook,
    mainMessage: polishedCaption,
    suggestedTitle: title.slice(0, 30),
    suggestedCoverTitle: rawCoverTitle.slice(0, 15),
    suggestedCaption: polishedCaption,
    suggestedCta: rawCta,
    platformCopies,
    tags,
    aiReasoning,
    shotTasks,
  }

  // 生成时记录画像引用溯源（需求 5.2）
  const provenance = buildProvenance({
    rawTemplates: {
      hook: rawHookTemplate,
      caption: rawCaptionTemplate,
      coverTitle: rawCoverTitleTemplate,
      cta: rawCtaTemplate,
    },
    vars,
    store,
    profile,
    offer,
    tags,
  })

  return { draft, provenance }
}

// ========================
// 内部辅助函数
// ========================

/**
 * 将 Prisma 原始记录转为类型安全的 Playbook 对象
 * Prisma Json 字段返回 unknown，需要手动 cast
 */
function castPlaybook(raw: Record<string, unknown>): Playbook {
  return {
    id: raw.id as string,
    industry: raw.industry as MerchantIndustry,
    name: raw.name as string,
    goal: raw.goal as ContentGoal,
    description: raw.description as string | null,
    structure: (raw.structure ?? []) as PlaybookSegment[],
    requiredShots: (raw.requiredShots ?? []) as ShotTaskType[],
    optionalShots: (raw.optionalShots ?? null) as ShotTaskType[] | null,
    hookTemplates: (raw.hookTemplates ?? []) as string[],
    captionTemplates: (raw.captionTemplates ?? []) as string[],
    coverTitleTemplates: (raw.coverTitleTemplates ?? []) as string[],
    ctaTemplates: (raw.ctaTemplates ?? []) as string[],
    complianceRules: (raw.complianceRules ?? null) as Record<string, unknown> | null,
    scoreWeight: (raw.scoreWeight ?? null) as { views: number; conversion: number } | null,
    tierRequired: (raw.tierRequired ?? 'FREE') as string,
    isActive: raw.isActive as boolean,
    createdAt: raw.createdAt as Date,
    updatedAt: raw.updatedAt as Date,
  }
}

/**
 * 检查剧本是否与门店的拍摄能力兼容
 * 仅检查必拍镜头（requiredShots），可选镜头不影响选择
 */
function isPlaybookCompatible(
  playbook: Playbook,
  store: Pick<Store, 'canShootKitchen' | 'canShootStaff' | 'canShootCustomers'>
): boolean {
  for (const shotType of playbook.requiredShots) {
    const capabilityKey = SHOT_CAPABILITY_MAP[shotType]
    if (capabilityKey && !store[capabilityKey as keyof typeof store]) {
      return false
    }
  }
  return true
}

/**
 * 按 scoreWeight 加权排序
 * 优先级：有 offer 匹配时 conversion 权重更高；无 offer 时 views 权重更高
 */
function sortByScoreWeight(playbooks: Playbook[], offers: ProductOffer[]): Playbook[] {
  const hasActiveOffer = offers.some((o) => o.isActive)

  return [...playbooks].sort((a, b) => {
    const scoreA = getWeightedScore(a.scoreWeight, hasActiveOffer)
    const scoreB = getWeightedScore(b.scoreWeight, hasActiveOffer)
    return scoreB - scoreA // 降序
  })
}

/** 计算加权分数 */
function getWeightedScore(
  weight: { views: number; conversion: number } | null,
  hasOffer: boolean
): number {
  if (!weight) return 50 // 无权重时使用默认中间值
  if (hasOffer) {
    // 有活跃优惠时，conversion 权重更高
    return weight.views * 0.4 + weight.conversion * 0.6
  }
  // 无优惠时，views 权重更高
  return weight.views * 0.6 + weight.conversion * 0.4
}

/**
 * 从排序后的候选列表中选择一个不会连续超限的剧本
 * 检查最近 MAX_CONSECUTIVE_PLAYBOOK_USE 个使用记录
 */
function pickNonConsecutive(
  sorted: Playbook[],
  recentIds: string[]
): Playbook | null {
  for (const pb of sorted) {
    if (!isConsecutiveOverLimit(pb.id, recentIds)) {
      return pb
    }
  }
  return null
}

/**
 * 判断某个 playbookId 是否已经连续使用达到上限
 */
function isConsecutiveOverLimit(playbookId: string, recentIds: string[]): boolean {
  if (recentIds.length < MAX_CONSECUTIVE_PLAYBOOK_USE) return false

  // 检查最近 N 个是否全是同一个 playbookId
  const tail = recentIds.slice(-MAX_CONSECUTIVE_PLAYBOOK_USE)
  return tail.every((id) => id === playbookId)
}

// ========================
// 模板变量替换
// ========================

interface TemplateVars {
  storeName: string
  productName: string
  price: string
  originalPrice: string
  discount: string
  cta: string
  location: string
  sellingPoint: string
}

/** 构建模板变量上下文 */
function buildTemplateVars(
  store: Store,
  profile: StoreProfile,
  offer?: ProductOffer
): TemplateVars {
  const productName = offer?.name ?? (store.mainProducts[0] ?? '招牌产品')
  const salePrice = offer?.salePrice
  const originalPrice = offer?.originalPrice

  // 价格格式化（分 → 元）
  const priceStr = salePrice != null ? `${(salePrice / 100).toFixed(0)}元` : ''
  const originalPriceStr = originalPrice != null ? `${(originalPrice / 100).toFixed(0)}元` : ''

  // 折扣计算
  let discountStr = ''
  if (originalPrice && salePrice && originalPrice > salePrice) {
    const discountRatio = Math.round((salePrice / originalPrice) * 10)
    discountStr = `${discountRatio}折`
  }

  // CTA：从画像推荐 CTA 列表中选取第一个
  const cta = profile.preferredCta?.[0] ?? '点击下方团购链接'

  // 位置：组合城市+区+商圈
  const locationParts = [store.city, store.district, store.businessArea].filter(Boolean)
  const location = locationParts.length > 0 ? locationParts.join('') : store.name

  // 卖点
  const sellingPoint = offer?.sellingPoints?.[0]
    ?? store.mainSellingPoints[0]
    ?? '新鲜现做'

  return {
    storeName: store.name,
    productName,
    price: priceStr,
    originalPrice: originalPriceStr,
    discount: discountStr,
    cta,
    location,
    sellingPoint,
  }
}

/** 替换模板中的 {变量} 占位符 */
function replaceTemplateVars(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{storeName\}/g, vars.storeName)
    .replace(/\{productName\}/g, vars.productName)
    .replace(/\{price\}/g, vars.price)
    .replace(/\{originalPrice\}/g, vars.originalPrice)
    .replace(/\{discount\}/g, vars.discount)
    .replace(/\{cta\}/g, vars.cta)
    .replace(/\{location\}/g, vars.location)
    .replace(/\{sellingPoint\}/g, vars.sellingPoint)
}

/** 从数组中随机选取一个元素 */
function pickRandom<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('pickRandom: 模板数组为空')
  return arr[Math.floor(Math.random() * arr.length)]
}

// ========================
// 画像引用溯源（需求 5.1, 5.2, 5.6）
// ========================

/** 去重并过滤空白字符串 */
function uniqueNonEmpty(arr: (string | null | undefined)[]): string[] {
  const cleaned = arr.filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  )
  return Array.from(new Set(cleaned))
}

/**
 * 定位某个占位符被用在哪个模板字段
 * 按 hook > caption > title > cta 的优先级返回第一个命中的位置；都未命中返回 null
 */
function locatePlaceholderUsage(
  placeholder: string,
  rawTemplates: { hook: string; caption: string; coverTitle: string; cta: string }
): ProvenanceUsedIn | null {
  if (rawTemplates.hook.includes(placeholder)) return 'hook'
  if (rawTemplates.caption.includes(placeholder)) return 'caption'
  if (rawTemplates.coverTitle.includes(placeholder)) return 'title'
  if (rawTemplates.cta.includes(placeholder)) return 'cta'
  return null
}

/**
 * 构建溯源结构体（生成时快照）
 *
 * 仅记录模板「真实引用」了画像取值的情况，保证 references 每条 value 必属于对应字段取值集合：
 * - sellingPoint：value 来自 offer.sellingPoints ∪ store.mainSellingPoints，且模板含 {sellingPoint} 占位符
 * - cta：value 来自 profile.preferredCta，且模板含 {cta} 占位符
 * - hookKeyword：value 来自 profile.hookKeywords，且最终落入 draft.tags（标签展示在平台文案中）
 * - persona：当前剧本实例化未将人设注入文案，故不记录，避免伪造（需求 5.6）
 *
 * 兜底取值（如卖点缺失时的「新鲜现做」、CTA 缺失时的默认引导语）不在任何画像集合内，
 * 不会被记录，从而 isGenericTemplate 如实为 true。
 */
function buildProvenance(args: {
  rawTemplates: { hook: string; caption: string; coverTitle: string; cta: string }
  vars: TemplateVars
  store: Store
  profile: StoreProfile
  offer?: ProductOffer
  tags: string[]
}): BriefProvenance {
  const { rawTemplates, vars, store, profile, offer, tags } = args
  const references: BriefProvenance['references'] = []

  // 1. 卖点（sellingPoint）：实际填入 {sellingPoint} 的值须来自真实卖点集合
  const sellingPointSet = uniqueNonEmpty([
    ...(offer?.sellingPoints ?? []),
    ...store.mainSellingPoints,
  ])
  if (sellingPointSet.includes(vars.sellingPoint)) {
    const usedIn = locatePlaceholderUsage('{sellingPoint}', rawTemplates)
    if (usedIn) {
      references.push({
        field: 'sellingPoint',
        value: vars.sellingPoint,
        usedIn,
        plainText: `这条用了你的招牌『${vars.sellingPoint}』`,
      })
    }
  }

  // 2. CTA：实际填入 {cta} 的值须来自画像 preferredCta 集合
  const ctaSet = uniqueNonEmpty(profile.preferredCta ?? [])
  if (ctaSet.includes(vars.cta)) {
    const usedIn = locatePlaceholderUsage('{cta}', rawTemplates)
    if (usedIn) {
      references.push({
        field: 'cta',
        value: vars.cta,
        usedIn,
        plainText: `这条用了你设置的引导语『${vars.cta}』`,
      })
    }
  }

  // 3. 钩子词（hookKeyword）：落入标签的钩子词才算被引用（标签展示于平台文案）
  const hookKeywordSet = uniqueNonEmpty(profile.hookKeywords ?? [])
  for (const keyword of hookKeywordSet) {
    if (tags.includes(keyword)) {
      references.push({
        field: 'hookKeyword',
        value: keyword,
        usedIn: 'caption',
        plainText: `这条带上了你常用的吸睛点『${keyword}』`,
      })
    }
  }

  return {
    references,
    // 无任何画像引用 → 如实标记为通用模板，绝不伪造（需求 5.6）
    isGenericTemplate: references.length === 0,
  }
}

// ========================
// LLM 润色（OpenAI 兼容接口，qwen 模型）
// ========================

/**
 * 使用 LLM 润色 hook 和 caption
 * 确保文案自然、口语化，且不包含违禁表达
 * 失败时降级为模板原文（不静默，记录错误日志）
 */
async function polishWithLLM(
  rawHook: string,
  rawCaption: string,
  store: Store,
  profile: StoreProfile,
  offer?: ProductOffer
): Promise<[string, string]> {
  // 如果 LLM 配置缺失，直接使用原文（开发环境可能未配置）
  if (!LLM_API_URL || !LLM_API_KEY) {
    console.warn('[playbook-engine] LLM 未配置（MERCHANT_LLM_API_URL/KEY），使用模板原文')
    return [rawHook, rawCaption]
  }

  const forbiddenList = profile.forbiddenClaims?.join('、') ?? ''
  const systemPrompt = `你是一个短视频文案优化助手。请润色以下文案，使其更自然、口语化、适合短视频平台传播。

规则：
1. 保持原意不变，只调整表达方式
2. 使用日常口语，像朋友推荐一样自然
3. 严禁使用以下违禁表达：${forbiddenList}
4. 不要使用专业营销术语
5. 控制 hook 在 30 字以内，caption 在 100 字以内

请分别输出 hook 和 caption，用 --- 分隔，不要输出其他内容。`

  const userPrompt = `门店：${store.name}
产品：${offer?.name ?? store.mainProducts[0] ?? ''}
原始 hook：${rawHook}
原始 caption：${rawCaption}`

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
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error(
        `[playbook-engine] LLM 润色失败: HTTP ${response.status}, body=${errText}`
      )
      return [rawHook, rawCaption]
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      console.error('[playbook-engine] LLM 返回空内容，使用模板原文')
      return [rawHook, rawCaption]
    }

    // 解析 LLM 输出：hook --- caption
    const parts = content.split('---').map((s) => s.trim())
    const polishedHook = parts[0] || rawHook
    const polishedCaption = parts[1] || rawCaption

    return [polishedHook, polishedCaption]
  } catch (error) {
    console.error('[playbook-engine] LLM 调用异常，使用模板原文:', error)
    return [rawHook, rawCaption]
  }
}

// ========================
// ShotTask 生成（使用日常用语）
// ========================

/** 镜头类型到日常用语标题的映射 */
const SHOT_TYPE_TITLES: Record<ShotTaskType, string> = {
  STOREFRONT: '拍门头招牌',
  PRODUCT_CLOSEUP: '拍产品特写',
  COOKING_PROCESS: '拍制作过程',
  STAFF_ACTION: '拍员工操作',
  CUSTOMER_REACTION: '拍顾客反应',
  OWNER_TALKING: '老板说两句',
  ENVIRONMENT: '拍店内环境',
  OFFER_DISPLAY: '展示优惠信息',
  CTA_SCREEN: '拍引导画面',
  AI_GENERATED_FILLER: 'AI 补充画面',
}

/** 镜头类型到日常用语说明的映射 */
const SHOT_TYPE_INSTRUCTIONS: Record<ShotTaskType, string> = {
  STOREFRONT: '站在店门口，把招牌和门面都拍进去，从左到右慢慢移动手机',
  PRODUCT_CLOSEUP: '把手机靠近产品，对准拍清楚，可以慢慢转一圈让大家看全',
  COOKING_PROCESS: '拍做菜的过程，从备料到出锅，重点拍冒烟和翻炒的画面',
  STAFF_ACTION: '拍员工认真工作的样子，比如摆盘、调饮品、擦桌子',
  CUSTOMER_REACTION: '拍顾客吃东西时开心的表情，记得先征得同意',
  OWNER_TALKING: '老板面对镜头说话，介绍产品或分享故事，要自然放松',
  ENVIRONMENT: '在店里走一圈，拍拍装修、座位、灯光，让人感受到氛围',
  OFFER_DISPLAY: '把优惠海报或价格牌拍清楚，也可以用手指着价格',
  CTA_SCREEN: '拍一个引导画面，比如指向团购链接或门店地址',
  AI_GENERATED_FILLER: '此镜头由 AI 自动生成补充',
}

/**
 * 根据剧本结构生成 ShotTask 列表
 * order 从 1 开始连续递增
 */
function buildShotTasks(
  playbook: Playbook,
  store: Store,
  offer?: ProductOffer
): ShotTaskDraft[] {
  const tasks: ShotTaskDraft[] = []
  let order = 1

  // 先添加所有必拍镜头
  for (const shotType of playbook.requiredShots) {
    tasks.push(buildSingleShotTask(shotType, order, true, store, offer, playbook))
    order++
  }

  // 再添加可选镜头
  if (playbook.optionalShots) {
    for (const shotType of playbook.optionalShots) {
      // 可选镜头需检查拍摄能力
      const capKey = SHOT_CAPABILITY_MAP[shotType]
      if (capKey && !store[capKey as keyof Store]) {
        continue // 跳过不可拍摄的可选镜头
      }
      tasks.push(buildSingleShotTask(shotType, order, false, store, offer, playbook))
      order++
    }
  }

  return tasks
}

/** 构建单个 ShotTask */
function buildSingleShotTask(
  type: ShotTaskType,
  order: number,
  required: boolean,
  store: Store,
  offer?: ProductOffer,
  playbook?: Playbook
): ShotTaskDraft {
  // 根据剧本结构段匹配时长（如有），否则使用默认时长
  const segment = playbook?.structure[order - 1]
  const durationSec = segment?.durationSec ?? getDefaultDuration(type)

  // 个性化说明：替换产品名和店名
  let instruction = SHOT_TYPE_INSTRUCTIONS[type]
  if (offer?.name) {
    instruction = instruction.replace('产品', offer.name)
  }

  return {
    order,
    type,
    title: SHOT_TYPE_TITLES[type].slice(0, 20),
    instruction: instruction.slice(0, 200),
    durationSec: Math.max(3, Math.min(15, durationSec)),
    required,
    framingGuide: getFramingGuide(type),
    qualityRules: getQualityRules(type),
  }
}

/** 镜头类型默认时长（秒） */
function getDefaultDuration(type: ShotTaskType): number {
  const defaults: Record<ShotTaskType, number> = {
    STOREFRONT: 5,
    PRODUCT_CLOSEUP: 5,
    COOKING_PROCESS: 10,
    STAFF_ACTION: 8,
    CUSTOMER_REACTION: 5,
    OWNER_TALKING: 15,
    ENVIRONMENT: 8,
    OFFER_DISPLAY: 5,
    CTA_SCREEN: 3,
    AI_GENERATED_FILLER: 5,
  }
  return defaults[type]
}

/** 构图指引 */
function getFramingGuide(type: ShotTaskType): Record<string, unknown> {
  const guides: Record<ShotTaskType, Record<string, string>> = {
    STOREFRONT: { angle: '正面平视', movement: '从左到右慢移', tips: '保证招牌清晰可读' },
    PRODUCT_CLOSEUP: { angle: '45度俯拍', movement: '固定或慢转', tips: '对焦在产品上' },
    COOKING_PROCESS: { angle: '侧面平视', movement: '固定', tips: '拍到火焰或蒸汽更好' },
    STAFF_ACTION: { angle: '侧面', movement: '固定', tips: '不要拍到脸以外的客人' },
    CUSTOMER_REACTION: { angle: '正面', movement: '固定', tips: '确保得到顾客同意' },
    OWNER_TALKING: { angle: '正面平视', movement: '固定', tips: '眼睛看镜头，保持微笑' },
    ENVIRONMENT: { angle: '平视', movement: '慢慢走动拍', tips: '展示整体氛围' },
    OFFER_DISPLAY: { angle: '正面', movement: '固定', tips: '价格数字要清晰' },
    CTA_SCREEN: { angle: '正面', movement: '固定', tips: '画面简洁，信息突出' },
    AI_GENERATED_FILLER: { angle: '自动', movement: '自动', tips: 'AI 自动生成' },
  }
  return guides[type]
}

/** 质量规则 */
function getQualityRules(type: ShotTaskType): Record<string, unknown> {
  const rules: Record<ShotTaskType, Record<string, boolean | number>> = {
    STOREFRONT: { needsAudio: false, minBrightness: 15 },
    PRODUCT_CLOSEUP: { needsAudio: false, minBrightness: 20 },
    COOKING_PROCESS: { needsAudio: false, minBrightness: 15 },
    STAFF_ACTION: { needsAudio: false, minBrightness: 15 },
    CUSTOMER_REACTION: { needsAudio: true, minBrightness: 15 },
    OWNER_TALKING: { needsAudio: true, minBrightness: 20 },
    ENVIRONMENT: { needsAudio: false, minBrightness: 10 },
    OFFER_DISPLAY: { needsAudio: false, minBrightness: 20 },
    CTA_SCREEN: { needsAudio: false, minBrightness: 20 },
    AI_GENERATED_FILLER: { needsAudio: false, minBrightness: 0 },
  }
  return rules[type]
}

// ========================
// 平台文案构建（简化版）
// ========================

/**
 * 构建各平台文案初稿
 * 后续由 publish-copy-service 精细化生成
 */
function buildPlatformCopies(
  hook: string,
  caption: string,
  cta: string,
  store: Store,
  profile: StoreProfile,
  offer?: ProductOffer
): Record<PublishPlatform, PlatformCopy> {
  const baseTitle = `${store.name}${offer ? ` | ${offer.name}` : ''}`.slice(0, 30)
  const baseCoverTitle = (offer?.name ?? store.mainProducts[0] ?? store.name).slice(0, 15)
  const baseTags = buildTags(store, profile, offer).slice(0, 10)

  const base: PlatformCopy = {
    title: baseTitle,
    coverTitle: baseCoverTitle,
    caption: `${hook}\n${caption}`,
    tags: baseTags,
    cta,
  }

  return {
    DOUYIN: { ...base, caption: `${hook} ${caption} #${store.name} ${cta}`.slice(0, 300) },
    XIAOHONGSHU: {
      ...base,
      caption: `${hook}\n\n${caption}\n\n📍${store.city ?? ''}${store.district ?? ''}${store.name}\n${cta}`.slice(0, 1000),
    },
    WECHAT_CHANNELS: { ...base, caption: `${hook} ${caption}`.slice(0, 200) },
    KUAISHOU: {
      ...base,
      caption: `${offer?.salePrice ? `💰${(offer.salePrice / 100).toFixed(0)}元` : ''} ${hook} ${caption} ${cta}`.trim().slice(0, 300),
    },
    MANUAL_EXPORT: base,
  }
}

// ========================
// 标签与推理说明
// ========================

/** 构建标签列表 (3-10 个) */
function buildTags(
  store: Store,
  profile: StoreProfile,
  offer?: ProductOffer
): string[] {
  const tags: string[] = []

  // 行业标签
  tags.push(store.industry === 'RESTAURANT' ? '美食' : '美食探店')

  // 门店名
  tags.push(store.name)

  // 位置标签
  if (store.city) tags.push(store.city + '美食')
  if (store.district) tags.push(store.district + '探店')

  // 产品标签
  if (offer?.name) tags.push(offer.name)
  if (store.mainProducts[0]) tags.push(store.mainProducts[0])

  // 钩子关键词标签
  const hookKws = profile.hookKeywords?.slice(0, 3) ?? []
  tags.push(...hookKws)

  // 去重并限制 3-10 个
  const unique = Array.from(new Set(tags)).slice(0, 10)
  return unique.length >= 3 ? unique : [...unique, '探店', '推荐', '好吃'].slice(0, 10)
}

/** 构建 AI 推理说明 */
function buildAiReasoning(
  playbook: Playbook,
  store: Store,
  offer?: ProductOffer,
  scheduledDate?: Date
): string {
  const parts: string[] = []

  parts.push(`选用剧本「${playbook.name}」(ID: ${playbook.id})`)
  parts.push(`内容目标: ${playbook.goal}`)
  parts.push(`行业: ${store.industry}`)

  if (offer) {
    parts.push(`关联优惠: ${offer.name}`)
  }

  if (scheduledDate) {
    const dayOfWeek = scheduledDate.getDay()
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    parts.push(`排期: ${dayNames[dayOfWeek]} (${scheduledDate.toISOString().slice(0, 10)})`)
  }

  if (playbook.scoreWeight) {
    parts.push(`评分权重: views=${playbook.scoreWeight.views}, conversion=${playbook.scoreWeight.conversion}`)
  }

  return parts.join(' | ')
}
