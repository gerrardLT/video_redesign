/**
 * 订单过期 Worker
 * 处理 order-expire 队列的两种任务：
 *
 * 1. 'expire-orders': 定时任务（每 5 分钟），调用 expireTimedOutOrders() 批量过期超时订单
 * 2. 延迟任务（从 createOrder 添加的单个订单过期），调用 expireOrder(orderId) 过期单个订单
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { expireTimedOutOrders, expireOrder } from '@/lib/shared/order-service'
import { logger } from '@/lib/shared/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

interface ExpireOrderJobData {
  orderId?: string
}

async function processOrderExpire(job: Job<ExpireOrderJobData>) {
  const jobName = job.name

  // 区分任务名称处理不同逻辑
  if (jobName === 'expire-orders') {
    // 定时任务：批量过期超时订单
    logger.info('[order-expire] 开始批量过期超时订单', { jobId: job.id })

    const expiredCount = await expireTimedOutOrders()

    logger.info('[order-expire] 批量过期任务完成', {
      jobId: job.id,
      expiredCount,
    })

    return { type: 'batch', expiredCount }
  } else {
    // 延迟任务：过期单个订单（从 createOrder 添加的）
    const { orderId } = job.data

    if (!orderId) {
      logger.warn('[order-expire] 延迟任务缺少 orderId', { jobId: job.id, jobName })
      return { type: 'single', orderId: null, skipped: true }
    }

    logger.info('[order-expire] 开始过期单个订单', { jobId: job.id, orderId })

    await expireOrder(orderId)

    logger.info('[order-expire] 单个订单过期完成', {
      jobId: job.id,
      orderId,
    })

    return { type: 'single', orderId }
  }
}

// 创建 Worker 实例
export const orderExpireWorker = new Worker(
  'order-expire',
  processOrderExpire,
  {
    connection,
    concurrency: 1,
  }
)

orderExpireWorker.on('completed', (job) => {
  logger.info(`[order-expire] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

orderExpireWorker.on('failed', (job, err) => {
  logger.error(`[order-expire] Job ${job?.id} 失败`, { error: err.message })
})
