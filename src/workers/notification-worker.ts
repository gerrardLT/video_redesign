/**
 * 通知 Worker
 * 处理 notification 队列的 'expiry-reminder' 定时任务
 *
 * 逻辑：
 * 1. 调用 getExpiringAssets(3) 获取 3 天内即将过期的资产
 * 2. 按 userId 分组
 * 3. 对每个用户的每个资产调用 createAssetExpiringNotification()
 * 4. 避免重复通知（同一资产同一天只通知一次）
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { getExpiringAssets, getRemainingDays } from '@/lib/asset-lifecycle-service'
import { createAssetExpiringNotification } from '@/lib/notification-service'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
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

// 创建 Worker 实例
export const notificationWorker = new Worker(
  'notification',
  processExpiryReminder,
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
