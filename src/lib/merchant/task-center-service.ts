/**
 * 全局任务与通知中心服务 — 门店作用域聚合（需求 9）
 *
 * 职责：
 * 1. getTaskCenter：按「当前所选门店」作用域聚合进行中的任务，
 *    状态覆盖 待拍摄 / 渲染中 / 待导出 / 待发布（需求 9.1）。
 *    - 数据来源全部为真实状态（ContentBrief.status + PublishQueueItem 发布情况），
 *      绝不展示占位 / 伪造任务（需求 9.5，Property 32）。
 *    - 每项携带指向对应可操作页面（shoot/variants）的非空 actionHref（需求 9.4，Property 32）。
 *    - 作用域与门店切换器一致，仅返回该 store 的任务，不跨店混合聚合。
 * 2. listNotifications：按门店作用域返回通知中心列表（需求 9.3，Property 33）。
 * 3. markNotificationRead：标记某通知已读，置 read=true（需求 9.3，Property 33）。
 *
 * 计费说明：本服务仅做纯数据库读 / 写，不触发任何外部 AI 推理，不消耗积分。
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5
 * 备注：实时刷新（9.2，复用 progress-publisher SSE）、API 路由（13.4）、
 *      前端（13.5）为独立任务，本服务仅提供服务层聚合能力。
 */

import { prisma } from '@/lib/shared/db'
import type { PublishPlatform } from '@/types/merchant'
import type { StoreNotification } from '@/generated/prisma'

// ========================
// 类型定义
// ========================

/**
 * 任务中心条目（需求 9.1）—— 严格对应 design.md「9. task-center-service」接口。
 * status 取值范围与 Property 32 一致：待拍摄 / 渲染中 / 待导出 / 待发布。
 */
export interface TaskCenterItem {
  /** 任务类型 */
  type: 'SHOOT' | 'RENDER' | 'EXPORT' | 'PUBLISH'
  /** 所属内容任务 ID */
  briefId: string
  /** 关联的视频版本 ID（仅 PUBLISH 类任务携带） */
  variantId?: string
  /** 通俗状态文案：待拍摄 / 渲染中 / 待导出 / 待发布 */
  status: string
  /** 直达可操作页面的路由（需求 9.4），保证非空 */
  actionHref: string
}

/**
 * 已发布平台条目 —— 对应 PublishQueueItem.publishedPlatforms JSON 数组元素。
 * 与 publish-queue-service 中的结构保持一致：publishedAt 为 ISO 8601 字符串。
 */
interface PublishedPlatformEntry {
  platform: PublishPlatform
  publishedAt: string
}

// ========================
// 错误类型
// ========================

/** 业务逻辑错误 —— 目标实体缺失等 */
export class TaskCenterError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TaskCenterError'
    this.code = code
  }
}

// ========================
// 路由辅助
// ========================

/** 拍摄引导页路由（待拍摄任务直达） */
function shootHref(storeId: string, briefId: string): string {
  return `/merchant/stores/${storeId}/briefs/${briefId}/shoot`
}

/** 视频版本页路由（渲染中 / 待导出 / 待发布任务直达） */
function variantsHref(storeId: string, briefId: string): string {
  return `/merchant/stores/${storeId}/briefs/${briefId}/variants`
}

// ========================
// 任务中心聚合
// ========================

/**
 * 聚合当前所选门店作用域下的进行中任务（需求 9.1）。
 *
 * 真实状态映射（需求 9.5，不含占位）：
 * - 待拍摄：ContentBrief.status = READY_TO_SHOOT  → type SHOOT，直达 shoot 页
 * - 渲染中：ContentBrief.status = RENDERING       → type RENDER，直达 variants 页
 * - 待导出：ContentBrief.status = READY_TO_EXPORT → type EXPORT，直达 variants 页
 * - 待发布：PublishQueueItem 尚未标记发布到任何平台 → type PUBLISH，直达 variants 页
 *
 * @param input.storeId - 当前所选门店 ID（作用域键，不跨店混合）
 * @returns 该门店真实进行中任务列表，每项均带非空 actionHref（Property 32）
 */
export async function getTaskCenter(input: { storeId: string }): Promise<TaskCenterItem[]> {
  const { storeId } = input

  // ─── Step 1: 聚合 ContentBrief 阶段性状态（待拍摄 / 渲染中 / 待导出）───
  // 仅查询该门店、且处于需要呈现的真实状态的 brief，按计划日期升序保证稳定排序。
  const briefs = await prisma.contentBrief.findMany({
    where: {
      storeId,
      status: { in: ['READY_TO_SHOOT', 'RENDERING', 'READY_TO_EXPORT'] },
    },
    select: { id: true, status: true },
    orderBy: { scheduledDate: 'asc' },
  })

  const items: TaskCenterItem[] = []

  for (const brief of briefs) {
    switch (brief.status) {
      case 'READY_TO_SHOOT':
        items.push({
          type: 'SHOOT',
          briefId: brief.id,
          status: '待拍摄',
          actionHref: shootHref(storeId, brief.id),
        })
        break
      case 'RENDERING':
        items.push({
          type: 'RENDER',
          briefId: brief.id,
          status: '渲染中',
          actionHref: variantsHref(storeId, brief.id),
        })
        break
      case 'READY_TO_EXPORT':
        items.push({
          type: 'EXPORT',
          briefId: brief.id,
          status: '待导出',
          actionHref: variantsHref(storeId, brief.id),
        })
        break
      default:
        // 不可达：where 已限定状态集合
        break
    }
  }

  // ─── Step 2: 聚合待发布任务（PublishQueueItem 尚未标记发布到任何平台）───
  // 已导出但未标记发布的内容即「待发布」，按导出时间升序保持稳定排序。
  const queueItems = await prisma.publishQueueItem.findMany({
    where: { storeId },
    select: {
      contentBriefId: true,
      videoVariantId: true,
      publishedPlatforms: true,
    },
    orderBy: { exportedAt: 'asc' },
  })

  for (const item of queueItems) {
    const published: PublishedPlatformEntry[] = Array.isArray(item.publishedPlatforms)
      ? (item.publishedPlatforms as unknown as PublishedPlatformEntry[])
      : []
    // 仅当尚未发布到任何平台时纳入「待发布」，已发布的不再视为进行中任务。
    if (published.length === 0) {
      items.push({
        type: 'PUBLISH',
        briefId: item.contentBriefId,
        variantId: item.videoVariantId,
        status: '待发布',
        actionHref: variantsHref(storeId, item.contentBriefId),
      })
    }
  }

  return items
}

// ========================
// 通知中心
// ========================

/**
 * 通知中心列表（需求 9.3，Property 33）：仅返回当前所选门店作用域的通知。
 * 按创建时间倒序，最新通知排在最前；不跨店混合。
 *
 * @param input.storeId - 当前所选门店 ID（作用域键）
 * @returns 该门店的通知列表（含已读 / 未读状态）
 */
export async function listNotifications(input: {
  storeId: string
}): Promise<StoreNotification[]> {
  return prisma.storeNotification.findMany({
    where: { storeId: input.storeId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 标记某通知为已读（需求 9.3，Property 33）：置 read=true。
 *
 * @param input.notificationId - 通知 ID
 * @throws TaskCenterError 通知不存在时抛出
 */
export async function markNotificationRead(input: {
  notificationId: string
}): Promise<void> {
  const { notificationId } = input

  const existing = await prisma.storeNotification.findUnique({
    where: { id: notificationId },
    select: { id: true },
  })
  if (!existing) {
    throw new TaskCenterError('NOTIFICATION_NOT_FOUND', `StoreNotification 不存在: ${notificationId}`)
  }

  await prisma.storeNotification.update({
    where: { id: notificationId },
    data: { read: true },
  })
}
