/**
 * 本地生活营销平台 — TypeScript 类型定义
 *
 * 与 Prisma schema 中新增的枚举和模型对应，供前端组件和服务层共用。
 * 枚举值使用 Zod schema 定义并导出推断类型，确保运行时校验与类型推断一致。
 */

import { z } from 'zod/v4'

// ========================
// 枚举定义（对应 Prisma 枚举，前端使用）
// ========================

/** 商家行业类型 — 第一阶段仅餐饮行业细分 */
export const MerchantIndustrySchema = z.enum([
  'RESTAURANT',   // 中餐馆
  'DRINK',        // 饮品店（奶茶、果汁）
  'BAKERY',       // 烘焙面包
  'CAFE',         // 咖啡馆
  'HOTPOT',       // 火锅店
  'BBQ',          // 烧烤店
  'FAST_FOOD',    // 快餐店
  'OTHER_LOCAL',  // 其他本地生活
])
export type MerchantIndustry = z.infer<typeof MerchantIndustrySchema>

/** 内容目标 — 每日内容方向 */
export const ContentGoalSchema = z.enum([
  'TRAFFIC',              // 引流
  'PROMOTION',            // 促销
  'NEW_PRODUCT',          // 招牌/新品
  'TRUST_BUILDING',       // 人设/信任
  'BRAND_STORY',          // 品牌故事
  'CUSTOMER_TESTIMONIAL', // 顾客证言
  'WEEKEND_BOOST',        // 周末预热
  'REPEAT_PURCHASE',      // 复购
])
export type ContentGoal = z.infer<typeof ContentGoalSchema>

/** 内容任务状态 — 从创建到发布的完整生命周期 */
export const ContentBriefStatusSchema = z.enum([
  'DRAFT',              // 草稿
  'READY_TO_SHOOT',     // 待拍摄
  'MATERIALS_UPLOADED', // 素材已上传
  'RENDERING',          // 渲染中
  'GENERATED',          // 已生成
  'COMPLIANCE_REVIEW',  // 合规审查中
  'READY_TO_EXPORT',    // 待导出
  'EXPORTED',           // 已导出
  'PUBLISHED',          // 已发布
  'FAILED',             // 失败
  'ARCHIVED',           // 已归档
])
export type ContentBriefStatus = z.infer<typeof ContentBriefStatusSchema>

/** 拍摄任务类型 — 镜头分类 */
export const ShotTaskTypeSchema = z.enum([
  'STOREFRONT',          // 门头/外观
  'PRODUCT_CLOSEUP',     // 产品特写
  'COOKING_PROCESS',     // 制作过程
  'STAFF_ACTION',        // 员工操作
  'CUSTOMER_REACTION',   // 顾客反应
  'OWNER_TALKING',       // 老板口播
  'ENVIRONMENT',         // 环境氛围
  'OFFER_DISPLAY',       // 优惠展示
  'CTA_SCREEN',          // 行动号召画面
  'AI_GENERATED_FILLER', // AI 补充片段
])
export type ShotTaskType = z.infer<typeof ShotTaskTypeSchema>

/** 视频版本类型 — 渲染输出的不同版本 */
export const VideoVariantTypeSchema = z.enum([
  'PROMOTION',    // 促销引流版
  'ATMOSPHERE',   // 氛围种草版
  'OWNER_TALKING',// 老板口播版
  'TRUST',        // 信任背书版
  'PRODUCT',      // 产品展示版
])
export type VideoVariantType = z.infer<typeof VideoVariantTypeSchema>

/** 合规风险等级 — 从低到高 */
export const ComplianceRiskLevelSchema = z.enum([
  'LOW',      // 无风险
  'MEDIUM',   // 中等风险，警告但允许
  'HIGH',     // 高风险，需用户确认
  'BLOCKED',  // 阻断，禁止导出
])
export type ComplianceRiskLevel = z.infer<typeof ComplianceRiskLevelSchema>

/** 发布平台 — 支持的短视频/社交平台 */
export const PublishPlatformSchema = z.enum([
  'DOUYIN',           // 抖音
  'KUAISHOU',         // 快手
  'XIAOHONGSHU',      // 小红书
  'WECHAT_CHANNELS',  // 微信视频号
  'MANUAL_EXPORT',    // 手动导出（不指定平台）
])
export type PublishPlatform = z.infer<typeof PublishPlatformSchema>

/** 发布任务状态 */
export const PublishJobStatusSchema = z.enum([
  'DRAFT',       // 草稿
  'READY',       // 就绪
  'EXPORTING',   // 导出中
  'EXPORTED',    // 已导出
  'PUBLISHING',  // 发布中
  'PUBLISHED',   // 已发布
  'FAILED',      // 失败
])
export type PublishJobStatus = z.infer<typeof PublishJobStatusSchema>

// ========================
// 商家问诊
// ========================

/** 问诊表单 — 商品/优惠子项输入 */
export interface ProductOfferInput {
  /** 优惠名称，1-30 字符 */
  name: string
  /** 优惠描述，最长 200 字符 */
  description?: string
  /** 原价（分），0 表示免费 */
  originalPrice?: number
  /** 售价（分），0 表示免费 */
  salePrice?: number
  /** 卖点列表，最多 5 项，每项最长 50 字符 */
  sellingPoints?: string[]
  /** 使用规则说明，最长 200 字符 */
  usageRules?: string
}

/** 问诊表单 — 门店子项输入 */
export interface StoreInput {
  /** 门店名称，1-50 字符 */
  name: string
  /** 行业分类 */
  industry: MerchantIndustry
  /** 城市 */
  city?: string
  /** 区/县 */
  district?: string
  /** 商圈 */
  businessArea?: string
  /** 详细地址 */
  address?: string
  /** 人均消费（分） */
  avgTicket?: number
  /** 营业时间描述 */
  openingHours?: string
  /** 主打产品列表，1-20 项，每项最长 30 字符 */
  mainProducts: string[]
  /** 核心卖点，1-10 项，每项最长 50 字符 */
  mainSellingPoints: string[]
  /** 目标客群标签，最多 10 项 */
  targetCustomers?: string[]
  /** 是否可以拍厨房 */
  canShootKitchen?: boolean
  /** 是否可以拍员工 */
  canShootStaff?: boolean
  /** 是否可以拍顾客 */
  canShootCustomers?: boolean
  /** 是否有团购 */
  hasGroupBuying?: boolean
  /** 是否有预约 */
  hasReservation?: boolean
}

/** 问诊表单完整输入 */
export interface MerchantOnboardingInput {
  /** 商家名称，1-50 字符 */
  merchantName: string
  /** 联系人姓名，最长 30 字符 */
  contactName?: string
  /** 联系电话，最长 20 字符 */
  phone?: string
  /** 门店信息 */
  store: StoreInput
  /** 优惠活动列表，最多 20 项 */
  offers?: ProductOfferInput[]
}

/** 问诊成功响应 */
export interface OnboardingResponse {
  /** 新创建的商家 ID */
  merchantId: string
  /** 新创建的门店 ID */
  storeId: string
  /** 提示消息 */
  message: string
}

// ========================
// 门店画像
// ========================

/** 每周发布节奏条目 */
export interface WeeklyCadenceEntry {
  /** 星期几 (1=周一, 7=周日) */
  day: number
  /** 当日内容主题 */
  theme: string
  /** 当日发布数量 */
  count: number
}

/** 门店画像完整数据 */
export interface StoreProfileData {
  /** 画像 ID */
  id: string
  /** 关联门店 ID */
  storeId: string
  /** 内容定位 */
  contentPositioning: string | null
  /** 推荐人设 */
  recommendedPersona: string | null
  /** 视觉风格 */
  visualStyle?: string | null
  /** 内容应做清单 */
  contentDos: string[] | null
  /** 内容禁忌清单 */
  contentDonts: string[] | null
  /** 钩子关键词列表 (5-15 项) */
  hookKeywords: string[] | null
  /** 违禁表达列表 (≥5 项) */
  forbiddenClaims: string[] | null
  /** 首选行动号召列表 (3-5 项) */
  preferredCta: string[] | null
  /** 每周发布节奏 (7 天) */
  weeklyCadence: WeeklyCadenceEntry[] | null
  /** AI 生成的自然语言总结 */
  aiSummary: string | null
  /** 画像状态: COMPLETE | INCOMPLETE */
  status: string
  createdAt: Date
  updatedAt: Date
}

// ========================
// 质量检测
// ========================

/** 单个质量维度检测结果 */
export interface QualityDimensionResult {
  /** 检测值（分辨率字符串、时长数值、布尔值等） */
  value: string | number | boolean
  /** 是否通过该维度的阈值 */
  pass: boolean
  /** 未通过时的提示信息 */
  message?: string
}

/** 质量检测完整结果 */
export interface QualityInspectionResult {
  /** 总体质量评分 0-100 */
  qualityScore: number
  /** 是否通过（score >= 60 且无 critical） */
  passed: boolean
  /** 是否有致命问题（需拒绝素材） */
  critical: boolean
  /** 各维度详细检测报告 */
  report: {
    /** 画面方向（竖屏/横屏） */
    orientation: QualityDimensionResult
    /** 分辨率 */
    resolution: QualityDimensionResult
    /** 时长 */
    duration: QualityDimensionResult
    /** 文件大小 */
    fileSize: QualityDimensionResult
    /** 平均亮度 */
    brightness: QualityDimensionResult
    /** 音轨存在性 */
    audio: QualityDimensionResult
  }
  /** 非致命警告列表 */
  warnings: string[]
}

// ========================
// 合规
// ========================

/** 单条合规问题 */
export interface ComplianceIssue {
  /** 违规维度 */
  dimension: 'ABSOLUTE_CLAIM' | 'FALSE_POPULARITY' | 'CONSENT' | 'AIGC' | 'ENTROPY'
  /** 风险等级 */
  riskLevel: ComplianceRiskLevel
  /** 问题所在字段名 */
  field: string
  /** 匹配到的违规文本片段 */
  matchedText?: string
  /** 人类可读的原因说明 */
  reason: string
}

/** 合规检查完整结果 */
export interface ComplianceCheckResult {
  /** 检查记录 ID */
  id: string
  /** 关联内容任务 ID */
  contentBriefId: string
  /** 关联视频版本 ID */
  videoVariantId?: string
  /** 整体风险等级（取所有 issues 中最高等级） */
  riskLevel: ComplianceRiskLevel
  /** 问题列表 */
  issues: ComplianceIssue[]
  /** 修复建议 */
  suggestions?: string[]
  /** 阻断原因（仅 BLOCKED 时有值） */
  blockedReasons?: string[]
  /** 是否通过（仅 riskLevel=LOW 时为 true） */
  passed: boolean
  /** 用户确认时间（HIGH 风险确认后填入） */
  acknowledgedAt?: Date | null
  /** 创建时间 */
  createdAt: Date
}

// ========================
// 数据录入与学习
// ========================

/** 发布数据手动录入输入 */
export interface MetricsInput {
  /** 发布平台 */
  platform: PublishPlatform
  /** 播放量 */
  views: number
  /** 点赞数 */
  likes: number
  /** 评论数 */
  comments: number
  /** 转发数 */
  shares: number
  /** 收藏数 */
  saves: number
  /** 链接点击数 */
  linkClicks: number
  /** 私信数 */
  messages: number
  /** 下单数 */
  orders: number
  /** 核销数 */
  redemptions: number
  /** 营收（分） */
  revenueCents: number
}

/** 优化建议 */
export interface Suggestion {
  /** 建议类别 */
  category: 'hook' | 'CTA' | 'offer' | 'structure' | 'timing'
  /** 具体推荐动作 */
  action: string
  /** 支撑该建议的数据证据 */
  evidence: string
}

/** 表现学习分析结果 */
export interface PerformanceInsights {
  /** 优化建议列表 (1-5 条) */
  suggestions: Suggestion[]
  /** 推荐的下一周期内容目标 */
  recommendedNextGoals: ContentGoal[]
  /** 建议复用的剧本 ID 列表 */
  playbooksToReuse: string[]
  /** 建议避免的剧本 ID 列表 */
  playbooksToAvoid: string[]
}

// ========================
// 内容日历
// ========================

/** 剧本实例化输出 — 单条内容任务草稿 */
export interface ContentBriefDraft {
  /** 内容标题 */
  title: string
  /** 内容目标 */
  goal: ContentGoal
  /** 开场钩子 */
  hook: string
  /** 核心信息 */
  mainMessage: string
  /** 建议标题 */
  suggestedTitle: string
  /** 建议封面标题 */
  suggestedCoverTitle: string
  /** 建议正文文案 */
  suggestedCaption: string
  /** 建议行动号召 */
  suggestedCta: string
  /** 各平台文案 */
  platformCopies: Record<PublishPlatform, PlatformCopy>
  /** 标签列表 */
  tags: string[]
  /** AI 推理过程说明 */
  aiReasoning: string
  /** 拍摄任务草稿列表 */
  shotTasks: ShotTaskDraft[]
}

/** 拍摄任务草稿 */
export interface ShotTaskDraft {
  /** 序号（从 1 开始） */
  order: number
  /** 镜头类型 */
  type: ShotTaskType
  /** 标题（最长 20 字符，日常用语） */
  title: string
  /** 拍摄说明（最长 200 字符，日常用语） */
  instruction: string
  /** 建议时长（秒，3-15） */
  durationSec: number
  /** 是否必拍 */
  required: boolean
  /** 构图指引 */
  framingGuide?: Record<string, unknown>
  /** 质量规则 */
  qualityRules?: Record<string, unknown>
}

/** 单平台发布文案 */
export interface PlatformCopy {
  /** 标题，最长 30 字符 */
  title: string
  /** 封面文字，最长 15 字符 */
  coverTitle: string
  /** 正文文案（各平台长度限制不同） */
  caption: string
  /** 标签列表 (3-10 个) */
  tags: string[]
  /** 行动号召文本 */
  cta: string
}

// ========================
// 同质化检测
// ========================

/** 同质化原因条目 */
export interface EntropyReason {
  /** 维度：剧本/文本/素材 */
  dimension: 'PLAYBOOK' | 'TEXT' | 'SHOT_ASSET'
  /** 匹配到的历史内容 ID */
  matchedContentId: string
  /** 相似度数值 (0-1) */
  similarityValue: number
  /** 人类可读描述 */
  description: string
}

/** 同质化检测结果 */
export interface EntropyResult {
  /** 独特性评分 0-100，越高越独特 */
  uniquenessScore: number
  /** 重复风险等级 */
  duplicateRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  /** 重复原因列表 */
  reasons: EntropyReason[]
}

