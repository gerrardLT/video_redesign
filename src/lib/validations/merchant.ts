/**
 * 本地生活营销平台 — Zod v4 验证 Schema
 *
 * 用于 API 路由层的请求体校验。所有 Schema 对应 design.md 中定义的约束。
 * 导出每个 Schema 及其推断类型，方便服务层直接使用。
 */

import { z } from 'zod/v4'
import {
  MerchantIndustrySchema,
  PublishPlatformSchema,
} from '@/types/merchant'

// ========================
// 商品/优惠验证
// ========================

/** 单条商品/优惠信息验证 */
export const ProductOfferSchema = z.object({
  /** 优惠名称，1-30 字符 */
  name: z.string().min(1, '优惠名称不能为空').max(30, '优惠名称最多 30 字符'),
  /** 描述，最长 200 字符 */
  description: z.string().max(200, '描述最多 200 字符').optional(),
  /** 原价（分），非负整数 */
  originalPrice: z.number().int('原价必须为整数').min(0, '原价不能为负').optional(),
  /** 售价（分），非负整数 */
  salePrice: z.number().int('售价必须为整数').min(0, '售价不能为负').optional(),
  /** 卖点列表，最多 5 项，每项最长 50 字符 */
  sellingPoints: z.array(z.string().max(50, '卖点最多 50 字符')).max(5, '卖点最多 5 项').optional(),
  /** 使用规则，最长 200 字符 */
  usageRules: z.string().max(200, '使用规则最多 200 字符').optional(),
})
export type ProductOfferInput = z.infer<typeof ProductOfferSchema>

// ========================
// 商家问诊完整表单验证
// ========================

/** 门店子结构验证 */
export const StoreInputSchema = z.object({
  /** 门店名称，1-50 字符 */
  name: z.string().min(1, '门店名称不能为空').max(50, '门店名称最多 50 字符'),
  /** 行业分类，必须为支持的餐饮类型 */
  industry: MerchantIndustrySchema,
  /** 城市，最长 20 字符 */
  city: z.string().max(20, '城市名最多 20 字符').optional(),
  /** 区/县，最长 20 字符 */
  district: z.string().max(20, '区县名最多 20 字符').optional(),
  /** 商圈，最长 30 字符 */
  businessArea: z.string().max(30, '商圈名最多 30 字符').optional(),
  /** 详细地址，最长 100 字符 */
  address: z.string().max(100, '地址最多 100 字符').optional(),
  /** 人均消费（分），正整数，最高 100000（即 1000 元） */
  avgTicket: z.number().int('人均消费必须为整数').positive('人均消费必须为正数').max(100000, '人均消费最高 100000').optional(),
  /** 营业时间描述，最长 50 字符 */
  openingHours: z.string().max(50, '营业时间描述最多 50 字符').optional(),
  /** 主打产品列表，1-20 项，每项最长 30 字符 */
  mainProducts: z.array(
    z.string().max(30, '产品名最多 30 字符')
  ).min(1, '至少填写 1 个主打产品').max(20, '主打产品最多 20 项'),
  /** 核心卖点，1-10 项，每项最长 50 字符 */
  mainSellingPoints: z.array(
    z.string().max(50, '卖点最多 50 字符')
  ).min(1, '至少填写 1 个卖点').max(10, '卖点最多 10 项'),
  /** 目标客群标签，最多 10 项，每项最长 30 字符 */
  targetCustomers: z.array(z.string().max(30, '客群标签最多 30 字符')).max(10, '目标客群最多 10 项').optional(),
  /** 是否可以拍厨房 */
  canShootKitchen: z.boolean().default(false),
  /** 是否可以拍员工 */
  canShootStaff: z.boolean().default(true),
  /** 是否可以拍顾客 */
  canShootCustomers: z.boolean().default(false),
  /** 是否有团购 */
  hasGroupBuying: z.boolean().default(false),
  /** 是否有预约 */
  hasReservation: z.boolean().default(false),
})
export type StoreInputData = z.infer<typeof StoreInputSchema>

/** 商家问诊完整表单验证 Schema */
export const MerchantOnboardingSchema = z.object({
  /** 商家名称，1-50 字符 */
  merchantName: z.string().min(1, '商家名称不能为空').max(50, '商家名称最多 50 字符'),
  /** 联系人姓名，最长 30 字符 */
  contactName: z.string().max(30, '联系人姓名最多 30 字符').optional(),
  /** 联系电话，最长 20 字符 */
  phone: z.string().max(20, '电话最多 20 字符').optional(),
  /** 门店信息 */
  store: StoreInputSchema,
  /** 优惠活动列表，最多 20 项 */
  offers: z.array(ProductOfferSchema).max(20, '优惠活动最多 20 项').optional(),
})
export type MerchantOnboardingData = z.infer<typeof MerchantOnboardingSchema>

// ========================
// 发布数据录入验证
// ========================

/** 数据指标最大值（9 亿，防止异常输入） */
const METRIC_MAX = 999_999_999

/** 发布数据录入验证 Schema */
export const MetricsInputSchema = z.object({
  /** 发布平台 */
  platform: PublishPlatformSchema,
  /** 播放量，非负整数 */
  views: z.number().int('播放量必须为整数').min(0, '播放量不能为负').max(METRIC_MAX, `播放量最大 ${METRIC_MAX}`),
  /** 点赞数 */
  likes: z.number().int('点赞数必须为整数').min(0, '点赞数不能为负').max(METRIC_MAX, `点赞数最大 ${METRIC_MAX}`),
  /** 评论数 */
  comments: z.number().int('评论数必须为整数').min(0, '评论数不能为负').max(METRIC_MAX, `评论数最大 ${METRIC_MAX}`),
  /** 转发数 */
  shares: z.number().int('转发数必须为整数').min(0, '转发数不能为负').max(METRIC_MAX, `转发数最大 ${METRIC_MAX}`),
  /** 收藏数 */
  saves: z.number().int('收藏数必须为整数').min(0, '收藏数不能为负').max(METRIC_MAX, `收藏数最大 ${METRIC_MAX}`),
  /** 链接点击数 */
  linkClicks: z.number().int('链接点击数必须为整数').min(0, '链接点击数不能为负').max(METRIC_MAX, `链接点击数最大 ${METRIC_MAX}`),
  /** 私信数 */
  messages: z.number().int('私信数必须为整数').min(0, '私信数不能为负').max(METRIC_MAX, `私信数最大 ${METRIC_MAX}`),
  /** 下单数 */
  orders: z.number().int('下单数必须为整数').min(0, '下单数不能为负').max(METRIC_MAX, `下单数最大 ${METRIC_MAX}`),
  /** 核销数 */
  redemptions: z.number().int('核销数必须为整数').min(0, '核销数不能为负').max(METRIC_MAX, `核销数最大 ${METRIC_MAX}`),
  /** 营收（分），非负整数 */
  revenueCents: z.number().int('营收必须为整数').min(0, '营收不能为负').max(METRIC_MAX, `营收最大 ${METRIC_MAX}`),
})
export type MetricsInputData = z.infer<typeof MetricsInputSchema>

// ========================
// 门店信息更新验证
// ========================

/** 门店信息更新 Schema — 所有字段可选（部分更新） */
export const StoreUpdateSchema = z.object({
  /** 门店名称 */
  name: z.string().min(1, '门店名称不能为空').max(50, '门店名称最多 50 字符').optional(),
  /** 城市 */
  city: z.string().max(20, '城市名最多 20 字符').optional(),
  /** 区/县 */
  district: z.string().max(20, '区县名最多 20 字符').optional(),
  /** 商圈 */
  businessArea: z.string().max(30, '商圈名最多 30 字符').optional(),
  /** 详细地址 */
  address: z.string().max(100, '地址最多 100 字符').optional(),
  /** 人均消费（分） */
  avgTicket: z.number().int('人均消费必须为整数').positive('人均消费必须为正数').max(100000, '人均消费最高 100000').optional(),
  /** 营业时间 */
  openingHours: z.string().max(50, '营业时间描述最多 50 字符').optional(),
  /** 主打产品 */
  mainProducts: z.array(z.string().max(30, '产品名最多 30 字符')).min(1, '至少 1 个产品').max(20, '最多 20 项').optional(),
  /** 核心卖点 */
  mainSellingPoints: z.array(z.string().max(50, '卖点最多 50 字符')).min(1, '至少 1 个卖点').max(10, '最多 10 项').optional(),
  /** 目标客群 */
  targetCustomers: z.array(z.string().max(30, '客群标签最多 30 字符')).max(10, '最多 10 项').optional(),
  /** 品牌调性描述 */
  brandTone: z.string().max(100, '品牌调性最多 100 字符').optional(),
  /** 拍摄能力 */
  canShootKitchen: z.boolean().optional(),
  canShootStaff: z.boolean().optional(),
  canShootCustomers: z.boolean().optional(),
  /** 平台能力 */
  hasGroupBuying: z.boolean().optional(),
  hasReservation: z.boolean().optional(),
  /** 备注 */
  notes: z.string().max(500, '备注最多 500 字符').optional(),
})
export type StoreUpdateData = z.infer<typeof StoreUpdateSchema>

// ========================
// 内容计划生成验证
// ========================

/** 内容计划生成请求 Schema */
export const ContentPlanGenerateSchema = z.object({
  /** 门店 ID（从路由参数获取时可省略） */
  storeId: z.string().min(1, '门店 ID 不能为空'),
  /** 开始日期（ISO 格式），默认明天 */
  startDate: z.string().datetime({ message: '日期格式不正确' }).optional(),
  /** 生成天数，默认 7 天，范围 1-14 */
  days: z.number().int('天数必须为整数').min(1, '至少 1 天').max(14, '最多 14 天').optional(),
})
export type ContentPlanGenerateData = z.infer<typeof ContentPlanGenerateSchema>
