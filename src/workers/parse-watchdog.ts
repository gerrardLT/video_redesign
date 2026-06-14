/**
 * 解析看门狗 Worker
 * 处理 'parse-watchdog' 队列的定时任务
 *
 * 每 10 分钟扫描一次 status='PARSING' 且 updatedAt 超过 30 分钟的项目，
 * 将其标记为 FAILED，避免项目因入队失败/Worker 宕机而永久卡死。
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

/** PARSING 状态超时阈值：30 分钟 */
const PARSING_TIMEOUT_MS = 30 * 60 * 1000

async function processParseWatchdog(job: Job) {
  const cutoff = new Date(Date.now() - PARSING_TIMEOUT_MS)

  // 查找卡死的项目（status=PARSING 且最后更新超过 30 分钟）
  const stuckProjects = await prisma.project.findMany({
    where: {
      status: 'PARSING',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, name: true, updatedAt: true },
  })

  if (stuckProjects.length === 0) {
    return { scanned: 0, marked: 0 }
  }

  logger.info('[parse-watchdog] 发现卡死项目', {
    count: stuckProjects.length,
    cutoff: cutoff.toISOString(),
  })

  // 逐个标记为 FAILED
  let markedCount = 0
  for (const project of stuckProjects) {
    try {
      await prisma.project.update({
        where: { id: project.id },
        data: {
          status: 'FAILED',
          errorMsg: `解析超时：项目在 PARSING 状态超过 30 分钟未完成，已自动标记失败。请重试解析。`,
        },
      })
      markedCount++
      logger.info('[parse-watchdog] 已标记超时项目', {
        projectId: project.id,
        projectName: project.name,
        lastUpdated: project.updatedAt.toISOString(),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error('[parse-watchdog] 标记超时项目失败', {
        projectId: project.id,
        error: reason,
      })
    }
  }

  return { scanned: stuckProjects.length, marked: markedCount }
}

// 创建 Worker 实例
export const parseWatchdogWorker = new Worker(
  'parse-watchdog',
  processParseWatchdog,
  {
    connection,
    concurrency: 1,
  }
)

parseWatchdogWorker.on('completed', (job) => {
  if (job.returnvalue && (job.returnvalue as { marked: number }).marked > 0) {
    logger.info(`[parse-watchdog] Job ${job.id} 完成`, { result: job.returnvalue })
  }
})

parseWatchdogWorker.on('failed', (job, err) => {
  logger.error(`[parse-watchdog] Job ${job?.id} 失败`, { error: err.message })
})
