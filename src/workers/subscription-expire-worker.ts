/**
 * 订阅到期 Worker
 * 处理 subscription-expire 队列任务：
 *
 * 定时任务（每小时全量扫描）：扫描 endDate < now 且 status 为 ACTIVE 或 CANCELED 的记录，
 * 批量调用 expireSubscription 将其标记为 EXPIRED 并撤销会员特权。
 *
 * 安全机制：已经是 EXPIRED 的记录会被 expireSubscription 内部幂等跳过。
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { expireSubscription } from '@/lib/subscription-service'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

/** 每次批量处理的最大记录数 */
const BATCH_SIZE = 100

async function processSubscriptionExpire(job: Job) {
  logger.info('[subscription-expire] 开始扫描过期订阅记录', { jobId: job.id })

  const now = new Date()
  let totalExpired = 0
  let hasMore = true

  // 分批处理，避免一次性加载过多记录
  while (hasMore) {
    const expiredRecords = await prisma.subscriptionRecord.findMany({
      where: {
        endDate: { lt: now },
        status: { in: ['ACTIVE', 'CANCELED'] },
      },
      select: { id: true },
      take: BATCH_SIZE,
    })

    if (expiredRecords.length === 0) {
      hasMore = false
      break
    }

    // 批量调用 expireSubscription（内部已做幂等保护，EXPIRED 记录自动跳过）
    for (const record of expiredRecords) {
      try {
        await expireSubscription(record.id)
        totalExpired++
      } catch (err) {
        logger.error('[subscription-expire] 单条记录过期处理失败', {
          recordId: record.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 如果本批次不满 BATCH_SIZE，说明已无更多记录
    if (expiredRecords.length < BATCH_SIZE) {
      hasMore = false
    }
  }

  logger.info('[subscription-expire] 扫描完成', {
    jobId: job.id,
    totalExpired,
  })

  return { totalExpired }
}

// 创建 Worker 实例
export const subscriptionExpireWorker = new Worker(
  'subscription-expire',
  processSubscriptionExpire,
  {
    connection,
    concurrency: 1,
  }
)

subscriptionExpireWorker.on('completed', (job) => {
  logger.info(`[subscription-expire] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

subscriptionExpireWorker.on('failed', (job, err) => {
  logger.error(`[subscription-expire] Job ${job?.id} 失败`, { error: err.message })
})
