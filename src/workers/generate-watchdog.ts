/**
 * 生成看门狗 Worker
 * 处理 'generate-watchdog' 队列的定时任务
 *
 * 目的（崩溃恢复）：后端 worker 进程在视频生成过程中崩溃时，正在生成的组任务会卡在
 * GENERATING、下游链式组卡在 QUEUED、项目卡在 GENERATING，且冻结积分（RESERVE）既不
 * CHARGE 也不 REFUND。BullMQ 的 stalled 重派也无法恢复（worker 重入时二次检查见 genStatus
 * 仍为 GENERATING 会直接跳过），故需独立看门狗兜底。
 *
 * 策略：每 10 分钟扫描 status='GENERATING' 的项目，若其**全部未完成 GenerationJob**最近
 * 一次更新都超过 STUCK_TIMEOUT（无任何进展），判定为崩溃卡死，调用 failProjectChain 退还
 * 所有未完成组的冻结积分（幂等）、置 Job/组/分镜与项目为 FAILED，解卡。用户随后可重新发起
 * 生成（路由仅重生非 SUCCEEDED 组，已成功组不重复扣费/不重复生成）。
 *
 * 阈值取 30min：单次 Seedance 生成最长轮询 10min，留足重试/退避余量，避免误杀仍在正常
 * 生成的任务（轮询期间 Job 行不写库，updatedAt 停留在置 GENERATING 时刻，故阈值必须 >10min）。
 */

import { Worker, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { failProjectChain } from './generate-video'
import { logger } from '@/lib/shared/logger'

const connection = redis as unknown as ConnectionOptions

/** 卡死判定阈值：未完成任务最近更新超过该时长且项目仍 GENERATING，视为崩溃卡死 */
const STUCK_TIMEOUT_MS = 30 * 60 * 1000

/** GenerationJob 的未完成（非终态）状态集合 */
const NON_TERMINAL_JOB_STATUSES = ['QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING'] as const

async function processGenerateWatchdog(): Promise<{ scanned: number; recovered: number }> {
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS)

  // 候选：仍处于 GENERATING 的项目
  const generatingProjects = await prisma.project.findMany({
    where: { status: 'GENERATING' },
    select: { id: true, userId: true, name: true },
  })

  if (generatingProjects.length === 0) {
    return { scanned: 0, recovered: 0 }
  }

  let recovered = 0

  for (const project of generatingProjects) {
    try {
      // 该项目所有未完成 Job 的最近更新时间
      const activeJobs = await prisma.generationJob.findMany({
        where: {
          projectId: project.id,
          status: { in: [...NON_TERMINAL_JOB_STATUSES] },
        },
        select: { updatedAt: true },
      })

      // 判定卡死：
      // - 无任何未完成 Job，但项目仍 GENERATING（状态漂移）→ 卡死，需解卡；
      // - 存在未完成 Job，但「最近一次更新」都早于 cutoff（无任何进展）→ 崩溃卡死。
      //   只要有任一未完成 Job 在 cutoff 之后更新过，说明仍在正常推进，跳过不处理。
      const hasRecentProgress = activeJobs.some((j) => j.updatedAt >= cutoff)
      if (activeJobs.length > 0 && hasRecentProgress) {
        continue
      }

      logger.info('[generate-watchdog] 发现卡死生成项目，执行退款解卡', {
        projectId: project.id,
        projectName: project.name,
        activeJobCount: activeJobs.length,
        cutoff: cutoff.toISOString(),
      })

      // 复用链式失败兜底：退还所有未完成组冻结积分（幂等）+ 置 Job/组/分镜/项目 FAILED
      await failProjectChain(
        project.id,
        project.userId,
        '生成超时未完成（疑似服务中断），已自动失败并退还冻结积分，可重新发起生成'
      )
      recovered++
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error('[generate-watchdog] 处理卡死项目失败', {
        projectId: project.id,
        error: reason,
      })
    }
  }

  return { scanned: generatingProjects.length, recovered }
}

// 创建 Worker 实例
export const generateWatchdogWorker = new Worker(
  'generate-watchdog',
  processGenerateWatchdog,
  {
    connection,
  }
)

generateWatchdogWorker.on('completed', (job) => {
  const result = job.returnvalue as { recovered: number } | undefined
  if (result && result.recovered > 0) {
    logger.info(`[generate-watchdog] Job ${job.id} 完成`, { result: job.returnvalue })
  }
})

generateWatchdogWorker.on('failed', (job, err) => {
  logger.error(`[generate-watchdog] Job ${job?.id} 失败`, { error: err.message })
})

export default generateWatchdogWorker
export { processGenerateWatchdog }
