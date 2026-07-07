/**
 * 并发对账 Worker
 * 处理 'concurrency-reconcile' 队列的定时任务
 *
 * 每 5 分钟执行一次全量对账：
 * 从数据库查询各用户真实活跃任务数，修复 Redis 并发计数器偏差。
 * 修复 Worker 崩溃/Redis 重启导致的计数泄漏，确保用户并发额度不被永久占用。
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { reconcileAll } from '@/lib/shared/concurrency-controller'
import { logger } from '@/lib/shared/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

/**
 * 对账任务处理函数
 * 调用 reconcileAll() 执行全量对账，修复 Redis 计数器与数据库真实值之间的偏差
 */
async function processConcurrencyReconcile(job: Job) {
  const startTime = Date.now()
  logger.info('[concurrency-reconcile] 开始执行并发计数对账', {
    jobId: job.id,
    timestamp: new Date(startTime).toISOString(),
  })

  try {
    await reconcileAll()

    const duration = Date.now() - startTime
    logger.info('[concurrency-reconcile] 对账完成', {
      jobId: job.id,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    })

    return { success: true, durationMs: duration }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    const duration = Date.now() - startTime

    logger.error('[concurrency-reconcile] 对账执行失败', {
      jobId: job.id,
      error: reason,
      durationMs: duration,
    })

    // 抛出错误让 BullMQ 处理重试逻辑
    throw error
  }
}

// 创建 Worker 实例
export const concurrencyReconcileWorker = new Worker(
  'concurrency-reconcile',
  processConcurrencyReconcile,
  {
    connection,
    concurrency: 1, // 对账任务无需并发，串行执行即可
  }
)

concurrencyReconcileWorker.on('completed', (job) => {
  if (job.returnvalue) {
    logger.info(`[concurrency-reconcile] Job ${job.id} 完成`, { result: job.returnvalue })
  }
})

concurrencyReconcileWorker.on('failed', (job, err) => {
  logger.error(`[concurrency-reconcile] Job ${job?.id} 失败`, { error: err.message })
})
