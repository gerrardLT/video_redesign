/**
 * 视频超分 Worker
 * 处理 video-upscale 队列任务
 *
 * 流程：
 * 1. 向 WaveSpeed API 提交超分任务
 * 2. 轮询等待结果（间隔 5s，最多 120 次/10 分钟）
 * 3. 成功：下载超分视频 → 上传 OSS → 正式扣费 → 标记完成
 * 4. 失败：返还冻结积分 → 标记失败
 *
 * 容错策略：
 * - WaveSpeed 5xx：指数退避重试 3 次（2s, 4s, 8s）
 * - WaveSpeed 429：等待 30s 后重试 1 次
 * - 下载/上传 OSS 失败：重试 2 次（间隔 5s），全部失败后退款标记失败
 * - 扣费幂等：通过 projectId 关联，chargeCreditsTx 内置幂等检查
 * - 退款幂等：通过 projectId 作为 jobId，refundCredits 内置幂等检查
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { chargeCreditsTx } from '@/lib/credit-service'
import { uploadFile } from '@/lib/storage'
import {
  submitUpscaleTask,
  getUpscaleResult,
  WaveSpeedApiError,
} from '@/lib/wavespeed'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import type { ConnectionOptions } from 'bullmq'
import { withCreditLock } from '@/lib/distributed-lock'

const connection = redis as unknown as ConnectionOptions

// ========================
// 类型定义
// ========================

export interface VideoUpscaleJobData {
  projectId: string
  userId: string
  /** 合并视频的 OSS 公开 URL */
  mergedVideoOssUrl: string
  /** 目标分辨率 */
  targetResolution: '720p' | '1080p'
  /** 冻结的积分数 */
  reservedCredits: number
  /** 视频时长（秒） */
  videoDuration: number
}

// ========================
// 常量配置
// ========================

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 5_000
/** 最大轮询次数（120 次 × 5s = 10 分钟） */
const MAX_POLL_COUNT = 120
/** 5xx 重试次数 */
const SERVER_ERROR_MAX_RETRIES = 3
/** 429 限流等待时间（毫秒） */
const RATE_LIMIT_WAIT_MS = 30_000
/** OSS 操作重试次数 */
const OSS_MAX_RETRIES = 2
/** OSS 重试间隔（毫秒） */
const OSS_RETRY_INTERVAL_MS = 5_000

// ========================
// 辅助函数
// ========================

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带指数退避的 5xx 重试包装
 */
async function submitWithRetry(
  params: { video: string; targetResolution: '720p' | '1080p' }
): Promise<{ requestId: string }> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= SERVER_ERROR_MAX_RETRIES + 1; attempt++) {
    try {
      return await submitUpscaleTask(params)
    } catch (error) {
      if (error instanceof WaveSpeedApiError) {
        if (error.isRateLimited) {
          // 429 限流：等待后重试 1 次
          console.warn(`[upscale-video] WaveSpeed 429 限流，等待 ${RATE_LIMIT_WAIT_MS / 1000}s 后重试...`)
          await sleep(RATE_LIMIT_WAIT_MS)
          return await submitUpscaleTask(params) // 仅重试一次
        }
        if (error.isServerError && attempt <= SERVER_ERROR_MAX_RETRIES) {
          // 5xx：指数退避重试
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
          console.warn(`[upscale-video] WaveSpeed ${error.statusCode}，${delay / 1000}s 后重试 (${attempt}/${SERVER_ERROR_MAX_RETRIES})...`)
          await sleep(delay)
          lastError = error
          continue
        }
      }
      throw error
    }
  }

  throw lastError || new Error('超分任务提交失败：重试耗尽')
}

/**
 * 轮询 WaveSpeed 超分结果（带 5xx/429 容错）
 */
async function pollUpscaleResult(
  requestId: string
): Promise<{ status: 'completed'; outputUrl: string } | { status: 'failed'; error: string }> {
  for (let i = 0; i < MAX_POLL_COUNT; i++) {
    await sleep(POLL_INTERVAL_MS)

    let result
    try {
      result = await getUpscaleResult(requestId)
    } catch (error) {
      if (error instanceof WaveSpeedApiError) {
        if (error.isServerError) {
          // 5xx：指数退避重试 3 次
          let recovered = false
          for (let retry = 1; retry <= SERVER_ERROR_MAX_RETRIES; retry++) {
            const delay = Math.pow(2, retry) * 1000
            console.warn(`[upscale-video] 轮询 5xx，${delay / 1000}s 后重试 (${retry}/${SERVER_ERROR_MAX_RETRIES})...`)
            await sleep(delay)
            try {
              result = await getUpscaleResult(requestId)
              recovered = true
              break
            } catch (retryError) {
              if (retryError instanceof WaveSpeedApiError && retryError.isServerError) continue
              throw retryError
            }
          }
          if (!recovered) {
            return { status: 'failed', error: `WaveSpeed 服务器持续不可用 (${error.statusCode})` }
          }
        } else if (error.isRateLimited) {
          console.warn(`[upscale-video] 轮询 429 限流，等待 ${RATE_LIMIT_WAIT_MS / 1000}s...`)
          await sleep(RATE_LIMIT_WAIT_MS)
          continue
        } else {
          return { status: 'failed', error: error.message }
        }
      } else {
        throw error
      }
    }

    if (!result) continue

    if (result.status === 'completed') {
      const outputUrl = result.outputs?.[0]
      if (!outputUrl) {
        return { status: 'failed', error: 'WaveSpeed 返回成功但无输出视频 URL' }
      }
      return { status: 'completed', outputUrl }
    }

    if (result.status === 'failed') {
      return { status: 'failed', error: result.error || 'WaveSpeed 超分处理失败' }
    }

    // 'created' | 'processing' → 继续轮询
  }

  // 超时
  return { status: 'failed', error: `轮询超时（${MAX_POLL_COUNT * POLL_INTERVAL_MS / 1000}s）` }
}

/**
 * 下载远程视频到本地
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 VideoUpscaler/1.0' },
  })

  if (!response.ok) {
    throw new Error(`下载超分视频失败: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(outputPath, buffer)
}

/**
 * 上传超分视频到 OSS（带重试）
 */
async function uploadUpscaledVideoToOSS(
  filePath: string,
  userId: string,
  projectId: string
): Promise<string> {
  const ossKey = `exported/${userId}/${projectId}/upscaled_${Date.now()}.mp4`

  for (let attempt = 1; attempt <= OSS_MAX_RETRIES + 1; attempt++) {
    try {
      const ossUrl = await uploadFile(ossKey, filePath)
      return ossUrl
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (attempt <= OSS_MAX_RETRIES) {
        console.warn(`[upscale-video] 上传 OSS 第 ${attempt} 次失败（${reason}），${OSS_RETRY_INTERVAL_MS / 1000}s 后重试...`)
        await sleep(OSS_RETRY_INTERVAL_MS)
      } else {
        throw new Error(`超分视频上传 OSS 全部 ${OSS_MAX_RETRIES + 1} 次尝试失败: ${reason}`)
      }
    }
  }

  throw new Error('上传超分视频到 OSS 失败（不应到达此处）')
}

// ========================
// Worker 主逻辑
// ========================

async function processUpscaleVideo(job: Job<VideoUpscaleJobData>) {
  const { projectId, userId, mergedVideoOssUrl, targetResolution, reservedCredits, videoDuration } = job.data

  console.log(`[upscale-video] 开始超分项目 ${projectId}:`, {
    targetResolution,
    reservedCredits,
    videoDuration: `${videoDuration}s`,
  })

  // 临时文件目录
  const tempDir = path.join(process.cwd(), 'public', 'uploads', 'temp', `upscale-${projectId}-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  try {
    // 1. 提交超分任务到 WaveSpeed（带 5xx/429 容错）
    await job.updateProgress(10)
    const { requestId } = await submitWithRetry({
      video: mergedVideoOssUrl,
      targetResolution,
    })
    console.log(`[upscale-video] WaveSpeed 任务已提交 - requestId: ${requestId}`)

    // 2. 轮询等待结果
    await job.updateProgress(20)
    const pollResult = await pollUpscaleResult(requestId)

    if (pollResult.status === 'failed') {
      throw new Error(`超分失败: ${pollResult.error}`)
    }

    // 3. 下载超分视频（带重试）
    await job.updateProgress(70)
    const localUpscaledPath = path.join(tempDir, `upscaled_${projectId}.mp4`)
    let downloadSuccess = false

    for (let attempt = 1; attempt <= OSS_MAX_RETRIES + 1; attempt++) {
      try {
        await downloadVideo(pollResult.outputUrl, localUpscaledPath)
        downloadSuccess = true
        break
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error)
        if (attempt <= OSS_MAX_RETRIES) {
          console.warn(`[upscale-video] 下载超分视频第 ${attempt} 次失败（${reason}），${OSS_RETRY_INTERVAL_MS / 1000}s 后重试...`)
          await sleep(OSS_RETRY_INTERVAL_MS)
        }
      }
    }

    if (!downloadSuccess) {
      throw new Error('超分视频下载全部重试失败')
    }

    // 4. 上传超分视频到 OSS（带重试）
    await job.updateProgress(85)
    const upscaledOssUrl = await uploadUpscaledVideoToOSS(localUpscaledPath, userId, projectId)
    console.log(`[upscale-video] 超分视频已上传到 OSS: ${upscaledOssUrl}`)

    // 5. 超分免费，跳过扣费（720p/1080p 统一免费超分）
    await job.updateProgress(90)
    if (reservedCredits > 0) {
      // 兼容历史遗留：如果有冻结积分则正式扣费
      await withCreditLock(() =>
        prisma.$transaction(async (tx) => {
          await chargeCreditsTx(tx, {
            userId,
            projectId,
            actualAmount: reservedCredits,
          })
        })
      , 'chargeCredits')
      console.log(`[upscale-video] 正式扣费完成: ${reservedCredits} 积分`)
    }

    // 6. 更新项目导出状态为完成
    await prisma.project.update({
      where: { id: projectId },
      data: {
        exportStatus: 'COMPLETED',
        exportVideoUrl: upscaledOssUrl,
        exportError: null,
      },
    })

    await job.updateProgress(100)

    // 输出超分成本汇总（WaveSpeed 定价：$0.005/秒，即 $0.025/5秒，720p/1080p 同价）
    const wavespeedCostUSD = videoDuration * 0.005
    const wavespeedCostRMB = wavespeedCostUSD * 7.2 // 粗估汇率
    console.log(
      `[upscale-video] ═══ 超分完成汇总 ═══ 项目 ${projectId} | ` +
      `${targetResolution} | 时长 ${videoDuration.toFixed(1)}s | ` +
      `WaveSpeed 成本: $${wavespeedCostUSD.toFixed(4)} ≈ ¥${wavespeedCostRMB.toFixed(4)} | ` +
      `积分消耗: ${reservedCredits}`
    )
    console.log(`[upscale-video] 项目 ${projectId} 超分导出完成 (${targetResolution}): ${upscaledOssUrl}`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '超分失败'
    console.error(`[upscale-video] 项目 ${projectId} 超分失败:`, errorMessage)

    // 返还冻结积分（REFUND，按 projectId 幂等：导出阶段冻结走 projectId 字段）
    if (reservedCredits > 0) {
      try {
        const { refundParseCredits } = await import('@/lib/credit-service')
        await refundParseCredits(userId, projectId, reservedCredits)
        console.log(`[upscale-video] 已退还冻结积分 ${reservedCredits}`)
      } catch (refundError) {
        console.error(`[upscale-video] 退还积分失败:`, refundError instanceof Error ? refundError.message : String(refundError))
      }
    }

    // 更新导出状态为失败
    await prisma.project.update({
      where: { id: projectId },
      data: {
        exportStatus: 'FAILED',
        exportError: errorMessage,
      },
    })

    throw error
  } finally {
    // 清理临时文件
    try {
      const { readdir } = await import('fs/promises')
      const files = await readdir(tempDir)
      for (const file of files) {
        await unlink(path.join(tempDir, file)).catch(() => {})
      }
      const { rmdir } = await import('fs/promises')
      await rmdir(tempDir).catch(() => {})
    } catch {
      // 清理失败不影响主流程
    }
  }
}

// ========================
// 创建 Worker 实例
// ========================

export const upscaleVideoWorker = new Worker(
  'video-upscale',
  processUpscaleVideo,
  {
    connection,
    concurrency: 2, // 超分为外部 API 调用，可适度并发
  }
)

upscaleVideoWorker.on('completed', (job) => {
  console.log(`[upscale-video] Job ${job.id} 完成`)
})

upscaleVideoWorker.on('failed', (job, err) => {
  console.error(`[upscale-video] Job ${job?.id} 失败:`, err.message)
})
