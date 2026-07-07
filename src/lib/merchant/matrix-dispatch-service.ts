/**
 * 矩阵号分发调度服务
 *
 * 从单 variant 发布扩展到多账号批量分发：
 * - 根据门店绑定的 SocialAccount 列表，将同一视频分发到多个平台账号
 * - 支持定时/间隔/错峰发布策略（避免同时发布触发平台风控）
 * - 每个账号创建独立的 PublishJob，通过 matrixBatchId 关联为同一批次
 * - 发布任务入队 matrix-publish Worker，单账号失败隔离
 *
 * 发布策略：
 * - IMMEDIATE：立即发布所有账号（间隔 60s）
 * - STAGGERED：错峰发布（间隔 5-15 分钟随机）
 * - SCHEDULED：按指定时间表发布
 *
 * Requirements: 矩阵号分发引擎
 */

import { randomUUID } from 'crypto'
import { prisma } from '../shared/db'
import { matrixPublishQueue } from '../shared/queue'
import { Prisma } from '@/generated/prisma'
import type { PublishPlatform } from '@/types/merchant'

// ========================
// 常量
// ========================

/** 立即发布模式：账号间最小间隔（毫秒） */
const IMMEDIATE_INTERVAL_MS = 60_000

/** 错峰发布模式：账号间随机间隔范围（毫秒） */
const STAGGER_MIN_MS = 5 * 60_000   // 5 分钟
const STAGGER_MAX_MS = 15 * 60_000  // 15 分钟

// ========================
// 类型
// ========================

/** 分发策略 */
export type DispatchStrategy = 'IMMEDIATE' | 'STAGGERED' | 'SCHEDULED'

/** 分发请求 */
export interface DispatchInput {
  /** 内容任务 ID */
  contentBriefId: string
  /** 视频版本 ID（已导出） */
  videoVariantId: string
  /** 目标平台 */
  platform: PublishPlatform
  /** 发布文案标题 */
  title?: string
  /** 发布文案正文 */
  caption?: string
  /** 发布标签 */
  tags?: string[]
  /** 位置文本 */
  locationText?: string
  /** 导出的 OSS key */
  exportedOssKey?: string
  /** 分发策略（默认 STAGGERED） */
  strategy?: DispatchStrategy
  /** SCHEDULED 模式的时间表（各账号发布时间） */
  schedule?: Array<{ accountId: string; publishAt: Date }>
}

/** 分发结果 */
export interface DispatchResult {
  /** 矩阵分发批次 ID */
  matrixBatchId: string
  /** 创建的 PublishJob 列表 */
  jobs: Array<{
    id: string
    accountId: string
    accountName: string | null
    scheduledAt: Date | null
    status: string
  }>
  /** 总账号数 */
  totalAccounts: number
}

// ========================
// 主入口
// ========================

/**
 * 矩阵号批量分发调度
 *
 * 1. 查询门店在目标平台的活跃 SocialAccount 列表
 * 2. 为每个账号创建 PublishJob（accountId + scheduledAt + matrixBatchId）
 * 3. 按分发策略计算各账号发布时间
 * 4. 将到期的发布任务入队 matrix-publish Worker
 *
 * @param input 分发请求参数
 * @returns 分发结果（批次 ID + Job 列表）
 */
export async function dispatchMatrixPublish(input: DispatchInput): Promise<DispatchResult> {
  const {
    contentBriefId,
    videoVariantId,
    platform,
    title,
    caption,
    tags,
    locationText,
    exportedOssKey,
    strategy = 'STAGGERED',
    schedule,
  } = input

  // 1. 查询 ContentBrief 获取 storeId
  const brief = await prisma.contentBrief.findUniqueOrThrow({
    where: { id: contentBriefId },
    select: { storeId: true, id: true },
  })

  // 2. 查询门店在目标平台的活跃账号
  const accounts = await prisma.socialAccount.findMany({
    where: {
      storeId: brief.storeId,
      platform,
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (accounts.length === 0) {
    throw new Error(
      `门店 ${brief.storeId} 在平台 ${platform} 无活跃的矩阵号账号，请先在设置中添加`
    )
  }

  // 3. 生成批次 ID
  const matrixBatchId = `matrix-${randomUUID().slice(0, 8)}-${Date.now()}`

  // 4. 计算各账号发布时间
  const publishTimes = calculatePublishTimes({
    strategy,
    accounts,
    schedule,
  })

  // 5. 为每个账号创建 PublishJob
  const jobs: DispatchResult['jobs'] = []

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]
    const scheduledAt = publishTimes[i]

    const job = await prisma.publishJob.create({
      data: {
        contentBriefId,
        videoVariantId,
        platform,
        status: 'READY',
        title: title ?? null,
        caption: caption ?? null,
        tags: (tags ?? null) as unknown as Prisma.InputJsonValue,
        locationText: locationText ?? null,
        exportedOssKey: exportedOssKey ?? null,
        accountId: account.id,
        scheduledAt,
        matrixBatchId,
      },
    })

    jobs.push({
      id: job.id,
      accountId: account.id,
      accountName: account.accountName,
      scheduledAt: job.scheduledAt,
      status: job.status,
    })
  }

  // 6. 入队 matrix-publish Worker
  // 对于 IMMEDIATE 和已到期的 SCHEDULED，立即入队
  // 对于 STAGGERED 和未来时间的 SCHEDULED，使用 BullMQ delay
  for (const job of jobs) {
    const delay = job.scheduledAt
      ? Math.max(0, job.scheduledAt.getTime() - Date.now())
      : 0

    await matrixPublishQueue.add(
      `matrix-publish-${job.id}`,
      {
        publishJobId: job.id,
        accountId: job.accountId,
        platform,
      },
      {
        jobId: `matrix-${job.id}`,
        ...(delay > 0 ? { delay } : {}),
      }
    )
  }

  return {
    matrixBatchId,
    jobs,
    totalAccounts: accounts.length,
  }
}

// ========================
// 发布时间计算
// ========================

/**
 * 根据分发策略计算各账号的发布时间
 */
function calculatePublishTimes(params: {
  strategy: DispatchStrategy
  accounts: Array<{ id: string }>
  schedule?: Array<{ accountId: string; publishAt: Date }>
}): (Date | null)[] {
  const { strategy, accounts, schedule } = params
  const accountCount = accounts.length

  switch (strategy) {
    case 'IMMEDIATE': {
      // 立即发布，账号间间隔 60s
      const now = Date.now()
      return Array.from(
        { length: accountCount },
        (_, i) => new Date(now + i * IMMEDIATE_INTERVAL_MS)
      )
    }

    case 'STAGGERED': {
      // 错峰发布，每个账号随机间隔 5-15 分钟
      const now = Date.now()
      const times: Date[] = []
      let offset = 0
      for (let i = 0; i < accountCount; i++) {
        times.push(new Date(now + offset))
        // 下一个账号的随机间隔
        offset += STAGGER_MIN_MS + Math.random() * (STAGGER_MAX_MS - STAGGER_MIN_MS)
      }
      return times
    }

    case 'SCHEDULED': {
      // 按指定时间表发布，按 accountId 匹配而非数组下标
      if (!schedule || schedule.length === 0) {
        throw new Error('SCHEDULED 策略需提供 schedule 参数')
      }
      const scheduleMap = new Map(schedule.map(s => [s.accountId, s.publishAt]))
      return accounts.map(account => scheduleMap.get(account.id) ?? null)
    }

    default:
      throw new Error(`不支持的分发策略: ${strategy}`)
  }
}

// ========================
// 批次状态查询
// ========================

/**
 * 查询矩阵分发批次的整体状态
 *
 * @param matrixBatchId 批次 ID
 * @returns 批次状态汇总
 */
export async function getMatrixBatchStatus(matrixBatchId: string): Promise<{
  matrixBatchId: string
  totalJobs: number
  statusCounts: Record<string, number>
  jobs: Array<{
    id: string
    accountId: string | null
    status: string
    errorMessage: string | null
    publishedAt: Date | null
  }>
}> {
  const jobs = await prisma.publishJob.findMany({
    where: { matrixBatchId },
    select: {
      id: true,
      accountId: true,
      status: true,
      errorMessage: true,
      publishedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const statusCounts: Record<string, number> = {}
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1
  }

  return {
    matrixBatchId,
    totalJobs: jobs.length,
    statusCounts,
    jobs,
  }
}
