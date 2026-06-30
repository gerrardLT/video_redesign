/**
 * 商家营销平台常量定义
 *
 * 本文件定义本地生活营销平台的核心业务常量，包括合规词库、
 * 每日目标分配、质量检测规则、会员权益映射、计费单价、平台约束等。
 * 不从 Prisma 导入枚举 — 常量文件应独立于生成代码。
 */
import type { UserTier } from '@/constants/concurrency'

// ============ 合规词库（Requirements 9.2, 9.3）============

/** 绝对化用语词库 — 匹配即为 HIGH 风险 */
export const ABSOLUTE_CLAIMS = [
  '最好', '第一', '全网最低', '唯一', '必吃',
  '不吃后悔', '保证', '100%', '全城第一', '最便宜',
] as const

/** 虚假火爆词库 — 匹配且无证据支撑为 MEDIUM 风险 */
export const FALSE_POPULARITY = [
  '全城排队', '每天卖爆', '全网疯抢', '万人好评',
] as const

// ============ 每日目标分配规则（Requirement 4.2）============

/** 周一到周日的 ContentGoal 固定分配 */
export const WEEKLY_GOAL_SCHEDULE = {
  1: 'TRAFFIC',         // 周一: 工作日午餐引流
  2: 'NEW_PRODUCT',     // 周二: 招牌产品/新品
  3: 'TRUST_BUILDING',  // 周三: 老板/厨师人设
  4: 'BRAND_STORY',     // 周四: 门店环境/体验
  5: 'WEEKEND_BOOST',   // 周五: 周末聚餐预热
  6: 'PROMOTION',       // 周六: 爆品/套餐促销
  7: 'REPEAT_PURCHASE', // 周日: 家庭/朋友聚餐
} as const

// ============ 质量检测维度权重与阈值（Requirement 6.2）============

/** 素材质量检测维度权重（总和 100） */
export const QUALITY_WEIGHTS = {
  orientation: 20,
  resolution: 25,
  duration: 20,
  fileSize: 10,
  brightness: 15,
  audio: 10,
} as const

/** 素材质量检测阈值 */
export const QUALITY_THRESHOLDS = {
  minResolutionShortEdge: 720,          // 最低分辨率短边 px
  criticalResolutionShortEdge: 480,     // 致命低分辨率短边 px
  maxFileSize: 300 * 1024 * 1024,       // 300MB
  minDuration: 1,                        // 最短时长 秒
  minBrightness: 15,                     // 最低亮度 (0-255)
  qualityPassScore: 60,                  // 质量合格线
} as const

// ============ 会员权益映射与计费单价（merchant-billing-unification）============

/**
 * 内容计划生成固定积分单价（设计阶段确定，取值 ≥ 0）
 * 内容计划生成走 RESERVE→CHARGE/REFUND 流程，按此固定单价冻结/扣费。
 */
export const CREDIT_COST_CONTENT_PLAN = 10

/**
 * 生成单张镜头参考图固定积分单价（设计阶段确定，取值 ≥ 0）
 * 参考图为一次文生图调用（Seedream 5.0 lite），成本远低于视频渲染，
 * 走 RESERVE→CHARGE/REFUND 流程，按此固定单价冻结/扣费（需求 3.5）。
 */
export const CREDIT_COST_SHOT_REFERENCE_IMAGE = 2

/**
 * 单平台文案生成/改写固定积分单价（需求 2.2 重新生成文案 / 2.4 按平台改写）
 * 触发外部 LLM 推理，走 RESERVE→CHARGE/REFUND 流程，按此固定单价冻结/扣费。
 * 取值远小于视频渲染：仅一次文本推理，按单平台单次计费。
 */
export const CREDIT_COST_COPY_REWRITE = 2

/**
 * UserTier → 本地生活会员权益映射（Privilege_Mapping）
 * 由视频重塑既有订阅体系的 UserTier（FREE / MONTHLY / YEARLY）直接决定本地生活权益，
 * 替代原按套餐 name 解读的 Merchant_Tier（SUBSCRIPTION_TIERS）。
 * - FREE：720p 导出、关闭合规检测、关闭数据洞察、门店上限 1
 * - MONTHLY：1080p 导出、开放合规检测、开放数据洞察、门店上限 3
 * - YEARLY：1080p 导出、开放合规检测、开放数据洞察、门店上限 10
 */
export const MERCHANT_PRIVILEGE_MAPPING: Record<UserTier, {
  exportResolution: '720p' | '1080p'
  complianceCheckEnabled: boolean
  insightsEnabled: boolean
  maxStores: number
}> = {
  FREE:    { exportResolution: '720p',  complianceCheckEnabled: false, insightsEnabled: false, maxStores: 1 },
  MONTHLY: { exportResolution: '1080p', complianceCheckEnabled: true,  insightsEnabled: true,  maxStores: 3 },
  YEARLY:  { exportResolution: '1080p', complianceCheckEnabled: true,  insightsEnabled: true,  maxStores: 10 },
} as const

// ============ 平台文案约束（Requirement 8.2）============

/** 各平台文案字数上限 */
export const PLATFORM_CAPTION_LIMITS = {
  DOUYIN: 300,
  XIAOHONGSHU: 1000,
  WECHAT_CHANNELS: 200,
  KUAISHOU: 300,
} as const

// ============ 拍摄与剧本时长约束（Requirements 3.3, 7.2, 13.2）============

/** 单镜头时长范围（秒） */
export const SHOT_DURATION_RANGE = { min: 3, max: 15 } as const

/** 剧本总时长范围（秒） */
export const PLAYBOOK_DURATION_RANGE = { min: 10, max: 60 } as const

/** 剧本最大连续使用次数 */
export const MAX_CONSECUTIVE_PLAYBOOK_USE = 3

/** 同质化检测窗口（天） */
export const ENTROPY_WINDOW_DAYS = 30

/** 同质化分数阈值 */
export const ENTROPY_THRESHOLDS = {
  blocked: 40,            // < 40 阻断
  warning: 60,            // 40-60 警告
  textSimilarity: 0.8,   // 文本相似度阈值
} as const

/** 渲染超时（毫秒） */
export const RENDER_TIMEOUT_MS = 600_000

/** 分布式锁 TTL（毫秒） */
export const RENDER_LOCK_TTL_MS = 720_000

/** 每个 VideoVariant 最多允许的 Seedance 补充片段数 */
export const MAX_FILLER_CLIPS_PER_VARIANT = 3

/** 每个补充片段最大时长（秒） */
export const MAX_FILLER_DURATION_SEC = 5

/** 导出下载 URL 有效期（秒） */
export const EXPORT_URL_EXPIRY_SECONDS = 24 * 60 * 60

/** 每个 ContentBrief 最多允许的 metrics 条目数 */
export const MAX_METRICS_PER_BRIEF = 50
