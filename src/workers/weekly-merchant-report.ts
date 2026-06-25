/**
 * 商家周报 Worker（第一阶段占位）
 *
 * 后续实现：每周一自动生成门店经营周报（播放、转化、建议汇总）。
 * 当前阶段不处理任何 job，明确返回 NotImplemented 状态。
 */
import { Worker, UnrecoverableError, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { logger } from '@/lib/logger'

const connection = redis as unknown as ConnectionOptions

export const weeklyMerchantReportWorker = new Worker(
  'weekly-merchant-report',
  async (job) => {
    // P2 修复：占位 Worker 明确拒绝并标记为不可重试
    logger.warn('[weekly-merchant-report] 功能尚未实现（第一阶段占位），任务被拒绝', { jobId: job.id })
    throw new UnrecoverableError('weekly-merchant-report 功能尚未实现，请勿入队此类任务')
  },
  { connection, concurrency: 1 }
)

export default weeklyMerchantReportWorker
