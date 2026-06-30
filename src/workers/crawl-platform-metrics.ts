/**
 * 平台数据自动抓取 Worker（crawl-platform-metrics）—— 需求 7.5 / 7.6
 *
 * 职责：
 *  1. 受控定时调度：由 queue.ts 注册的 'crawl-all-accounts' 重复任务触发（每小时扫描一次）。
 *  2. 扫描所有已授权且状态正常（ACTIVE）的 PlatformAccount，逐个调用
 *     platform-metrics-crawler.crawlAccountMetrics 执行一次抓取。
 *  3. 频率门控：是否真正抓取由 crawlAccountMetrics 内部按账号 lastCrawledAt 门控
 *     （系统级最小间隔 ≥6h，由 clampCrawlIntervalHours 把账号 crawlIntervalH 夹紧到 [6,24]）；
 *     未到间隔的账号被跳过（非错误），等待下次调度。
 *  4. 单账号失败隔离（design「Worker 层错误处理表」）：
 *     - 凭证失效/平台改版/反爬 → crawlAccountMetrics 已标记账号 NEEDS_RELINK 且不写任何 metric；
 *       本 Worker 追加写入一条门店作用域 StoreNotification(type=CRAWL_FAILED)，提示商家重新关联。
 *     - 单账号异常一律捕获隔离，不影响其它账号；绝不伪造数据、绝不静默吞错（记录错误日志）。
 *
 * 真实抓取实现注入（遵循 AGENTS.md：真实接口、无 fallback、无伪造数据）：
 *  - 服务层不内置任何抓取实现，需由本 Worker 启动时通过 registerPlatformWorksFetcher 注入
 *    针对各平台（抖音/小红书/视频号等）真实接口的 PlatformWorksFetcher。
 *  - 各平台真实抓取属外部依赖，本仓库当前未提供可用的真实平台抓取实现，故此处不注册任何
 *    fetcher（严禁注入返回假数据的伪实现）。在真实 fetcher 缺失且存在待抓取账号时，
 *    crawlAccountMetrics 会抛出 CrawlConfigError，本 Worker 以 UnrecoverableError 显式中止本次
 *    调度（不标记 NEEDS_RELINK、不写 CRAWL_FAILED、不重试伪造），把「缺少真实抓取实现」这一
 *    系统级配置约束如实暴露给运维，待接入真实实现后即可正常抓取。
 *
 * Requirements: 7.5, 7.6
 */
import { Worker, UnrecoverableError, type Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  crawlAccountMetrics,
  CrawlConfigError,
  // 说明：如需注入真实平台抓取实现，在此 import registerPlatformWorksFetcher 并于 Worker
  // 启动时调用；当前仓库无可用真实平台接口，故不注册（详见文件头说明）。
} from '@/lib/platform-metrics-crawler'

const connection = redis as unknown as ConnectionOptions

/** 单批扫描的最大账号数，避免一次性加载过多记录 */
const BATCH_SIZE = 100

/**
 * 为抓取失败的账号写入一条门店作用域 CRAWL_FAILED 通知（需求 7.6）。
 * 账号状态 NEEDS_RELINK 已由 crawlAccountMetrics 标记，此处仅负责通知中心可见性。
 */
async function createCrawlFailedNotification(account: {
  storeId: string
  platform: string
  reason: string
}): Promise<void> {
  await prisma.storeNotification.create({
    data: {
      storeId: account.storeId,
      type: 'CRAWL_FAILED',
      title: '平台数据抓取失败，需重新关联',
      // 不向商家透出底层异常细节，仅给出可操作指引；详细 reason 落在 Worker 日志
      body: `「${account.platform}」账号的数据自动抓取已失效（可能是登录态过期或平台策略调整），请重新关联以恢复自动同步；在此之前可继续手动录入数据。`,
      // 指向门店设置页（平台账号关联卡片所在），便于商家一键重新关联
      actionHref: `/merchant/stores/${account.storeId}/settings`,
    },
  })
}

/**
 * 处理一次「扫描全部账号并抓取」调度任务。
 * 返回各类计数，便于在完成日志中观测抓取健康度。
 */
async function processCrawlPlatformMetrics(job: Job) {
  logger.info('[crawl-platform-metrics] 开始扫描待抓取的平台账号', { jobId: job.id })

  const now = new Date()
  let totalScanned = 0
  let crawled = 0
  let skipped = 0
  let failed = 0

  // 仅扫描已完成授权确认且状态正常的账号；NEEDS_RELINK 账号在商家重新关联前不再尝试抓取。
  // 以 id 游标分批，避免大表一次性加载。
  let cursorId: string | undefined
  while (true) {
    const accounts = await prisma.platformAccount.findMany({
      where: { status: 'ACTIVE', authConfirmed: true },
      select: { id: true, storeId: true, platform: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    })

    if (accounts.length === 0) break

    for (const account of accounts) {
      totalScanned++
      try {
        // 频率门控由 crawlAccountMetrics 内部按账号 lastCrawledAt + crawlIntervalH(夹紧≥6h) 判定
        const result = await crawlAccountMetrics({ platformAccountId: account.id, now })

        if (result.skipped) {
          skipped++
          continue
        }

        if (result.failed) {
          // 单账号失败隔离：NEEDS_RELINK 已由服务层标记，此处补一条 CRAWL_FAILED 通知
          failed++
          await createCrawlFailedNotification({
            storeId: account.storeId,
            platform: account.platform,
            reason: result.failed.reason,
          })
          logger.warn('[crawl-platform-metrics] 单账号抓取失败，已触发 CRAWL_FAILED 通知', {
            platformAccountId: account.id,
            storeId: account.storeId,
            platform: account.platform,
            reason: result.failed.reason,
          })
          continue
        }

        crawled++
      } catch (err) {
        // 配置错误（未注入真实 fetcher）：系统级问题，对所有账号一致，非单账号凭证失效。
        // 显式以 UnrecoverableError 中止本次调度（不重试伪造、不误标 NEEDS_RELINK / CRAWL_FAILED）。
        if (err instanceof CrawlConfigError) {
          logger.error('[crawl-platform-metrics] 未注入真实平台抓取实现，本次调度中止', {
            jobId: job.id,
            reason: err.message,
          })
          throw new UnrecoverableError(
            '缺少真实平台作品抓取实现（PlatformWorksFetcher），无法抓取：请在 Worker 启动时注入真实实现后再调度'
          )
        }

        // 其它意外错误：单账号隔离，记录后继续抓取其它账号（不影响其它账号、不伪造数据）
        failed++
        logger.error('[crawl-platform-metrics] 单账号抓取出现未预期异常，已隔离', {
          platformAccountId: account.id,
          storeId: account.storeId,
          platform: account.platform,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (accounts.length < BATCH_SIZE) break
    cursorId = accounts[accounts.length - 1].id
  }

  logger.info('[crawl-platform-metrics] 扫描完成', {
    jobId: job.id,
    totalScanned,
    crawled,
    skipped,
    failed,
  })

  return { totalScanned, crawled, skipped, failed }
}

// 创建 Worker 实例（并发 1：抓取属对外访问，串行降低风控风险）
export const crawlPlatformMetricsWorker = new Worker(
  'crawl-platform-metrics',
  processCrawlPlatformMetrics,
  {
    connection,
    concurrency: 1,
  }
)

crawlPlatformMetricsWorker.on('completed', (job) => {
  logger.info(`[crawl-platform-metrics] Job ${job.id} 完成`, { returnvalue: job.returnvalue })
})

crawlPlatformMetricsWorker.on('failed', (job, err) => {
  logger.error(`[crawl-platform-metrics] Job ${job?.id} 失败`, { error: err.message })
})

export default crawlPlatformMetricsWorker
