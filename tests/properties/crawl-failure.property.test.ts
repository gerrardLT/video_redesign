// Feature: local-life-depth-enhancements, Property 27: 抓取失败不伪造
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 27: 抓取失败不伪造
 *
 * 对任意抓取失败场景（凭证失效 / 平台改版 / 反爬限制），
 * platform-metrics-crawler.crawlAccountMetrics 必须：
 *   1) 将该平台账号状态标记为 NEEDS_RELINK（回退手动录入提示）；
 *   2) 不写入任何 PublishMetric（绝不伪造数据）；
 *   3) 返回 failed.needsRelink=true 且 updatedBriefIds 为空。
 *
 * **Validates: Requirements 7.6**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩（platformAccount.findUnique/update、
 * publishMetric.create、contentBrief.findUnique），注入一个 fetchWorks 抛错的
 * PlatformWorksFetcher；设置 PLATFORM_CRED_ENC_KEY 并使账号 lastCrawledAt 满足频率门控，
 * 断言失败时仅 update 置 NEEDS_RELINK、publishMetric.create 从未被调用。
 * 不依赖真实数据库与真实平台接口。
 */

// ========================
// 设置凭证加密密钥（被测模块在 encrypt/decrypt 时读取，缺失会抛错）
// ========================
process.env.PLATFORM_CRED_ENC_KEY = 'test-platform-cred-enc-key-for-property-27'

// ========================
// Mock Prisma（内存桩）
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    platformAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    publishMetric: {
      create: vi.fn(),
    },
    contentBrief: {
      findUnique: vi.fn(),
    },
  },
}))

// 抑制 logger 噪音（抓取失败会 logger.warn）
vi.mock('@/lib/shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 动态导入以确保 mock 生效
const { prisma } = await import('@/lib/shared/db')
const { crawlAccountMetrics, encryptCredential } = await import('@/lib/merchant/platform-metrics-crawler')
import type { PlatformWorksFetcher } from '@/lib/merchant/platform-metrics-crawler'

// 类型收窄：mock 后的 prisma 方法
const accountFindUnique = prisma.platformAccount.findUnique as unknown as ReturnType<typeof vi.fn>
const accountUpdate = prisma.platformAccount.update as unknown as ReturnType<typeof vi.fn>
const metricCreate = prisma.publishMetric.create as unknown as ReturnType<typeof vi.fn>
const briefFindUnique = prisma.contentBrief.findUnique as unknown as ReturnType<typeof vi.fn>

// PublishPlatform 枚举取值（与 src/types/merchant.ts 对齐）
const PLATFORMS = ['DOUYIN', 'KUAISHOU', 'XIAOHONGSHU', 'WECHAT_CHANNELS', 'MANUAL_EXPORT'] as const

// 抓取失败原因类别（凭证失效 / 平台改版 / 反爬限制）
const FAILURE_REASONS = [
  '凭证失效：登录态已过期，需重新关联',
  '平台改版：作品列表结构变更，解析失败',
  '反爬限制：请求被风控拦截（验证码/限流）',
  'cookie expired (401 Unauthorized)',
  'anti-crawler challenge detected',
] as const

// ========================
// Arbitraries
// ========================

const NOW = new Date('2026-06-01T12:00:00.000Z')

/**
 * 生成一个「满足频率门控（允许抓取）」的账号状态：
 *  - lastCrawledAt 为 null（从未抓取，始终允许）；或
 *  - lastCrawledAt 早于 now 至少 intervalH 小时（已到间隔，允许抓取）。
 */
const accountArb = fc
  .record({
    platformAccountId: fc.uuid(),
    storeId: fc.uuid(),
    platform: fc.constantFrom(...PLATFORMS),
    crawlIntervalH: fc.integer({ min: 6, max: 24 }),
    // lastCrawledAt：null 或「已超过间隔」的过去时间（额外多减 1~48 小时确保门控放行）
    extraPastHours: fc.option(fc.integer({ min: 1, max: 48 }), { nil: undefined }),
    everCrawled: fc.boolean(),
  })
  .map((r) => {
    const lastCrawledAt = r.everCrawled
      ? new Date(NOW.getTime() - (r.crawlIntervalH + (r.extraPastHours ?? 1)) * 60 * 60 * 1000)
      : null
    return {
      platformAccountId: r.platformAccountId,
      storeId: r.storeId,
      platform: r.platform,
      crawlIntervalH: r.crawlIntervalH,
      lastCrawledAt,
    }
  })

const failureReasonArb = fc.constantFrom(...FAILURE_REASONS)

// ========================
// Property 27: 抓取失败不伪造
// ========================

describe('Property 27: 抓取失败不伪造', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('抓取失败时标记 NEEDS_RELINK、不写任何 PublishMetric、返回 needsRelink=true', async () => {
    /**
     * **Validates: Requirements 7.6**
     */
    await fc.assert(
      fc.asyncProperty(accountArb, failureReasonArb, async (account, reason) => {
        // 每次迭代重置桩，避免跨迭代污染
        accountFindUnique.mockReset()
        accountUpdate.mockReset()
        metricCreate.mockReset()
        briefFindUnique.mockReset()

        // 有效密文凭证：确保失败来源于 fetchWorks 抛错，而非解密失败
        const encryptedCookie = encryptCredential(`cookie-${account.platformAccountId}`)

        accountFindUnique.mockResolvedValue({
          id: account.platformAccountId,
          storeId: account.storeId,
          platform: account.platform,
          encryptedCookie,
          authConfirmed: true,
          status: 'ACTIVE',
          lastCrawledAt: account.lastCrawledAt,
          crawlIntervalH: account.crawlIntervalH,
        })
        accountUpdate.mockResolvedValue({ id: account.platformAccountId, status: 'NEEDS_RELINK' })
        // brief/metric 桩不应被触及，但仍给出实现以暴露任何越界调用
        briefFindUnique.mockResolvedValue({ id: 'brief_x', storeId: account.storeId })
        metricCreate.mockResolvedValue({ id: 'metric_x' })

        // 注入一个 fetchWorks 必抛错的 fetcher（模拟凭证失效/改版/反爬）
        const failingFetcher: PlatformWorksFetcher = {
          fetchWorks: async () => {
            throw new Error(reason)
          },
        }

        const result = await crawlAccountMetrics({
          platformAccountId: account.platformAccountId,
          fetcher: failingFetcher,
          now: NOW,
        })

        // 1) 账号被标记为 NEEDS_RELINK（恰一次 update，且 data.status 正确）
        expect(accountUpdate).toHaveBeenCalledTimes(1)
        const updateArg = accountUpdate.mock.calls[0][0] as {
          where: { id: string }
          data: Record<string, unknown>
        }
        expect(updateArg.where.id).toBe(account.platformAccountId)
        expect(updateArg.data.status).toBe('NEEDS_RELINK')
        // 失败路径绝不更新 lastCrawledAt（不能伪装成功抓取）
        expect(updateArg.data.lastCrawledAt).toBeUndefined()

        // 2) 不写入任何 PublishMetric（绝不伪造数据）
        expect(metricCreate).not.toHaveBeenCalled()

        // 3) 返回失败：needsRelink=true、reason 透传、无更新 brief
        expect(result.failed).toBeDefined()
        expect(result.failed?.needsRelink).toBe(true)
        expect(result.failed?.reason).toBe(reason)
        expect(result.updatedBriefIds).toEqual([])
        expect(result.skipped).toBeUndefined()
      }),
      { numRuns: 200 }
    )
  })
})
