/**
 * 资产清理 Worker
 * 处理 asset-cleanup 队列的 'daily-cleanup' 定时任务
 *
 * 逻辑：
 * 1. 调用 getExpiredAssets() 批量获取已过期资产（每批 100 条）
 * 2. 调用 cleanupExpiredFiles() 删除 OSS 文件并标记状态
 * 3. 循环处理直到没有更多过期资产
 * 4. 记录清理结果日志
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { getExpiredAssets, cleanupExpiredFiles } from '@/lib/shared/asset-lifecycle-service'
import { extractKeyFromUrl } from '@/lib/shared/storage'
import { logger } from '@/lib/shared/logger'
import type { ConnectionOptions } from 'bullmq'

const connection = redis as unknown as ConnectionOptions

const BATCH_SIZE = 100

async function processAssetCleanup(job: Job) {
  logger.info('[asset-cleanup] 开始执行资产清理任务', { jobId: job.id })

  let totalScanned = 0
  let totalCleaned = 0
  let totalFailed = 0

  // 批量处理，每批 100 条，循环直到没有更多过期资产
  while (true) {
    const expiredAssets = await getExpiredAssets(BATCH_SIZE)

    if (expiredAssets.length === 0) {
      break
    }

    totalScanned += expiredAssets.length

    // 清理过期文件（将 URL 转为 OSS key）
    const results = await cleanupExpiredFiles(
      expiredAssets.map((asset) => {
        const ossKey = extractKeyFromUrl(asset.url)
        return { id: asset.id, url: ossKey || asset.url }
      })
    )

    for (const result of results) {
      if (result.success) {
        totalCleaned++
      } else {
        totalFailed++
      }
    }

    // 如果本批数量小于 BATCH_SIZE，说明没有更多了
    if (expiredAssets.length < BATCH_SIZE) {
      break
    }
  }

  logger.info('[asset-cleanup] 资产清理任务完成', {
    jobId: job.id,
    totalScanned,
    totalCleaned,
    totalFailed,
  })

  return { totalScanned, totalCleaned, totalFailed }
}

// 创建 Worker 实例
export const assetCleanupWorker = new Worker(
  'asset-cleanup',
  processAssetCleanup,
  {
    connection,
    concurrency: 1,
  }
)

assetCleanupWorker.on('completed', (job) => {
  logger.info(`[asset-cleanup] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

assetCleanupWorker.on('failed', (job, err) => {
  logger.error(`[asset-cleanup] Job ${job?.id} 失败`, { error: err.message })
})
