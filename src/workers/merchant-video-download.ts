/**
 * 商家视频下载 Worker（REPLICATE_TRENDING 模式）
 *
 * 处理 'merchant-video-download' 队列任务：
 * 1. 使用 yt-dlp 下载源视频
 * 2. 上传 OSS
 * 3. 创建 RawAsset 记录（关联到 ContentBrief 的第一个 ShotTask）
 * 4. 链式触发 merchant-vedit（HappyHorse V-Edit：源视频 + 素材库参考图 + 提示词）
 *
 * 与 Project 流程的 download-video Worker 解耦，专用于 ContentBrief 复刻爆款场景。
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { happyHorseVEditQueue } from '@/lib/shared/queue'
import { refundMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { logger } from '@/lib/shared/logger'
import * as progressPublisher from '@/lib/shared/progress-publisher'
import { downloadWithYtDlp, uploadToOSS } from './download-video'

// ========================
// 类型定义
// ========================

export interface MerchantVideoDownloadJobData {
  /** 内容任务 ID */
  briefId: string
  /** 操作用户 ID */
  userId: string
  /** 复刻爆款源视频 URL */
  sourceVideoUrl: string
  /** 门店 ID */
  storeId: string
  /** 第一个镜头任务 ID（RawAsset 关联） */
  shotTaskId: string
  /** 计划总时长（秒） */
  plannedGroupDuration: number
  /** 预估积分消耗 */
  estimatedCost: number
  /** 复刻爆款：V-Edit 编辑指令提示词 */
  prompt: string
  /** 复刻爆款：@ 选中的素材库 RawAsset ID（V-Edit 参考图，最多 5 张） */
  referenceAssetIds: string[]
}

// ========================
// Worker 主逻辑
// ========================

async function processMerchantVideoDownload(
  job: Job<MerchantVideoDownloadJobData>
): Promise<void> {
  const {
    briefId,
    userId,
    sourceVideoUrl,
    storeId,
    shotTaskId,
    plannedGroupDuration,
    estimatedCost,
    prompt,
    referenceAssetIds,
  } = job.data

  logger.info(`[merchant-video-download] 开始下载 briefId=${briefId}`, {
    sourceVideoUrl,
    storeId,
  })

  try {
    // 确定性源视频 RawAsset id：一个 brief 对应一个爆款源视频。
    // BullMQ 重试或链式重触发时据此幂等，不重复下载、不产生重复 RawAsset 记录。
    const sourceAssetId = `msrc-${briefId}`

    let ossUrl: string
    const existingAsset = await prisma.rawAsset.findUnique({ where: { id: sourceAssetId } })
    if (existingAsset) {
      // 已下载过（重试场景）：直接复用，跳过下载与上传
      ossUrl = existingAsset.ossKey
      logger.info(`[merchant-video-download] 复用已下载源视频 briefId=${briefId}`, { ossUrl })
      await job.updateProgress(80)
    } else {
      // 1. 下载视频
      await job.updateProgress(10)
      await progressPublisher.publishStateChange(userId, 'generation', briefId, '下载源视频中')
      const { localPath } = await downloadWithYtDlp(sourceVideoUrl, briefId)
      logger.info(`[merchant-video-download] 下载完成 briefId=${briefId}`, { localPath })

      // 2. 上传 OSS
      await job.updateProgress(60)
      await progressPublisher.publishStateChange(userId, 'generation', briefId, '上传素材中')
      ossUrl = await uploadToOSS(localPath, briefId)
      logger.info(`[merchant-video-download] OSS 上传完成 briefId=${briefId}`, { ossUrl })

      // 3. 创建 RawAsset 记录（确定性 id，幂等）
      await job.updateProgress(80)
      await prisma.rawAsset.create({
        data: {
          id: sourceAssetId,
          storeId,
          shotTaskId,
          type: 'VIDEO',
          ossKey: ossUrl,
          durationSec: plannedGroupDuration,
        },
      })
    }

    // 4. 链式触发 merchant-vedit（HappyHorse V-Edit）
    // 用确定性 jobId：download 重试重复调用 add 时 BullMQ 去重，避免重复触发 V-Edit
    await job.updateProgress(90)
    await progressPublisher.publishStateChange(userId, 'generation', briefId, 'AI 编辑中')
    const veditJob = await happyHorseVEditQueue.add(
      `vedit-${briefId}`,
      {
        briefId,
        userId,
        storeId,
        sourceOssUrl: ossUrl,
        prompt,
        referenceAssetIds,
        estimatedCost,
      },
      {
        jobId: `vedit-${briefId}`,
      }
    )

    logger.info(
      `[merchant-video-download] 已触发 V-Edit briefId=${briefId} veditJobId=${veditJob.id}`
    )

    await job.updateProgress(100)
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '视频下载失败'
    const attempts = job.opts.attempts ?? 1
    const isFinalAttempt = job.attemptsMade >= attempts - 1
    logger.error(`[merchant-video-download] 任务失败 briefId=${briefId}`, {
      error: errorMsg,
      attemptsMade: job.attemptsMade,
      isFinalAttempt,
    })

    // 仅在最后一次重试仍失败时：置 FAILED + 全额退还入队前冻结的积分（refund 幂等）。
    // 中间重试保持 RENDERING，避免过早置 FAILED，也避免退款后又被重试导致状态错乱。
    if (isFinalAttempt) {
      await prisma.contentBrief.update({
        where: { id: briefId },
        data: { status: 'FAILED' },
      }).catch((e) => {
        logger.error(`[merchant-video-download] 回滚 brief 状态失败`, {
          briefId,
          error: e instanceof Error ? e.message : String(e),
        })
      })

      // 冻结在入队前由 creation-mode-router 完成；下载链路彻底失败需在此全额退款，
      // 否则冻结积分将永久泄漏（无 watchdog 覆盖 ContentBrief 的 RENDERING 冻结）。
      await refundMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: briefId,
      }).catch((e) => {
        logger.error(`[merchant-video-download] 退还冻结积分失败 briefId=${briefId}`, {
          error: e instanceof Error ? e.message : String(e),
        })
      })

      // 末次失败：推送 SSE failed，前端据此展示失败态（补齐下载阶段 SSE 静默缺口）
      await progressPublisher
        .publishFailed(userId, 'generation', briefId, errorMsg)
        .catch(() => {})
    }

    throw error // 让 BullMQ 重试（未到末次时）
  }
}

// ========================
// 创建 Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

const worker = new Worker<MerchantVideoDownloadJobData>(
  'merchant-video-download',
  processMerchantVideoDownload,
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 3,
      duration: 60000,
    },
  }
)

worker.on('completed', (job) => {
  logger.info(`[merchant-video-download] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  logger.error(`[merchant-video-download] 任务 ${job?.id} 失败`, {
    error: err.message,
  })
})

export default worker
export { processMerchantVideoDownload }
