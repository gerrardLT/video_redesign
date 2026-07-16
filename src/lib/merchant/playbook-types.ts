/**
 * 行业剧本类型定义
 *
 * 定义剧本引擎所需的参数类型和数据模型。
 * Store / StoreProfile / ProductOffer 为服务层参数类型（JSON 列已解析为 string[]），
 * Playbook / BriefProvenance 为剧本引擎核心数据模型。
 */

import type {
  MerchantIndustry,
  ContentGoal,
  ShotTaskType,
  PublishPlatform,
} from '@/generated/prisma'
import type {
  ContentBriefDraft,
  ShotTaskDraft,
  PlatformCopy,
} from '@/types/merchant'

// ========================
// 服务层参数类型（字段子集，JSON 列已解析为 string[]）
// ========================

/** 门店信息（playbook-engine 所需字段子集） */
export interface Store {
  id: string
  name: string
  industry: MerchantIndustry | string
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

/** 门店画像（playbook-engine 所需字段子集） */
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

/** 商品/优惠（playbook-engine 所需字段子集） */
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
// 剧本数据模型
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
 * - references 每一条 value 必须来自画像真实取值集合（卖点/钩子词/人设/CTA），绝不伪造
 * - 无任何画像引用时 isGenericTemplate=true，前端如实显示「通用模板」
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

// Re-export for convenience
export type { ContentBriefDraft, ShotTaskDraft, PlatformCopy, ShotTaskType, PublishPlatform }
