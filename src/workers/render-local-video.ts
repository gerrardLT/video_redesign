/**
 * 本地视频渲染 Worker
 *
 * 处理 `render-local-video` BullMQ 队列任务。
 * 流程：
 * 1. 从 job.data 获取 { contentBriefId, userId }
 * 2. 调用 renderLocalVideoVariants() 执行渲染
 * 3. 渲染成功后，对每个 VideoVariant 自动入队 compliance-review 合规检查
 * 4. 错误不静默，抛出让 BullMQ 重试
 *
 * Worker 配置：
 * - 队列名: render-local-video
 * - concurrency: 2（design.md 定义）
 *
 * 关键约束：
 * - local-render-service 内部已处理 锁/额度/超时，Worker 只需调用并处理返回值
 * - 使用共享 Redis 连接
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { renderLocalVideoVariants } from '@/lib/local-render-service'
import { complianceReviewQueue } from '@/lib/queue'

// ========================
// 类型定义
// ========================

export interface RenderLocalVideoJobData {
  contentBriefId: string
  userId: string
}

// ========================
// 任务处理函数
// ========================

async function processRenderLocalVideo(job: Job<RenderLocalVideoJobData>): Promise<void> {
  const { contentBriefId, userId } = job.data
  console.log(`[render-local-video] 开始渲染 contentBriefId=${contentBriefId}（attempt ${job.attemptsMade + 1}）`)

  // 调用渲染服务（内部已处理额度 RESERVE/CHARGE/REFUND、分布式锁、超时控制）
  const variants = await renderLocalVideoVariants({ contentBriefId, userId })

  console.log(`[render-local-video] 渲染完成，生成 ${variants.length} 个版本`)

  // 对每个 VideoVariant 入队合规检查
  for (const variant of variants) {
    await complianceReviewQueue.add('compliance-review', {
      contentBriefId,
      videoVariantId: variant.id,
    })
    console.log(`[render-local-video] 已入队合规检查: variantId=${variant.id}, type=${variant.type}`)
  }
}

// ========================
// Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

const worker = new Worker<RenderLocalVideoJobData>(
  'render-local-video',
  processRenderLocalVideo,
  {
    connection,
    concurrency: 2,
  }
)

worker.on('completed', (job) => {
  console.log(`[render-local-video] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  console.error(`[render-local-video] 任务 ${job?.id} 失败:`, err.message)
})

export default worker
export { processRenderLocalVideo }
