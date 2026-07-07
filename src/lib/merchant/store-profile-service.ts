/**
 * 门店画像生成服务 — 规则引擎 + LLM 润色
 *
 * 核心逻辑完全基于规则引擎（行业 + 客单价 + 拍摄能力），不依赖 LLM。
 * LLM（阿里云百炼 DashScope / qwen）仅用于生成 aiSummary 自然语言总结。
 * LLM 调用失败时 aiSummary 设为 null，不影响其他字段。
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { prisma } from '@/lib/shared/db'
import { Prisma } from '@/generated/prisma'
import type { StoreProfile } from '@/generated/prisma'
import { ApiError } from '@/lib/shared/api-error'
import { ABSOLUTE_CLAIMS, FALSE_POPULARITY, WEEKLY_GOAL_SCHEDULE } from '@/constants/merchant'
import type { MerchantIndustry, WeeklyCadenceEntry } from '@/types/merchant'

// ============ 环境变量 ============

/** DashScope API Key（阿里云百炼，用于 qwen 文本生成） */
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
/** DashScope OpenAI 兼容接口基址 */
const DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
/** 文本生成模型 */
const TEXT_MODEL = 'qwen-plus'

// ============ 行业关键词库 ============

/** 各行业 hook 关键词基础库 */
const INDUSTRY_HOOK_KEYWORDS: Record<MerchantIndustry, string[]> = {
  RESTAURANT: ['必吃榜', '人均', '隐藏菜单', '老板推荐', '招牌菜', '下饭神器', '家常味道', '聚餐'],
  DRINK: ['新品', '隐藏喝法', '颜值爆表', '清爽解暑', '奶茶自由', '今日特调', '买一送一'],
  BAKERY: ['新鲜出炉', '限量款', '手作', '甜蜜暴击', '早餐首选', '下午茶', '生日蛋糕'],
  CAFE: ['第三空间', '氛围感', '拍照打卡', '手冲咖啡', '独处时光', '约会圣地', '办公自由'],
  HOTPOT: ['锅底', '鲜切', '毛肚', '涮', '辣度', '拼桌', '聚餐首选', '夜宵'],
  BBQ: ['炭火', '现烤', '深夜食堂', '撸串', '啤酒搭档', '烟火气', '兄弟聚餐'],
  FAST_FOOD: ['快', '实惠', '工作餐', '外卖', '套餐', '管饱', '性价比', '打工人'],
  OTHER_LOCAL: ['周边好店', '探店', '宝藏小店', '本地人推荐', '社区好店'],
}

/** 各行业特定违禁词（在通用违禁词之上追加） */
const INDUSTRY_FORBIDDEN_CLAIMS: Record<MerchantIndustry, string[]> = {
  RESTAURANT: ['祖传秘方', '百年老店', '纯天然', '无添加', '养生'],
  DRINK: ['0 卡', '减肥', '排毒', '美白', '纯天然'],
  BAKERY: ['无糖', '0 脂肪', '减肥', '养生', '纯天然'],
  CAFE: ['提神醒脑', '抗疲劳', '养生', '纯天然'],
  HOTPOT: ['祖传秘方', '纯天然', '无添加', '药膳', '养生锅底'],
  BBQ: ['纯天然', '无添加', '有机', '绿色食品'],
  FAST_FOOD: ['纯天然', '无添加', '有机', '减肥餐'],
  OTHER_LOCAL: ['纯天然', '无添加', '保证效果'],
}

// ============ 内容定位规则 ============

/** 根据行业 + 客单价确定内容定位 */
function deriveContentPositioning(industry: MerchantIndustry, avgTicket?: number): string {
  switch (industry) {
    case 'HOTPOT':
      if (avgTicket && avgTicket > 8000) return '品质火锅体验种草'    // > 80元
      if (avgTicket && avgTicket > 5000) return '性价比火锅聚餐推荐'  // 50-80元
      return '实惠火锅大众引流'
    case 'FAST_FOOD':
      return '高频快餐实惠引流'
    case 'CAFE':
      return '第三空间生活方式'
    case 'DRINK':
      if (avgTicket && avgTicket > 2000) return '精品饮品颜值种草'    // > 20元
      return '平价饮品高频引流'
    case 'BAKERY':
      if (avgTicket && avgTicket > 3000) return '精致烘焙下午茶种草'  // > 30元
      return '日常烘焙便利引流'
    case 'BBQ':
      if (avgTicket && avgTicket > 10000) return '品质烧烤深夜社交'   // > 100元
      return '烟火气撸串聚餐引流'
    case 'RESTAURANT':
      if (avgTicket && avgTicket > 10000) return '品质正餐体验种草'   // > 100元
      if (avgTicket && avgTicket > 5000) return '家常好味口碑推荐'    // 50-100元
      return '实惠家常高频引流'
    case 'OTHER_LOCAL':
      return '本地好店发现种草'
    default:
      return '本地门店内容引流'
  }
}

// ============ 推荐人设规则 ============

/** 根据拍摄能力决定推荐人设 */
function deriveRecommendedPersona(
  canShootStaff?: boolean,
  canShootKitchen?: boolean,
): string {
  if (canShootStaff && canShootKitchen) return '厨师人设'
  if (canShootStaff) return '老板人设'
  return '第三人称探店'
}

// ============ 钩子关键词生成 ============

/** 组合行业关键词库 + 主打产品，确保 5-15 个 */
function deriveHookKeywords(industry: MerchantIndustry, mainProducts: string[]): string[] {
  const industryKeywords = INDUSTRY_HOOK_KEYWORDS[industry] || INDUSTRY_HOOK_KEYWORDS.OTHER_LOCAL
  // 产品名本身就是好的 hook 关键词
  const productKeywords = mainProducts.slice(0, 5)
  // 合并去重
  const combined = Array.from(new Set([...industryKeywords, ...productKeywords]))
  // 确保 5-15 范围
  if (combined.length < 5) {
    // 补充通用关键词
    const fallback = ['探店', '种草', '推荐', '本地', '好吃']
    for (const kw of fallback) {
      if (combined.length >= 5) break
      if (!combined.includes(kw)) combined.push(kw)
    }
  }
  return combined.slice(0, 15)
}

// ============ 违禁词生成 ============

/** 组合固定违禁词库 + 行业特定违禁词，确保 ≥5 个 */
function deriveForbiddenClaims(industry: MerchantIndustry): string[] {
  const baseClaims: string[] = [...ABSOLUTE_CLAIMS, ...FALSE_POPULARITY]
  const industryClaims = INDUSTRY_FORBIDDEN_CLAIMS[industry] || []
  const combined = Array.from(new Set([...baseClaims, ...industryClaims]))
  // 至少 5 个（基础词库已有 14 个，此处是安全保障）
  return combined
}

// ============ 首选 CTA 生成 ============

/** 根据团购/预约能力选择 CTA（3-5 个） */
function derivePreferredCta(hasGroupBuying?: boolean, hasReservation?: boolean): string[] {
  const ctas: string[] = []

  if (hasGroupBuying) {
    ctas.push('点击团购链接')
    ctas.push('领取优惠套餐')
  }
  if (hasReservation) {
    ctas.push('在线预约免排队')
  }

  // 通用 CTA
  const universalCtas = ['到店品尝', '导航到店', '收藏备用', '关注不迷路', '私信了解更多']
  for (const cta of universalCtas) {
    if (ctas.length >= 5) break
    ctas.push(cta)
  }

  // 确保至少 3 个
  return ctas.slice(0, 5)
}

// ============ 每周发布节奏 ============

/** 从 WEEKLY_GOAL_SCHEDULE 常量映射为 WeeklyCadenceEntry[] */
function deriveWeeklyCadence(): WeeklyCadenceEntry[] {
  const themes: Record<string, string> = {
    TRAFFIC: '工作日午餐引流',
    NEW_PRODUCT: '招牌产品/新品',
    TRUST_BUILDING: '老板/厨师人设',
    BRAND_STORY: '门店环境/体验',
    WEEKEND_BOOST: '周末聚餐预热',
    PROMOTION: '爆品/套餐促销',
    REPEAT_PURCHASE: '家庭/朋友聚餐',
  }

  return (Object.entries(WEEKLY_GOAL_SCHEDULE) as [string, string][]).map(([day, goal]) => ({
    day: Number(day),
    theme: themes[goal] || goal,
    count: 1,
  }))
}

// ============ 内容应做 / 禁忌清单 ============

/** 根据行业和拍摄能力生成内容应做清单（3-10 项） */
function deriveContentDos(
  industry: MerchantIndustry,
  canShootKitchen?: boolean,
  canShootStaff?: boolean,
  canShootCustomers?: boolean,
): string[] {
  const dos: string[] = []

  // 通用应做
  dos.push('拍摄前确保环境整洁')
  dos.push('使用自然光或店内正常灯光')
  dos.push('拍摄竖屏视频(9:16)')

  // 行业特定
  switch (industry) {
    case 'RESTAURANT':
    case 'HOTPOT':
    case 'BBQ':
      dos.push('展示菜品出锅/上桌的热气')
      dos.push('拍摄食物特写时靠近 30cm 以内')
      break
    case 'DRINK':
      dos.push('展示饮品制作过程的流动感')
      dos.push('拍摄成品时背景干净')
      break
    case 'BAKERY':
      dos.push('展示新鲜出炉的瞬间')
      dos.push('拍摄切开/掰开展示内部质感')
      break
    case 'CAFE':
      dos.push('展示空间氛围和光影')
      dos.push('拍摄拉花/手冲等仪式感动作')
      break
    case 'FAST_FOOD':
      dos.push('突出出餐速度')
      dos.push('展示份量感')
      break
    default:
      dos.push('突出产品/服务的核心卖点')
  }

  // 拍摄能力相关
  if (canShootKitchen) {
    dos.push('展示厨房真实操作增加信任感')
  }
  if (canShootStaff) {
    dos.push('让员工自然出镜展示专业度')
  }
  if (canShootCustomers) {
    dos.push('记录真实顾客用餐反应')
  }

  return dos.slice(0, 10)
}

/** 根据行业和拍摄能力生成内容禁忌清单（3-10 项） */
function deriveContentDonts(
  industry: MerchantIndustry,
  canShootKitchen?: boolean,
  canShootStaff?: boolean,
  canShootCustomers?: boolean,
): string[] {
  const donts: string[] = []

  // 通用禁忌
  donts.push('不要使用横屏拍摄')
  donts.push('不要在光线过暗的环境拍摄')
  donts.push('不要出现竞品品牌 LOGO')

  // 行业特定
  switch (industry) {
    case 'RESTAURANT':
    case 'HOTPOT':
    case 'BBQ':
      donts.push('不要拍到脏污的桌面或餐具')
      donts.push('不要在食物变冷后才拍摄')
      break
    case 'DRINK':
      donts.push('不要拍到杯壁水汽模糊产品')
      donts.push('不要展示一次性杯具堆积')
      break
    case 'BAKERY':
      donts.push('不要拍到面包屑散落的场景')
      donts.push('不要在产品变形后拍摄')
      break
    case 'CAFE':
      donts.push('不要拍到凌乱的其他顾客桌面')
      donts.push('不要在嘈杂时段录口播')
      break
    case 'FAST_FOOD':
      donts.push('不要暴露后厨杂乱画面')
      donts.push('不要拍到排队过长引发负面情绪')
      break
    default:
      donts.push('不要出现与业务无关的画面')
  }

  // 拍摄能力相关（反向）
  if (!canShootKitchen) {
    donts.push('不要偷拍厨房（未获授权）')
  }
  if (!canShootStaff) {
    donts.push('不要拍到不愿出镜的员工正脸')
  }
  if (!canShootCustomers) {
    donts.push('不要拍到顾客正脸（未获授权）')
  }

  return donts.slice(0, 10)
}

// ============ 视觉风格规则 ============

/** 根据行业和客单价确定视觉风格 */
function deriveVisualStyle(industry: MerchantIndustry, avgTicket?: number): string {
  switch (industry) {
    case 'CAFE':
      return '清新文艺 / 暖色调 / 慢节奏'
    case 'HOTPOT':
    case 'BBQ':
      return '热烈烟火气 / 暖黄色调 / 动感剪辑'
    case 'DRINK':
      return '高饱和色彩 / 干净背景 / 快节奏'
    case 'BAKERY':
      return '温暖柔光 / 奶油色调 / 治愈感'
    case 'FAST_FOOD':
      return '明亮高对比 / 快切 / 信息密度高'
    case 'RESTAURANT':
      if (avgTicket && avgTicket > 10000) return '质感光影 / 暗调 / 高级感'
      return '明亮自然 / 暖色调 / 家常感'
    default:
      return '明亮自然 / 暖色调 / 生活气息'
  }
}

// ============ LLM 调用（仅 aiSummary）============

/**
 * 调用 qwen 模型生成自然语言总结。
 * 使用 DashScope OpenAI 兼容接口。
 * 失败时返回 null，不影响其他字段。
 */
async function generateAiSummary(profileData: {
  contentPositioning: string
  recommendedPersona: string
  visualStyle: string
  hookKeywords: string[]
  forbiddenClaims: string[]
  preferredCta: string[]
  contentDos: string[]
  contentDonts: string[]
  industry: MerchantIndustry
  mainProducts: string[]
  mainSellingPoints: string[]
}): Promise<string | null> {
  if (!DASHSCOPE_API_KEY) {
    console.warn('[store-profile] DASHSCOPE_API_KEY 未配置，跳过 aiSummary 生成')
    return null
  }

  const prompt = `你是一位本地生活短视频营销专家。请根据以下门店画像信息，用 2-3 段自然语言总结该门店的内容策略方向，给出清晰、可执行的运营建议概述。不要重复列举原始数据，用通顺的自然语言表达。

门店画像：
- 行业：${profileData.industry}
- 主打产品：${profileData.mainProducts.join('、')}
- 核心卖点：${profileData.mainSellingPoints.join('、')}
- 内容定位：${profileData.contentPositioning}
- 推荐人设：${profileData.recommendedPersona}
- 视觉风格：${profileData.visualStyle}
- 钩子关键词：${profileData.hookKeywords.slice(0, 8).join('、')}
- 首选 CTA：${profileData.preferredCta.join('、')}

请用简洁专业的中文输出，总字数控制在 200 字以内。`

  try {
    const response = await fetch(`${DASHSCOPE_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: 'system', content: '你是本地生活短视频营销策略专家，擅长为餐饮门店制定内容运营方案。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[store-profile] LLM 调用失败 (HTTP ${response.status}): ${errorText}`)
      return null
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string | null } }>
    }
    const content = data.choices?.[0]?.message?.content
    return content || null
  } catch (error) {
    console.error('[store-profile] LLM 调用异常:', error)
    return null
  }
}

// ============ 验证错误 ============

/** 输入验证错误 */
export class ValidationError extends Error {
  public readonly missingFields: string[]

  constructor(message: string, missingFields: string[]) {
    super(message)
    this.name = 'ValidationError'
    this.missingFields = missingFields
  }
}

// ============ 主函数 ============

/**
 * 创建门店画像 — 基于规则引擎生成，LLM 仅润色 aiSummary。
 *
 * @throws {ValidationError} 缺少 industry/mainProducts/mainSellingPoints 时抛出
 */
export async function createStoreProfile(input: {
  storeId: string
  industry: MerchantIndustry
  mainProducts: string[]
  mainSellingPoints: string[]
  targetCustomers?: string[]
  avgTicket?: number
  hasGroupBuying?: boolean
  hasReservation?: boolean
  canShootKitchen?: boolean
  canShootStaff?: boolean
  canShootCustomers?: boolean
}): Promise<ReturnType<typeof prisma.storeProfile.create>> {
  // ====== 1. 输入验证（Requirement 2.5）======
  const missingFields: string[] = []
  if (!input.industry) missingFields.push('industry')
  if (!input.mainProducts || input.mainProducts.length === 0) missingFields.push('mainProducts')
  if (!input.mainSellingPoints || input.mainSellingPoints.length === 0) missingFields.push('mainSellingPoints')

  if (missingFields.length > 0) {
    throw new ValidationError(
      `门店画像生成失败：缺少必填字段 [${missingFields.join(', ')}]`,
      missingFields,
    )
  }

  // ====== 2. 规则引擎生成各字段（Requirement 2.2）======
  const contentPositioning = deriveContentPositioning(input.industry, input.avgTicket)
  const recommendedPersona = deriveRecommendedPersona(input.canShootStaff, input.canShootKitchen)
  const hookKeywords = deriveHookKeywords(input.industry, input.mainProducts)
  const forbiddenClaims = deriveForbiddenClaims(input.industry)
  const preferredCta = derivePreferredCta(input.hasGroupBuying, input.hasReservation)
  const weeklyCadence = deriveWeeklyCadence()
  const contentDos = deriveContentDos(input.industry, input.canShootKitchen, input.canShootStaff, input.canShootCustomers)
  const contentDonts = deriveContentDonts(input.industry, input.canShootKitchen, input.canShootStaff, input.canShootCustomers)
  const visualStyle = deriveVisualStyle(input.industry, input.avgTicket)

  // ====== 3. 完整性检查（Requirement 2.6）======
  let status = 'COMPLETE'
  const incompleteFields: string[] = []

  if (!contentPositioning) incompleteFields.push('contentPositioning')
  if (!recommendedPersona) incompleteFields.push('recommendedPersona')
  if (!visualStyle) incompleteFields.push('visualStyle')
  if (hookKeywords.length < 5) incompleteFields.push('hookKeywords')
  if (forbiddenClaims.length < 5) incompleteFields.push('forbiddenClaims')
  if (preferredCta.length < 3) incompleteFields.push('preferredCta')
  if (weeklyCadence.length !== 7) incompleteFields.push('weeklyCadence')

  if (incompleteFields.length > 0) {
    status = 'INCOMPLETE'
    console.warn(`[store-profile] 画像不完整，缺失字段: ${incompleteFields.join(', ')}`)
  }

  // ====== 4. LLM 生成 aiSummary（Requirement 2.2 — 仅润色）======
  const aiSummary = await generateAiSummary({
    contentPositioning,
    recommendedPersona,
    visualStyle,
    hookKeywords,
    forbiddenClaims,
    preferredCta,
    contentDos,
    contentDonts,
    industry: input.industry,
    mainProducts: input.mainProducts,
    mainSellingPoints: input.mainSellingPoints,
  })

  // ====== 5. 保存到数据库 ======
  const storeProfile = await prisma.storeProfile.create({
    data: {
      storeId: input.storeId,
      contentPositioning,
      recommendedPersona,
      visualStyle,
      hookKeywords,
      forbiddenClaims,
      preferredCta,
      weeklyCadence: weeklyCadence as unknown as Prisma.InputJsonValue,
      contentDos,
      contentDonts,
      aiSummary,
      status,
    },
  })

  return storeProfile
}

// ============ 画像调整（可干预 + 可反哺）============

/** 将 Prisma Json 字段安全转为 string[]（仅保留字符串元素） */
function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 画像调整补丁 — 各字段均为可选，仅对提供的字段做调整 */
export interface AdjustStoreProfilePatch {
  /** 需剔除的钩子关键词（从 StoreProfile.hookKeywords 移除） */
  removeHookKeywords?: string[]
  /** 卖点替换（在 Store.mainSellingPoints 中将 from 替换为 to） */
  updateSellingPoints?: { from: string; to: string }[]
  /** 修改推荐人设（覆盖 StoreProfile.recommendedPersona） */
  updatePersona?: string
  /** 修改首选 CTA（整体覆盖 StoreProfile.preferredCta） */
  updateCta?: string[]
}

/**
 * 调整门店画像依据（需求 5.3）：剔除钩子词 / 修改卖点 / 修改人设 / 修改 CTA。
 *
 * 不回溯保证（需求 5.4 / Property 18）：本函数只更新 StoreProfile（及 Store 上的卖点）
 * 的当前值，绝不改写既有 ContentBrief 的 provenance 快照——既有 brief 的溯源是生成
 * 时的快照，天然不受影响。调整只对调整之后发起的实例化生效（后续 instantiate 读取
 * 调整后的画像，被剔除的钩子词不再出现于新 provenance）。
 *
 * 卖点存储在 Store.mainSellingPoints；其余字段存储在 StoreProfile。两表更新放入同一
 * 事务，保证一致性。纯写库操作，不消耗积分。
 *
 * @throws {ApiError} 门店或画像不存在时抛出 NOT_FOUND
 * @returns 调整后的 StoreProfile
 */
export async function adjustStoreProfile(input: {
  storeId: string
  patch: AdjustStoreProfilePatch
}): Promise<StoreProfile> {
  const { storeId, patch } = input

  return prisma.$transaction(async (tx) => {
    // ====== 1. 读取当前门店与画像 ======
    const store = await tx.store.findUnique({
      where: { id: storeId },
      select: { id: true, mainSellingPoints: true },
    })
    if (!store) {
      throw new ApiError('NOT_FOUND', `门店不存在：${storeId}`, 404)
    }

    const profile = await tx.storeProfile.findUnique({
      where: { storeId },
    })
    if (!profile) {
      throw new ApiError('NOT_FOUND', `门店画像不存在：${storeId}`, 404)
    }

    // ====== 2. 计算 Store 卖点调整（mainSellingPoints 的 from→to 替换）======
    let nextSellingPoints: string[] | undefined
    if (patch.updateSellingPoints && patch.updateSellingPoints.length > 0) {
      const current = asStringArray(store.mainSellingPoints)
      // 逐条替换：将命中 from 的卖点替换为 to；未命中的保持不变
      const replaced = current.map((point) => {
        const hit = patch.updateSellingPoints!.find((u) => u.from === point)
        return hit ? hit.to : point
      })
      // 去重，避免替换后产生重复卖点
      nextSellingPoints = Array.from(new Set(replaced))
    }

    // ====== 3. 计算 StoreProfile 字段调整 ======
    const profileUpdate: Prisma.StoreProfileUpdateInput = {}

    // 剔除钩子关键词
    if (patch.removeHookKeywords && patch.removeHookKeywords.length > 0) {
      const removeSet = new Set(patch.removeHookKeywords)
      const remaining = asStringArray(profile.hookKeywords).filter((kw) => !removeSet.has(kw))
      profileUpdate.hookKeywords = remaining as unknown as Prisma.InputJsonValue
    }

    // 修改人设
    if (patch.updatePersona !== undefined) {
      profileUpdate.recommendedPersona = patch.updatePersona
    }

    // 修改首选 CTA（整体覆盖）
    if (patch.updateCta !== undefined) {
      profileUpdate.preferredCta = patch.updateCta as unknown as Prisma.InputJsonValue
    }

    // ====== 4. 落库（仅更新当前画像，不触碰任何既有 brief 的 provenance）======
    if (nextSellingPoints !== undefined) {
      await tx.store.update({
        where: { id: storeId },
        data: { mainSellingPoints: nextSellingPoints as unknown as Prisma.InputJsonValue },
      })
    }

    // 即使 profileUpdate 为空也执行 update，确保返回最新 StoreProfile（updatedAt 刷新）
    const updatedProfile = await tx.storeProfile.update({
      where: { storeId },
      data: profileUpdate,
    })

    return updatedProfile
  })
}
