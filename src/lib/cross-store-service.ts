/**
 * 跨店服务（cross-store-service）—— 多门店切换器数据 + 跨店看板聚合（需求 10）
 *
 * 本服务承载「多门店」场景下的两类只读聚合能力，均为纯读库、不消耗积分：
 * - getStoreSwitcher：门店切换器数据。仅当会员权益 maxStores>1 且商家实际拥有多家门店
 *   （storeCount>1）时返回多店列表，否则返回 { multiStore:false } 让前端隐藏切换器与跨店看板，
 *   不展示空壳（需求 10.1, 10.4 / Property 34）。maxStores 由既有 privilege-engine 提供。
 * - getCrossStoreDashboard：跨店看板。对商家名下每家门店做真实聚合查询，汇总本周内容完成度、
 *   最佳视频表现、待办数，绝不占位/伪造（需求 10.3, 10.5 / Property 35）。
 *
 * 门店归属链路：userId → Merchant（userId 唯一）→ stores。
 * 「本周」周期口径统一引用 period-service（尊重各门店 StoreProfile.weeklyCadence），杜绝另立口径。
 */

import { prisma } from '@/lib/db'
import { getMerchantPrivileges } from '@/lib/privilege-engine'
import { resolvePeriods, periodIndexOf, type PeriodRange } from '@/lib/period-service'
import type { ContentBriefStatus } from '@/types/merchant'

// ========================
// 类型定义
// ========================

/** 门店切换器数据：单店/无多店权益时 multiStore=false，前端据此隐藏切换器与看板 */
export type StoreSwitcher =
  | { multiStore: false }
  | { multiStore: true; stores: { storeId: string; name: string }[] }

/** 单门店本周内容完成度 */
export interface WeeklyCompletion {
  /** 本周（当前周期 index=0）排期的 brief 总数 */
  total: number
  /** 已完成数量（状态为 EXPORTED 或 PUBLISHED，即内容已产出/导出） */
  completed: number
  /** 完成率 = completed/total；total=0 时为 0（不伪造满分） */
  rate: number
  /** 本周周期通俗标签，如 "本周(1.6-1.12)" */
  weekLabel: string
}

/** 单门店最佳视频表现（基于真实 PublishMetric 聚合，无数据时为 null，不占位） */
export interface BestVideoSummary {
  /** 表现最佳的内容任务 ID */
  contentBriefId: string
  /** 内容任务标题 */
  title: string
  /** 该内容累计播放量（跨其所有 metrics 求和，作为主排序指标） */
  views: number
  /** 该内容累计点赞量 */
  likes: number
  /** 该内容累计转化量 = linkClicks + orders + redemptions */
  conversion: number
}

/** 跨店看板中单门店的 KPI 摘要 */
export interface StoreKpiSummary {
  /** 门店 ID */
  storeId: string
  /** 门店名称 */
  storeName: string
  /** 本周内容完成度 */
  weeklyCompletion: WeeklyCompletion
  /** 最佳视频表现；门店暂无任何带 metrics 的内容时为 null（不占位） */
  bestVideo: BestVideoSummary | null
  /** 待办数：处于待拍摄/渲染中/待导出/待发布等进行中状态的 brief 合计 */
  todoCount: number
}

// ========================
// 状态口径常量
// ========================

/**
 * 「待办」状态集合：与任务中心（需求 9）作用域一致，覆盖进行中的可操作状态。
 * 待拍摄(READY_TO_SHOOT) / 素材已传(MATERIALS_UPLOADED) / 渲染中(RENDERING) /
 * 待导出(GENERATED, COMPLIANCE_REVIEW, READY_TO_EXPORT) / 待发布(EXPORTED)。
 * 不含 DRAFT（尚未进入执行）与 PUBLISHED/FAILED/ARCHIVED（终态）。
 */
const TODO_STATUSES: ContentBriefStatus[] = [
  'READY_TO_SHOOT',
  'MATERIALS_UPLOADED',
  'RENDERING',
  'GENERATED',
  'COMPLIANCE_REVIEW',
  'READY_TO_EXPORT',
  'EXPORTED',
]

/**
 * 「已完成」状态集合：内容已导出或已发布，视为本周内容完成度的分子。
 */
const COMPLETED_STATUSES: ContentBriefStatus[] = ['EXPORTED', 'PUBLISHED']

// ========================
// 门店切换器
// ========================

/**
 * 获取门店切换器数据（需求 10.1, 10.4 / Property 34）。
 *
 * 可见性等价条件：当且仅当 `maxStores > 1 AND storeCount > 1` 时返回多店列表，
 * 其余情况（无商家身份 / 单店 / 权益不支持多店）一律返回 { multiStore:false }，
 * 前端据此隐藏切换器与跨店看板，不展示空壳。
 *
 * maxStores 由 privilege-engine.getMerchantPrivileges 提供；storeCount 为该商家名下实际门店数。
 * 纯读库，不消耗积分。
 *
 * @param input.userId 用户 ID
 */
export async function getStoreSwitcher(input: { userId: string }): Promise<StoreSwitcher> {
  const { userId } = input

  // maxStores 与门店列表互相独立，可并行查询
  const [privileges, stores] = await Promise.all([
    getMerchantPrivileges(userId),
    prisma.store.findMany({
      where: { merchant: { userId } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const maxStores = privileges.maxStores
  const storeCount = stores.length

  // 可见性等价：maxStores>1 且 storeCount>1 才提供切换器
  if (maxStores > 1 && storeCount > 1) {
    return {
      multiStore: true,
      stores: stores.map((s) => ({ storeId: s.id, name: s.name })),
    }
  }

  return { multiStore: false }
}

// ========================
// 跨店看板聚合
// ========================

/**
 * 跨店看板聚合（需求 10.3, 10.5 / Property 35）。
 *
 * 对商家名下每家门店做真实聚合查询，返回各门店的本周完成度、最佳视频表现、待办数。
 * 每个门店 KPI 等于对该门店独立真实聚合查询的结果，绝不占位/伪造。
 * 门店暂无数据时如实反映（完成度 0、最佳视频 null、待办数 0），不制造虚假指标。
 *
 * 可见性（单店/无多店权益时隐藏看板）由 getStoreSwitcher 统一裁决并交前端控制；
 * 本函数始终对所有名下门店返回真实聚合，保证 Property 35 的逐店正确性。
 *
 * 纯读库，不消耗积分。
 *
 * @param input.userId 用户 ID
 */
export async function getCrossStoreDashboard(input: { userId: string }): Promise<StoreKpiSummary[]> {
  const { userId } = input

  // 取商家名下全部门店（含周期口径所需的 weeklyCadence），按创建时间升序保证返回顺序确定
  const stores = await prisma.store.findMany({
    where: { merchant: { userId } },
    select: {
      id: true,
      name: true,
      profile: { select: { weeklyCadence: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (stores.length === 0) {
    return []
  }

  const now = new Date()

  // 逐店真实聚合（门店数受 maxStores 约束，规模可控）
  return Promise.all(
    stores.map((store) =>
      aggregateStoreKpi({
        storeId: store.id,
        storeName: store.name,
        weeklyCadence: store.profile?.weeklyCadence ?? null,
        now,
      })
    )
  )
}

/**
 * 聚合单门店的 KPI：本周完成度 + 最佳视频表现 + 待办数。
 * 三项均来自对该门店的独立真实查询，互不污染。
 */
async function aggregateStoreKpi(input: {
  storeId: string
  storeName: string
  weeklyCadence: unknown
  now: Date
}): Promise<StoreKpiSummary> {
  const { storeId, storeName, weeklyCadence, now } = input

  // 解析「本周」周期窗口（当前周期 index=0），尊重门店 weeklyCadence
  const [currentPeriod] = resolvePeriods({ weeklyCadence, referenceDate: now, count: 1 })

  const [weeklyCompletion, bestVideo, todoCount] = await Promise.all([
    computeWeeklyCompletion(storeId, currentPeriod),
    computeBestVideo(storeId),
    prisma.contentBrief.count({
      where: { storeId, status: { in: TODO_STATUSES } },
    }),
  ])

  return { storeId, storeName, weeklyCompletion, bestVideo, todoCount }
}

/**
 * 计算门店本周内容完成度：本周排期 brief 中已完成(EXPORTED/PUBLISHED)占比。
 * total=0 时 rate=0（不伪造满分）。
 */
async function computeWeeklyCompletion(
  storeId: string,
  period: PeriodRange
): Promise<WeeklyCompletion> {
  // 本周排期窗口 [startDate, endDate)（左闭右开），与 period-service 口径一致
  const where = {
    storeId,
    scheduledDate: { gte: period.startDate, lt: period.endDate },
  }

  const [total, completed] = await Promise.all([
    prisma.contentBrief.count({ where }),
    prisma.contentBrief.count({
      where: { ...where, status: { in: COMPLETED_STATUSES } },
    }),
  ])

  return {
    total,
    completed,
    rate: total > 0 ? completed / total : 0,
    weekLabel: period.label,
  }
}

/**
 * 计算门店最佳视频表现：取该门店带 metrics 的内容中累计播放量最高者。
 * 以 views 为主排序指标，平局时按 conversion 再按 briefId 决出，保证结果确定。
 * 门店暂无任何带 metrics 的内容时返回 null（不占位）。
 */
async function computeBestVideo(storeId: string): Promise<BestVideoSummary | null> {
  const briefs = await prisma.contentBrief.findMany({
    where: { storeId, metrics: { some: {} } },
    select: {
      id: true,
      title: true,
      metrics: {
        select: { views: true, likes: true, linkClicks: true, orders: true, redemptions: true },
      },
    },
  })

  if (briefs.length === 0) {
    return null
  }

  // 跨每条 brief 的所有 metrics 求和后比较
  const summaries: BestVideoSummary[] = briefs.map((brief) => {
    const agg = brief.metrics.reduce(
      (acc, m) => ({
        views: acc.views + m.views,
        likes: acc.likes + m.likes,
        conversion: acc.conversion + m.linkClicks + m.orders + m.redemptions,
      }),
      { views: 0, likes: 0, conversion: 0 }
    )
    return {
      contentBriefId: brief.id,
      title: brief.title,
      views: agg.views,
      likes: agg.likes,
      conversion: agg.conversion,
    }
  })

  // 选出最佳：views 降序 → conversion 降序 → briefId 升序（确定性）
  summaries.sort((a, b) => {
    if (b.views !== a.views) return b.views - a.views
    if (b.conversion !== a.conversion) return b.conversion - a.conversion
    return a.contentBriefId < b.contentBriefId ? -1 : a.contentBriefId > b.contentBriefId ? 1 : 0
  })

  return summaries[0]!
}
