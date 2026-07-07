/**
 * 矩阵号多账号发布 Worker（matrix-publish）
 *
 * 职责：
 *  1. 接收 matrix-publish 队列任务，执行单个账号的视频发布
 *  2. 根据 SocialAccount 的 accessToken 调用对应平台 API 发布
 *  3. 发布成功：更新 PublishJob 状态为 PUBLISHED + 记录 publishedAt
 *  4. 发布失败：更新 PublishJob 状态为 FAILED + 记录 errorMessage
 *  5. 单账号失败隔离：不影响同批次其它账号的发布
 *
 * 当前支持平台：DOUYIN（抖音开放平台创作者服务 API）
 * 后续扩展：KUAISHOU / XIAOHONGSHU / WECHAT_CHANNELS
 *
 * 设计原则：
 *  - 真实发布、无 fallback、无伪造结果
 *  - 发布结果如实反映平台 API 返回，不伪造成功状态
 *  - 单账号失败隔离，不重试（避免重复发布）
 */

import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { logger } from '@/lib/shared/logger'
import type { PublishPlatform } from '@/types/merchant'

const connection = redis as unknown as ConnectionOptions

// ========================
// 任务数据类型
// ========================

interface MatrixPublishJobData {
  /** PublishJob ID */
  publishJobId: string
  /** SocialAccount ID */
  accountId: string
  /** 目标平台 */
  platform: PublishPlatform
}

// ========================
// 平台发布 API 封装
// ========================

/**
 * 调用平台 API 发布视频
 *
 * 当前仅实现抖音，后续扩展其它平台时在此函数中增加分支。
 * 发布失败时抛错，由 Worker 层捕获并标记 FAILED。
 */
async function publishToPlatform(params: {
  platform: PublishPlatform
  account: {
    id: string
    accessToken: string | null
    refreshToken: string | null
    externalUserId: string | null
  }
  job: {
    title: string | null
    caption: string | null
    tags: unknown
    locationText: string | null
    exportedOssKey: string | null
  }
}): Promise<{ platformPostId?: string }> {
  const { platform, account, job } = params

  if (!account.accessToken) {
    throw new Error(`矩阵号 ${account.id} 缺少 accessToken，请先完成 OAuth 授权`)
  }

  switch (platform) {
    case 'DOUYIN':
      return publishToDouyin(
        { id: account.id, accessToken: account.accessToken!, externalUserId: account.externalUserId },
        job
      )
    default:
      throw new Error(`矩阵分发暂不支持平台: ${platform}`)
  }
}

/**
 * 发布视频到抖音
 *
 * 抖音开放平台视频上传 API：
 * 1. 上传视频文件 → 获取 video_id
 * 2. 创建视频（发布） → 获取 item_id
 *
 * 文档：https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/video-management/
 */
async function publishToDouyin(
  account: {
    id: string
    accessToken: string
    externalUserId: string | null
  },
  job: {
    title: string | null
    caption: string | null
    tags: unknown
    locationText: string | null
    exportedOssKey: string | null
  },
): Promise<{ platformPostId?: string }> {
  if (!job.exportedOssKey) {
    throw new Error('缺少导出的视频文件（exportedOssKey）')
  }

  // 抖音发布 API 尚未对接，显式报错而非静默返回假成功
  // 真实实现需完成以下调用链：
  //   1. 将 exportedOssKey 转换为公网可访问 URL
  //   2. POST /api/douyin/v1/video/upload/ 上传视频 → video_id
  //   3. POST /api/douyin/v1/video/create/ 发布视频 → item_id
  throw new Error(
    `抖音发布 API 尚未实现（当前为框架占位），账号 ${account.id} 的视频未能发布。` +
    `请完成抖音开放平台视频上传/创建 API 对接后再使用矩阵分发功能。`
  )
}

// ========================
// 任务处理
// ========================

async function processMatrixPublish(job: Job<MatrixPublishJobData>) {
  const { publishJobId, accountId, platform } = job.data

  logger.info('[matrix-publish] 开始处理矩阵发布任务', {
    publishJobId,
    accountId,
    platform,
  })

  // 1. 读取 PublishJob 详情
  const publishJob = await prisma.publishJob.findUnique({
    where: { id: publishJobId },
  })

  if (!publishJob) {
    throw new Error(`PublishJob ${publishJobId} 不存在`)
  }

  // 2. 读取 SocialAccount 凭证
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
  })

  if (!account) {
    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: { status: 'FAILED', errorMessage: `矩阵号账号 ${accountId} 不存在或已被删除` },
    })
    throw new Error(`SocialAccount ${accountId} 不存在`)
  }

  if (!account.isActive) {
    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: { status: 'FAILED', errorMessage: `矩阵号账号 ${account.accountName ?? accountId} 已被禁用` },
    })
    throw new Error(`SocialAccount ${accountId} 已被禁用`)
  }

  // 3. 更新状态为 PUBLISHING
  await prisma.publishJob.update({
    where: { id: publishJobId },
    data: { status: 'PUBLISHING' },
  })

  // 4. 调用平台 API 发布
  try {
    const result = await publishToPlatform({
      platform,
      account: {
        id: account.id,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        externalUserId: account.externalUserId,
      },
      job: {
        title: publishJob.title,
        caption: publishJob.caption,
        tags: publishJob.tags,
        locationText: publishJob.locationText,
        exportedOssKey: publishJob.exportedOssKey,
      },
    })

    // 5. 发布成功
    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        ...(result.platformPostId ? {
          errorMessage: null,
        } : {}),
      },
    })

    logger.info('[matrix-publish] 发布成功', {
      publishJobId,
      accountId,
      platform,
    })

    return { publishJobId, accountId, status: 'PUBLISHED' }
  } catch (error) {
    // 6. 发布失败：标记 FAILED，不影响其它账号
    const reason = error instanceof Error ? error.message : String(error)

    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: {
        status: 'FAILED',
        errorMessage: reason,
      },
    })

    logger.error('[matrix-publish] 发布失败', {
      publishJobId,
      accountId,
      platform,
      reason,
    })

    throw error
  }
}

// ========================
// Worker 实例
// ========================

export const matrixPublishWorker = new Worker<MatrixPublishJobData>(
  'matrix-publish',
  processMatrixPublish,
  {
    connection,
    concurrency: 2, // 适度并发：同一门店的不同账号可以并行发布
  }
)

matrixPublishWorker.on('completed', (job) => {
  logger.info(`[matrix-publish] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

matrixPublishWorker.on('failed', (job, err) => {
  logger.error(`[matrix-publish] Job ${job?.id} 失败`, { error: err.message })
})

export default matrixPublishWorker
