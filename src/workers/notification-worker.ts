/**
 * 通知 Worker
 * 处理 notification 队列的定时任务：
 * - 'expiry-reminder'：资产过期提醒（user 作用域 Notification）
 * - 'publish-reminder'：发布超时提醒（门店作用域 StoreNotification，需求 8.3）
 *
 * expiry-reminder 逻辑：
 * 1. 调用 getExpiringAssets(3) 获取 3 天内即将过期的资产
 * 2. 按 userId 分组
 * 3. 对每个用户的每个资产调用 createAssetExpiringNotification()
 * 4. 避免重复通知（同一资产同一天只通知一次）
 *
 * publish-reminder 逻辑（需求 8.3，Property 30 超时提醒恰一次）：
 * 1. 扫描所有 reminded=false 的待发布清单项
 * 2. 判定：now - exportedAt > remindAfterH 小时 且 publishedPlatforms 为空（未标记发布）
 * 3. 命中则写入门店作用域 StoreNotification(type=PUBLISH_REMINDER)
 * 4. 通知发送成功后才置 reminded=true（与写通知同事务，保证恰一次）
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { getExpiringAssets, getRemainingDays } from '@/lib/shared/asset-lifecycle-service'
import { createAssetExpiringNotification } from '@/lib/shared/notification-service'
import { prisma } from '@/lib/shared/db'
import { logger } from '@/lib/shared/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

/**
 * 检查今天是否已经为该资产发送过过期提醒通知
 * 通过查询 Notification 表中 type=ASSET_EXPIRING 的今日记录，
 * 再在代码层精确比对 meta JSON 中的 assetId（避免 LIKE 子串误匹配）
 */
async function hasNotifiedToday(userId: string, assetId: string): Promise<boolean> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const candidates = await prisma.notification.findMany({
    where: {
      userId,
      type: 'ASSET_EXPIRING',
      createdAt: {
        gte: todayStart,
        lte: todayEnd,
      },
    },
    select: { meta: true },
  })

  // 代码层精确比对 meta.assetId，避免 contains 子串误匹配
  return candidates.some((n) => {
    if (!n.meta) return false
    try {
      const parsed = JSON.parse(n.meta as string)
      return parsed.assetId === assetId
    } catch {
      return false
    }
  })
}

async function processExpiryReminder(job: Job) {
  logger.info('[notification] 开始执行过期提醒任务', { jobId: job.id })

  // 获取 3 天内即将过期的资产
  const expiringAssets = await getExpiringAssets(3)

  if (expiringAssets.length === 0) {
    logger.info('[notification] 没有即将过期的资产，跳过', { jobId: job.id })
    return { notified: 0, skipped: 0 }
  }

  // 按 userId 分组
  const assetsByUser = new Map<string, typeof expiringAssets>()
  for (const asset of expiringAssets) {
    const userId = asset.project?.userId
    if (!userId) continue

    if (!assetsByUser.has(userId)) {
      assetsByUser.set(userId, [])
    }
    assetsByUser.get(userId)!.push(asset)
  }

  let notified = 0
  let skipped = 0

  // 对每个用户的每个资产创建通知
  for (const [userId, assets] of Array.from(assetsByUser.entries())) {
    for (const asset of assets) {
      try {
        // 避免重复通知：同一资产同一天只通知一次
        const alreadyNotified = await hasNotifiedToday(userId, asset.id)
        if (alreadyNotified) {
          skipped++
          continue
        }

        const daysLeft = getRemainingDays(asset.expiresAt!)

        await createAssetExpiringNotification(userId, {
          assetId: asset.id,
          projectId: asset.project!.id,
          projectName: asset.project!.name,
          expiresAt: asset.expiresAt!,
          daysLeft,
        })

        notified++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.error('[notification] 创建过期提醒通知失败', {
          userId,
          assetId: asset.id,
          error: errorMsg,
        })
      }
    }
  }

  logger.info('[notification] 过期提醒任务完成', {
    jobId: job.id,
    totalAssets: expiringAssets.length,
    notified,
    skipped,
  })

  return { notified, skipped }
}

/** 一小时对应的毫秒数（用于超时提醒时长换算） */
const MS_PER_HOUR = 60 * 60 * 1000

/** 待发布清单项发布平台条目结构（与 publish-queue-service.PublishedPlatformEntry 对齐） */
interface PublishedPlatformEntry {
  platform: string
  publishedAt: string
}

/** 发布超时提醒页路由：直达该内容任务的视频版本页（标记发布入口所在） */
function publishReminderHref(storeId: string, contentBriefId: string): string {
  return `/merchant/stores/${storeId}/briefs/${contentBriefId}/variants`
}

/**
 * 判定待发布清单项是否「已标记发布」。
 * publishedPlatforms 为 JSON 数组，非空即视为已发布到至少一个平台（需求 8.4）。
 */
function isPublished(publishedPlatforms: unknown): boolean {
  if (!Array.isArray(publishedPlatforms)) return false
  return (publishedPlatforms as PublishedPlatformEntry[]).length > 0
}

/**
 * 处理发布超时提醒（需求 8.3，Property 30 超时提醒恰一次）。
 *
 * 恰一次语义保证：
 * - 仅扫描 reminded=false 的清单项；reminded 一旦置位即不再纳入扫描，杜绝重复提醒。
 * - 写入 StoreNotification 与置 reminded=true 在同一事务内完成——
 *   通知发送（写库）成功后才提交 reminded=true；事务失败则整体回滚（reminded 保持 false），
 *   交由 BullMQ 重试，绝不会出现「已置位却没发出通知」或「发了通知却重复发」。
 * - 单项失败相互隔离并记录，最终若存在失败则抛错触发整体重试；
 *   已成功提醒的项因 reminded=true 不会在重试中被重复处理。
 *
 * @param job  BullMQ 任务（仅用于日志关联 jobId）
 * @param now  当前时间戳（毫秒），默认取 Date.now()；显式注入便于在测试中模拟时间推进/多次调度，
 *             不改变线上行为（线上始终走默认 Date.now()）。
 */
export async function processPublishReminder(job: Job, now: number = Date.now()) {
  logger.info('[notification] 开始执行发布超时提醒任务', { jobId: job.id })

  // 仅取尚未提醒的清单项（命中 @@index([reminded, exportedAt])）
  const candidates = await prisma.publishQueueItem.findMany({
    where: { reminded: false },
    select: {
      id: true,
      storeId: true,
      contentBriefId: true,
      exportedAt: true,
      remindAfterH: true,
      publishedPlatforms: true,
    },
  })

  let reminded = 0
  let skipped = 0
  const failedIds: string[] = []

  for (const item of candidates) {
    // 已标记发布则不需要提醒，跳过（不触碰 reminded，保留其语义）
    if (isPublished(item.publishedPlatforms)) {
      skipped++
      continue
    }

    // 判定是否超过 remindAfterH 小时仍未发布（基于导出时间）
    const elapsedH = (now - item.exportedAt.getTime()) / MS_PER_HOUR
    if (elapsedH <= item.remindAfterH) {
      skipped++
      continue
    }

    try {
      // 写通知 + 置 reminded=true 同事务，保证「发送成功后置位」且恰一次
      await prisma.$transaction(async (tx) => {
        await tx.storeNotification.create({
          data: {
            storeId: item.storeId,
            type: 'PUBLISH_REMINDER',
            title: '内容还没发布哦',
            body: '已导出的成片超过 24 小时还没标记发布，记得发到平台并回来标记一下～',
            actionHref: publishReminderHref(item.storeId, item.contentBriefId),
          },
        })
        await tx.publishQueueItem.update({
          where: { id: item.id },
          data: { reminded: true },
        })
      })
      reminded++
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('[notification] 创建发布超时提醒失败', {
        publishQueueItemId: item.id,
        storeId: item.storeId,
        error: errorMsg,
      })
      failedIds.push(item.id)
    }
  }

  logger.info('[notification] 发布超时提醒任务完成', {
    jobId: job.id,
    scanned: candidates.length,
    reminded,
    skipped,
    failed: failedIds.length,
  })

  // 存在失败则抛错交由 BullMQ 重试；已置位 reminded 的项不会被重复提醒
  if (failedIds.length > 0) {
    throw new Error(`发布超时提醒部分失败，待重试项: ${failedIds.join(', ')}`)
  }

  return { reminded, skipped, scanned: candidates.length }
}

/**
 * 通知 Worker 任务分发：按 job.name 路由到对应处理器。
 * - 'publish-reminder' → 发布超时提醒（需求 8.3）
 * - 其它（含 'expiry-reminder'）→ 资产过期提醒
 */
async function processNotificationJob(job: Job) {
  if (job.name === 'publish-reminder') {
    return processPublishReminder(job)
  }
  return processExpiryReminder(job)
}

// 创建 Worker 实例
export const notificationWorker = new Worker(
  'notification',
  processNotificationJob,
  {
    connection,
    concurrency: 1,
  }
)

notificationWorker.on('completed', (job) => {
  logger.info(`[notification] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

notificationWorker.on('failed', (job, err) => {
  logger.error(`[notification] Job ${job?.id} 失败`, { error: err.message })
})
