/**
 * 订阅续费 Worker
 * 处理 subscription-renewal 队列任务：
 *
 * 1. 正常续费：接收 recordId → 查询 SubscriptionRecord → 验证 ACTIVE + renewalType=AUTO → 调用 triggerAutoRenewal
 * 2. 重试续费：isRetry=true 时调用 retryRenewal 执行重试逻辑
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { triggerAutoRenewal, retryRenewal } from '@/lib/subscription-service'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

interface SubscriptionRenewalJobData {
  recordId: string
  /** 是否为重试任务 */
  isRetry?: boolean
}

async function processSubscriptionRenewal(job: Job<SubscriptionRenewalJobData>) {
  const { recordId, isRetry } = job.data

  if (!recordId) {
    logger.warn('[subscription-renewal] 任务缺少 recordId', { jobId: job.id })
    return { recordId: null, skipped: true, reason: 'missing recordId' }
  }

  // 查询订阅记录
  const record = await prisma.subscriptionRecord.findUnique({
    where: { id: recordId },
  })

  if (!record) {
    logger.warn('[subscription-renewal] 订阅记录不存在', { jobId: job.id, recordId })
    return { recordId, skipped: true, reason: 'record not found' }
  }

  // 验证状态：仅 ACTIVE + AUTO 才执行
  if (record.status !== 'ACTIVE') {
    logger.info('[subscription-renewal] 订阅非 ACTIVE 状态，跳过', {
      jobId: job.id,
      recordId,
      status: record.status,
    })
    return { recordId, skipped: true, reason: `status is ${record.status}` }
  }

  if (record.renewalType !== 'AUTO') {
    logger.info('[subscription-renewal] 非自动续费类型，跳过', {
      jobId: job.id,
      recordId,
      renewalType: record.renewalType,
    })
    return { recordId, skipped: true, reason: `renewalType is ${record.renewalType}` }
  }

  // 区分正常续费与重试续费
  if (isRetry) {
    logger.info('[subscription-renewal] 执行重试续费', { jobId: job.id, recordId })
    await retryRenewal(recordId)
    logger.info('[subscription-renewal] 重试续费完成', { jobId: job.id, recordId })
    return { recordId, type: 'retry' }
  } else {
    logger.info('[subscription-renewal] 执行自动续费扣款', { jobId: job.id, recordId })
    await triggerAutoRenewal(recordId)
    logger.info('[subscription-renewal] 自动续费扣款完成', { jobId: job.id, recordId })
    return { recordId, type: 'auto-renewal' }
  }
}

// 创建 Worker 实例
export const subscriptionRenewalWorker = new Worker(
  'subscription-renewal',
  processSubscriptionRenewal,
  {
    connection,
    concurrency: 1,
  }
)

subscriptionRenewalWorker.on('completed', (job) => {
  logger.info(`[subscription-renewal] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

subscriptionRenewalWorker.on('failed', (job, err) => {
  logger.error(`[subscription-renewal] Job ${job?.id} 失败`, { error: err.message })
})
