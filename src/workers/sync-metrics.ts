/**
 * 数据同步 Worker（第一阶段占位）
 *
 * 后续实现：通过平台 API 自动同步视频表现数据。
 * 当前阶段不处理任何 job，明确返回 NotImplemented 状态。
 */
import { Worker, UnrecoverableError, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { logger } from '@/lib/shared/logger'

const connection = redis as unknown as ConnectionOptions

export const syncMetricsWorker = new Worker(
  'sync-metrics',
  async (job) => {
    // P2 修复：占位 Worker 明确拒绝并标记为不可重试，而非静默跳过
    logger.warn('[sync-metrics] 功能尚未实现（第一阶段占位），任务被拒绝', { jobId: job.id })
    throw new UnrecoverableError('sync-metrics 功能尚未实现，请勿入队此类任务')
  },
  { connection, concurrency: 1 }
)

export default syncMetricsWorker
