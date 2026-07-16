/**
 * 商家 HappyHorse V-Edit 视频编辑 Worker（REPLICATE_TRENDING 复刻爆款）
 *
 * 处理 'merchant-vedit' 队列任务（由 merchant-video-download 下载源视频落 OSS 后链式入队）：
 * 1. 将 referenceAssetIds 解析为可抓取的签名 OSS URL（读 RawAsset.ossKey，最多 5 张）
 * 2. createHappyHorseTask（源视频 + 参考图 + 提示词，audio_setting=origin，720P）
 * 3. 轮询 getHappyHorseTaskStatus（约 60 次 × 5s）
 * 4. SUCCEEDED：下载结果视频（24h 过期）→ ffmpeg 抽封面 → uploadBuffer → 创建 VideoVariant
 * 5. 同事务内置 brief GENERATED + chargeMerchantCredits 实扣
 * 6. FAILED / 异常：refundMerchantCredits 全额退款 + 置 brief FAILED
 *
 * 计费链路：入队前 creation-mode-router 已 RESERVE 冻结；此处成功 CHARGE / 失败 REFUND。
 * attempts=1（见 queue.ts happyHorseVEditQueue）：失败即退款置 FAILED，不做 BullMQ 自动重试避免重复扣费。
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { randomUUID } from 'crypto'
import { writeFile, unlink, mkdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { logger } from '@/lib/shared/logger'
import {
  uploadBuffer,
  getSignedObjectUrl,
  extractKeyFromUrl,
  downloadToTemp,
} from '@/lib/shared/storage'
import { createHappyHorseTask, getHappyHorseTaskStatus } from '@/lib/shared/happyhorse'
import { chargeMerchantCredits, refundMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { calculateHappyHorseActualCost } from '@/lib/shared/credit-calc'
import * as progressPublisher from '@/lib/shared/progress-publisher'

const execFileAsync = promisify(execFile)

// ========================
// 类型定义
// ========================

export interface HappyHorseVEditJobData {
  /** 内容任务 ID */
  briefId: string
  /** 操作用户 ID（计费主体） */
  userId: string
  /** 门店 ID */
  storeId: string
  /** 源视频 OSS URL（merchant-video-download 上传后的直链） */
  sourceOssUrl: string
  /** V-Edit 编辑指令提示词（可含 [Image N] 引用参考图） */
  prompt: string
  /** @ 选中的素材库 RawAsset ID（V-Edit 参考图，最多 5 张） */
  referenceAssetIds: string[]
  /** 入队前 RESERVE 冻结的预估积分（durations 缺失时作为兜底实扣额） */
  estimatedCost: number
}

/** 参考图签名 URL 有效期（秒）：需覆盖 HappyHorse 创建任务后抓取媒体的窗口 */
const SIGN_EXPIRES = 3600

/** 轮询节奏：最多 60 次 × 5s ≈ 5 分钟，与 local-render-service 一致 */
const POLL_MAX_ATTEMPTS = 60
const POLL_INTERVAL_MS = 5000

// ========================
// 辅助：将存储的 key 或直链归一化为「外部可抓取的签名 URL」
// ========================

/**
 * RawAsset.ossKey 可能是 OSS 对象 key（素材库上传）或完整直链（源视频落 OSS 后写入）。
 * HappyHorse 需公网可抓取的 URL；Bucket 私有读时用短时效签名 URL。
 * - 完整直链：提取 key 后签名；无法提取（外部 URL）则原样返回
 * - 纯 key：直接签名
 * - OSS 未配置：回退原值（本地开发）
 */
function toFetchableUrl(keyOrUrl: string): string {
  try {
    if (keyOrUrl.startsWith('http')) {
      const key = extractKeyFromUrl(keyOrUrl)
      if (key) return getSignedObjectUrl(key, SIGN_EXPIRES)
      return keyOrUrl
    }
    return getSignedObjectUrl(keyOrUrl, SIGN_EXPIRES)
  } catch {
    return keyOrUrl
  }
}

// ========================
// Worker 主逻辑
// ========================

async function processMerchantVEdit(job: Job<HappyHorseVEditJobData>): Promise<void> {
  const { briefId, userId, storeId, sourceOssUrl, prompt, referenceAssetIds, estimatedCost } = job.data
  const tempFiles: string[] = []

  logger.info(`[merchant-vedit] 开始 V-Edit briefId=${briefId}`, {
    storeId,
    referenceCount: referenceAssetIds?.length ?? 0,
  })

  try {
    // 1. 解析参考素材为签名 URL（最多 5 张）
    await job.updateProgress(5)
    const referenceImages: string[] = []
    if (referenceAssetIds && referenceAssetIds.length > 0) {
      const assets = await prisma.rawAsset.findMany({
        where: { id: { in: referenceAssetIds.slice(0, 5) }, storeId },
        select: { id: true, ossKey: true },
      })
      // 按传入顺序保持稳定（[Image N] 引用需与顺序一致）
      const byId = new Map(assets.map((a) => [a.id, a.ossKey]))
      for (const id of referenceAssetIds.slice(0, 5)) {
        const ossKey = byId.get(id)
        if (ossKey) referenceImages.push(toFetchableUrl(ossKey))
      }
    }

    const videoUrl = toFetchableUrl(sourceOssUrl)

    // 2. 创建 HappyHorse V-Edit 任务
    await job.updateProgress(10)
    const { taskId } = await createHappyHorseTask({
      videoUrl,
      prompt,
      referenceImages,
      resolution: '720P',
      audioSetting: 'origin',
    })
    logger.info(`[merchant-vedit] 任务已创建 briefId=${briefId} taskId=${taskId}`)
    await progressPublisher.publishStateChange(userId, 'generation', briefId, 'AI 生成中')

    // 3. 轮询任务状态
    let result: { videoUrl?: string; inputDuration?: number; outputDuration?: number } | null = null
    for (let poll = 0; poll < POLL_MAX_ATTEMPTS; poll++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      const status = await getHappyHorseTaskStatus(taskId)
      if (status.status === 'SUCCEEDED') {
        result = {
          videoUrl: status.videoUrl,
          inputDuration: status.inputDuration,
          outputDuration: status.outputDuration,
        }
        break
      }
      if (status.status === 'FAILED') {
        throw new Error(`HappyHorse V-Edit 任务失败: ${status.error?.message || '未知原因'}`)
      }
      // 进度在 10~85 之间平滑推进
      await job.updateProgress(Math.min(85, 10 + Math.floor((poll / POLL_MAX_ATTEMPTS) * 75)))
    }
    if (!result || !result.videoUrl) {
      throw new Error(`HappyHorse V-Edit 任务超时（${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s）`)
    }

    // 4. 下载结果视频（24h 过期，需立即转存）→ 上传 OSS → 抽封面
    await job.updateProgress(88)
    const variantId = randomUUID()
    const videoOssKey = `merchant/${storeId}/variants/${variantId}.mp4`
    const coverOssKey = `merchant/${storeId}/variants/${variantId}_cover.jpg`

    const tempDir = path.join(tmpdir(), 'merchant-vedit')
    await mkdir(tempDir, { recursive: true })
    const videoTempPath = path.join(tempDir, `${variantId}.mp4`)
    tempFiles.push(videoTempPath)
    await downloadToTemp(result.videoUrl, videoTempPath)

    const videoBuffer = await readFile(videoTempPath)
    await uploadBuffer(videoOssKey, videoBuffer)

    // 封面帧：ffmpeg 抽第 1 秒真实帧（与 local-render 一致）
    let finalCoverKey: string | null = null
    try {
      const coverTempPath = path.join(tempDir, `${variantId}_cover.jpg`)
      tempFiles.push(coverTempPath)
      await execFileAsync('ffmpeg', [
        '-ss', '1',
        '-i', videoTempPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y', coverTempPath,
      ], { timeout: 30_000 })
      const coverBuffer = await readFile(coverTempPath)
      await uploadBuffer(coverOssKey, coverBuffer)
      finalCoverKey = coverOssKey
    } catch (coverErr) {
      logger.warn(`[merchant-vedit] 封面抽帧失败（不阻断）briefId=${briefId}`, {
        error: coverErr instanceof Error ? coverErr.message : String(coverErr),
      })
    }

    // 5. 创建 VideoVariant 记录
    await job.updateProgress(94)
    const outputDuration = result.outputDuration ?? result.inputDuration ?? 5

    // 读取产物真实分辨率（ffprobe）；失败回退竖屏默认值，避免元数据失真
    let outWidth = 720
    let outHeight = 1280
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        videoTempPath,
      ], { timeout: 30_000 })
      const probe = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> }
      const s = probe.streams?.[0]
      if (s?.width && s?.height) {
        outWidth = s.width
        outHeight = s.height
      }
    } catch (probeErr) {
      logger.warn(`[merchant-vedit] ffprobe 读取分辨率失败，回退 720x1280 briefId=${briefId}`, {
        error: probeErr instanceof Error ? probeErr.message : String(probeErr),
      })
    }

    const variant = await prisma.videoVariant.create({
      data: {
        id: variantId,
        contentBriefId: briefId,
        type: 'PROMOTION',
        title: '复刻爆款',
        ossKey: videoOssKey,
        coverOssKey: finalCoverKey,
        durationSec: outputDuration,
        width: outWidth,
        height: outHeight,
        styleLabel: '复刻爆款',
        generationLog: JSON.parse(JSON.stringify([
          { mode: 'REPLICATE_TRENDING', taskId, prompt, referenceCount: referenceImages.length },
        ])),
      },
    })

    // 6. 渲染成功——同事务内置 GENERATED + CHARGE 实扣
    // 实扣按 HappyHorse 实际输入/输出时长结算；durations 缺失时兜底用 estimatedCost
    const actualAmount =
      typeof result.inputDuration === 'number' && typeof result.outputDuration === 'number'
        ? calculateHappyHorseActualCost(result.inputDuration, result.outputDuration)
        : estimatedCost

    await job.updateProgress(97)
    await prisma.$transaction(async (tx) => {
      await tx.contentBrief.update({
        where: { id: briefId },
        data: { status: 'GENERATED' },
      })
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: briefId,
        actualAmount,
      })
    })

    await progressPublisher.publishCompleted(userId, 'generation', briefId)
    await job.updateProgress(100)

    logger.info(
      `[merchant-vedit] 复刻完成 briefId=${briefId} variantId=${variant.id} 实扣=${actualAmount}`
    )
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error(`[merchant-vedit] 任务失败 briefId=${briefId}`, { error: reason })

    // 置 FAILED（失败不阻断退款）
    try {
      await prisma.contentBrief.update({
        where: { id: briefId },
        data: { status: 'FAILED' },
      })
    } catch (statusErr) {
      logger.error(`[merchant-vedit] 更新 FAILED 状态失败 briefId=${briefId}`, {
        error: statusErr instanceof Error ? statusErr.message : String(statusErr),
      })
    }

    // 全额退款（幂等）；退款失败仅记日志，不掩盖原始错误
    try {
      await refundMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: briefId,
      })
    } catch (refundErr) {
      logger.error(`[merchant-vedit] 退还冻结积分失败 briefId=${briefId}`, {
        error: refundErr instanceof Error ? refundErr.message : String(refundErr),
      })
    }

    await progressPublisher.publishFailed(userId, 'generation', briefId, reason).catch(() => {})

    // attempts=1：不再重试，抛出仅用于将 BullMQ job 标记为 failed
    throw error
  } finally {
    for (const f of tempFiles) {
      try {
        await unlink(f)
      } catch {
        // 清理失败不阻断
      }
    }
  }
}

// ========================
// 创建 Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

const worker = new Worker<HappyHorseVEditJobData>(
  'merchant-vedit',
  processMerchantVEdit,
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60000,
    },
  }
)

worker.on('completed', (job) => {
  logger.info(`[merchant-vedit] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  logger.error(`[merchant-vedit] 任务 ${job?.id} 失败`, { error: err.message })
})

export default worker
export { processMerchantVEdit }
