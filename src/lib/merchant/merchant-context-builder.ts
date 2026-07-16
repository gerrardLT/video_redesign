/**
 * 门店画像注入 AI Prompt
 *
 * 从 Store + StoreProfile 读取门店画像数据，构建 Seedance 生成用的「商家语境前缀」。
 * 仅在 merchant 入口创建的项目上激活，不影响通用视频处理入口的行为。
 *
 * 注入维度：
 * - 门店类型（industry）
 * - 品牌调性（brandTone）
 * - 主打产品（mainProducts）
 * - 核心卖点（mainSellingPoints）
 * - 目标客群（targetCustomers）
 * - 内容定位（contentPositioning from StoreProfile）
 * - 视觉风格（visualStyle from StoreProfile）
 *
 * 用途：
 * 1. local-render-service.ts 中 buildFillerPrompt() 补充片段生成
 * 2. group-gen-context.ts 中 buildGroupGenReference() 传统视频重塑流程（可选）
 */

import { prisma } from '../shared/db'
import { asStringArray } from '../shared/prisma-json-helpers'

// ========================
// 类型定义
// ========================

export interface MerchantContext {
  /** 构建好的 Seedance prompt 前缀 */
  promptPrefix: string
}

// ========================
// 行业中文映射
// ========================

const INDUSTRY_LABELS: Record<string, string> = {
  RESTAURANT: '餐饮',
  DRINK: '饮品/茶饮',
  BAKERY: '烘焙甜品',
  CAFE: '咖啡馆',
  HOTPOT: '火锅店',
  BBQ: '烧烤店',
  FAST_FOOD: '快餐店',
  OTHER_LOCAL: '其他本地生活',
}

// ========================
// 核心：构建商家语境前缀
// ========================

/**
 * 从 storeId 查询门店画像，构建 Seedance prompt 前缀。
 *
 * @param storeId 门店 ID
 * @returns MerchantContext 或 null（门店不存在时）
 */
export async function buildMerchantContext(storeId: string): Promise<MerchantContext | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { profile: true },
  })

  if (!store) return null

  const industry = INDUSTRY_LABELS[store.industry] || store.industry
  const brandTone = store.brandTone || null
  const mainProducts = asStringArray(store.mainProducts)
  const mainSellingPoints = asStringArray(store.mainSellingPoints)
  const targetCustomers = asStringArray(store.targetCustomers)
  const contentPositioning = store.profile?.contentPositioning || null
  const visualStyle = store.profile?.visualStyle || null

  // 构建 prompt 前缀
  const lines: string[] = [
    `[商家视频语境]`,
    `场景：本地生活实体商家营销视频`,
    `门店类型：${industry}`,
  ]

  if (brandTone) {
    lines.push(`品牌调性：${brandTone}`)
  }

  if (mainProducts.length > 0) {
    lines.push(`主打产品：${mainProducts.join('、')}`)
  }

  if (mainSellingPoints.length > 0) {
    lines.push(`核心卖点：${mainSellingPoints.join('、')}`)
  }

  if (targetCustomers.length > 0) {
    lines.push(`目标客群：${targetCustomers.join('、')}`)
  }

  if (contentPositioning) {
    lines.push(`内容定位：${contentPositioning}`)
  }

  if (visualStyle) {
    lines.push(`视觉风格：${visualStyle}`)
  }

  lines.push(`视频风格要求：真实感强、信息密度高、适合抖音本地生活推荐算法`)
  lines.push(``) // 空行分隔

  const promptPrefix = lines.join('\n')

  return {
    promptPrefix,
  }
}

/**
 * 通过 userId 查找用户的主门店画像（用于传统视频重塑流程）。
 * 仅当用户有 merchant 身份且有至少一个门店时返回上下文。
 *
 * @param userId 用户 ID
 * @returns MerchantContext 或 null（用户非商家或无门店）
 */
export async function buildMerchantContextByUserId(userId: string): Promise<MerchantContext | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    include: {
      stores: {
        where: { status: 'ACTIVE' },
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      },
    },
  })

  if (!merchant || merchant.stores.length === 0) return null

  return buildMerchantContext(merchant.stores[0].id)
}
