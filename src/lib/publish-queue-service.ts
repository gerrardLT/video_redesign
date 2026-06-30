/**
 * 待发布清单服务 — 发布闭环（清单 + 标记发布）
 *
 * 职责（需求 8）：
 * 1. enqueueForPublish：VideoVariant 导出成功后加入待发布清单（需求 8.1），
 *    幂等防重复入列——每个已导出 variant 恰对应一个 PublishQueueItem（Property 29）。
 * 2. listPublishQueue：按门店作用域返回待发布清单视图（需求 8.2）。
 * 3. markPublished：手动标记已发布到某平台，记录平台与时间（需求 8.4，Property 31），
 *    纳入后续数据回填/复盘范围（可反哺）。
 *
 * 计费说明：本服务仅做纯数据库读/写，不触发任何外部 AI 推理，不消耗积分。
 *
 * Requirements: 8.1, 8.2, 8.4
 * 备注：超时提醒（8.3）由 notification-worker 实现（任务 11.4），
 *      接线（11.6）与 API（11.7）为独立任务，本服务仅提供服务层能力。
 */

import { prisma } from '@/lib/db'
import type { PublishPlatform } from '@/types/merchant'
import type { PublishQueueItem } from '@/generated/prisma'

// ========================
// 类型定义
// ========================

/**
 * 已发布平台条目 —— 对应 PublishQueueItem.publishedPlatforms JSON 数组元素（需求 8.4）。
 * publishedAt 以 ISO 8601 字符串存储于 JSON 中（JSON 无原生 Date 类型）。
 */
export interface PublishedPlatformEntry {
  /** 发布平台 */
  platform: PublishPlatform
  /** 发布时间（ISO 8601 字符串） */
  publishedAt: string
}

// ========================
// 错误类型
// ========================

/** 业务逻辑错误 —— 关联实体缺失或入参不合法 */
export class PublishQueueError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PublishQueueError'
    this.code = code
  }
}

// ========================
// 主函数
// ========================

/**
 * 将导出成功的 VideoVariant 加入待发布清单（需求 8.1）。
 *
 * 幂等保证（Property 29）：同一 videoVariantId 重复调用不会创建多条记录，
 * 已存在则直接返回既有 PublishQueueItem。storeId 由所属 ContentBrief 解析得到。
 *
 * @param input.videoVariantId - 已导出的视频版本 ID
 * @param input.contentBriefId - 该 variant 所属内容任务 ID
 * @returns 待发布清单项（新建或既有）
 * @throws PublishQueueError variant 不存在、brief 不存在或两者不匹配时抛出
 */
export async function enqueueForPublish(input: {
  videoVariantId: string
  contentBriefId: string
}): Promise<PublishQueueItem> {
  const { videoVariantId, contentBriefId } = input

  // ─── Step 1: 校验 variant 存在且归属于指定 brief ───
  const variant = await prisma.videoVariant.findUnique({
    where: { id: videoVariantId },
    select: { id: true, contentBriefId: true },
  })
  if (!variant) {
    throw new PublishQueueError('VARIANT_NOT_FOUND', `VideoVariant 不存在: ${videoVariantId}`)
  }
  if (variant.contentBriefId !== contentBriefId) {
    throw new PublishQueueError(
      'BRIEF_MISMATCH',
      `VideoVariant ${videoVariantId} 不属于 ContentBrief ${contentBriefId}`,
    )
  }

  // ─── Step 2: 解析门店作用域（storeId 取自所属 ContentBrief）───
  const brief = await prisma.contentBrief.findUnique({
    where: { id: contentBriefId },
    select: { storeId: true },
  })
  if (!brief) {
    throw new PublishQueueError('BRIEF_NOT_FOUND', `ContentBrief 不存在: ${contentBriefId}`)
  }

  // ─── Step 3: 幂等检查 —— 已入列则直接返回（Property 29：一一对应）───
  const existing = await prisma.publishQueueItem.findFirst({
    where: { videoVariantId },
  })
  if (existing) {
    return existing
  }

  // ─── Step 4: 创建待发布清单项 ───
  return prisma.publishQueueItem.create({
    data: {
      storeId: brief.storeId,
      contentBriefId,
      videoVariantId,
    },
  })
}

/**
 * 待发布清单视图（需求 8.2）：返回门店作用域下所有已导出内容的发布状态。
 * 调用方可读取每项的 publishedPlatforms 判断「未发布 / 已发布到 X 平台」。
 * 按导出时间倒序，最新导出排在最前。
 *
 * @param input.storeId - 当前所选门店 ID（作用域键）
 * @returns 该门店的待发布清单项列表
 */
export async function listPublishQueue(input: { storeId: string }): Promise<PublishQueueItem[]> {
  return prisma.publishQueueItem.findMany({
    where: { storeId: input.storeId },
    orderBy: { exportedAt: 'desc' },
  })
}

/**
 * 手动标记已发布到某平台（需求 8.4，Property 31）。
 *
 * 将「平台 + 发布时间」写入 publishedPlatforms JSON 数组；同一平台重复标记时
 * 以最新一次的发布时间覆盖，避免同平台重复堆积。标记后该内容即纳入后续
 * 数据回填/复盘范围（可反哺）。
 *
 * @param input.publishQueueItemId - 待发布清单项 ID
 * @param input.platform - 标记发布的目标平台
 * @param input.publishedAt - 发布时间
 * @throws PublishQueueError 清单项不存在时抛出
 */
export async function markPublished(input: {
  publishQueueItemId: string
  platform: PublishPlatform
  publishedAt: Date
}): Promise<void> {
  const { publishQueueItemId, platform, publishedAt } = input

  // ─── Step 1: 加载现有清单项 ───
  const item = await prisma.publishQueueItem.findUnique({
    where: { id: publishQueueItemId },
    select: { publishedPlatforms: true },
  })
  if (!item) {
    throw new PublishQueueError(
      'QUEUE_ITEM_NOT_FOUND',
      `PublishQueueItem 不存在: ${publishQueueItemId}`,
    )
  }

  // ─── Step 2: 解析既有发布记录（容错读取 JSON 数组）───
  const entries: PublishedPlatformEntry[] = Array.isArray(item.publishedPlatforms)
    ? (item.publishedPlatforms as unknown as PublishedPlatformEntry[])
    : []

  // ─── Step 3: 同平台去重（最新时间覆盖），追加本次发布记录 ───
  const next: PublishedPlatformEntry[] = entries.filter((e) => e.platform !== platform)
  next.push({ platform, publishedAt: publishedAt.toISOString() })

  // ─── Step 4: 持久化更新 ───
  await prisma.publishQueueItem.update({
    where: { id: publishQueueItemId },
    data: { publishedPlatforms: next as unknown as object[] },
  })
}
