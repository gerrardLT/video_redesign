/**
 * 人脸检测 Worker
 * 处理 face-check 队列中的人脸检测任务
 *
 * 逻辑：
 * 1. 从队列中读取任务（包含 assetId, userId）
 * 2. 调用 faceDetectionService.performFaceCheck 执行人脸检测
 * 3. 服务内部会更新 Asset 状态并记录 ContentSafetyLog 审核日志
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { faceDetectionService } from '@/lib/shared/face-detection-service'
import { logger } from '@/lib/shared/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

interface FaceCheckJobData {
  assetId: string
  userId: string
}

async function processFaceCheck(job: Job<FaceCheckJobData>) {
  const { assetId, userId } = job.data

  logger.info('[face-check] 开始人脸检测', { jobId: job.id, assetId, userId })

  const result = await faceDetectionService.performFaceCheck(assetId, userId)

  logger.info('[face-check] 人脸检测完成', {
    jobId: job.id,
    assetId,
    result,
  })

  return { assetId, result }
}

// 创建 Worker 实例
export const faceCheckWorker = new Worker<FaceCheckJobData>(
  'face-check',
  processFaceCheck,
  {
    connection,
    concurrency: 3,
  }
)

faceCheckWorker.on('completed', (job) => {
  logger.info(`[face-check] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

faceCheckWorker.on('failed', (job, err) => {
  logger.error(`[face-check] Job ${job?.id} 失败`, {
    error: err.message,
    assetId: job?.data?.assetId,
  })
})
