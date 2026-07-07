/**
 * 集成测试 16.4：平台账号关联与受控抓取（真实凭证流程 + 写入 PublishMetric）
 *
 * 验证：真实凭证授权/加密存储流程 + 受控抓取写入 PublishMetric（source=API_SYNC，与 MANUAL 共存），
 * 失败标记 NEEDS_RELINK（需求 7.3, 7.5, 7.6）。
 *
 * 真实接口边界说明：平台「作品抓取器」(PlatformWorksFetcher) 是外部依赖边界，由 Worker 在生产
 * 注入真实实现。本集成测试用真实 prisma + 真实 AES 加密 (saveCredential/decryptCredential)，
 * 并通过 crawlAccountMetrics 的 fetcher 注入参数验证「我方写入/失败处理接线」——这是对本系统
 * 真实写路径的集成验证（非伪造外部平台 API 通过）。成功路径用受控 fetcher 返回该门店真实 brief
 * 的指标以驱动真实 PublishMetric 写入；失败路径用抛错 fetcher 验证 NEEDS_RELINK。
 *
 * 运行前置（否则 skipped）：
 *   RUN_INTEGRATION=1
 *   DATABASE_URL、PLATFORM_CRED_ENC_KEY（凭证加密密钥）
 *   INTEGRATION_STORE_ID（真实门店）、INTEGRATION_BRIEF_ID（该门店下真实 ContentBrief）
 *   可选 INTEGRATION_PLATFORM（默认 DOUYIN）
 */

import { describe, it, expect } from 'vitest'
import { integrationEnabled, skipReason, env } from './_integration-gate'
import type { PublishPlatform } from '@/types/merchant'

const REQUIRED = ['DATABASE_URL', 'PLATFORM_CRED_ENC_KEY', 'INTEGRATION_STORE_ID', 'INTEGRATION_BRIEF_ID']
const enabled = integrationEnabled(REQUIRED)

describe.skipIf(!enabled)('集成16.4 平台账号关联与受控抓取（真实凭证流程）', () => {
  if (!enabled) {
    console.info(`[integration 16.4] skipped: ${skipReason(REQUIRED)}`)
  }

  const platform = (process.env.INTEGRATION_PLATFORM as PublishPlatform) || ('DOUYIN' as PublishPlatform)

  it('授权前置：requestAccountLink 返回风险告知 + authToken；saveCredential 在未确认时拒绝（Property 24）', async () => {
    const { requestAccountLink, saveCredential } = await import('@/lib/merchant/platform-metrics-crawler')
    const storeId = env('INTEGRATION_STORE_ID')

    const notice = await requestAccountLink({ storeId, platform })
    expect(typeof notice.tosNotice).toBe('string')
    expect(Array.isArray(notice.risks)).toBe(true)
    expect(notice.risks.length).toBeGreaterThan(0)
    expect(typeof notice.authToken).toBe('string')

    // 未完成授权确认时拒绝保存凭证（不进入存储）
    await expect(
      saveCredential({ storeId, platform, cookie: 'integration-test-cookie', authConfirmed: false })
    ).rejects.toBeTruthy()
  }, 60_000)

  it('凭证加密存储 + 成功抓取写入 PublishMetric(source=API_SYNC)，与 MANUAL 共存不覆盖', async () => {
    const { saveCredential, crawlAccountMetrics, decryptCredential } = await import('@/lib/merchant/platform-metrics-crawler')
    const { prisma } = await import('@/lib/shared/db')

    const storeId = env('INTEGRATION_STORE_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')
    const plaintextCookie = `integration-cookie-${Date.now()}`

    // 真实 AES 加密存储：DB 仅存密文，且 decrypt 往返一致（Property 25）
    const account = await saveCredential({ storeId, platform, cookie: plaintextCookie, authConfirmed: true })
    expect(account.encryptedCookie).not.toBe(plaintextCookie)
    expect(decryptCredential(account.encryptedCookie)).toBe(plaintextCookie)

    // 先放一条 MANUAL 指标，验证后续 API_SYNC 写入与之共存（不覆盖，Property 28）
    const manual = await prisma.publishMetric.create({
      data: { contentBriefId, platform, views: 111, source: 'MANUAL' },
    })

    // 受控 fetcher：返回该门店真实 brief 的表现数据，驱动真实写路径（外部边界注入）
    const result = await crawlAccountMetrics({
      platformAccountId: account.id,
      now: new Date(),
      fetcher: {
        async fetchWorks() {
          return [{ contentBriefId, platform, views: 222, likes: 10, comments: 1, shares: 0, saves: 2 }]
        },
      },
    })

    try {
      expect(result.failed).toBeUndefined()
      expect(result.updatedBriefIds).toContain(contentBriefId)

      // API_SYNC 与 MANUAL 共存：两条来源记录都在
      const sources = (
        await prisma.publishMetric.findMany({
          where: { contentBriefId, platform },
          select: { source: true },
        })
      ).map((m) => m.source)
      expect(sources).toContain('MANUAL')
      expect(sources).toContain('API_SYNC')
    } finally {
      // 清理本测试写入的指标，避免污染真实数据
      await prisma.publishMetric.deleteMany({ where: { contentBriefId, platform, source: 'API_SYNC' } })
      await prisma.publishMetric.delete({ where: { id: manual.id } }).catch(() => undefined)
    }
  }, 120_000)

  it('抓取失败 → 标记 NEEDS_RELINK 且不写任何 metric（Property 27）', async () => {
    const { saveCredential, crawlAccountMetrics } = await import('@/lib/merchant/platform-metrics-crawler')
    const { prisma } = await import('@/lib/shared/db')

    const storeId = env('INTEGRATION_STORE_ID')
    // 重新关联复位为 ACTIVE，并把 lastCrawledAt 清空以通过频率门控
    const account = await saveCredential({ storeId, platform, cookie: `c-${Date.now()}`, authConfirmed: true })
    await prisma.platformAccount.update({ where: { id: account.id }, data: { lastCrawledAt: null } })

    const before = await prisma.publishMetric.count({ where: { contentBrief: { storeId }, source: 'API_SYNC' } })

    const result = await crawlAccountMetrics({
      platformAccountId: account.id,
      now: new Date(),
      fetcher: {
        async fetchWorks() {
          throw new Error('凭证失效（模拟平台反爬/登录态过期）')
        },
      },
    })

    expect(result.failed?.needsRelink).toBe(true)
    const reloaded = await prisma.platformAccount.findUnique({ where: { id: account.id }, select: { status: true } })
    expect(reloaded?.status).toBe('NEEDS_RELINK')

    // 失败时不写任何 metric
    const after = await prisma.publishMetric.count({ where: { contentBrief: { storeId }, source: 'API_SYNC' } })
    expect(after).toBe(before)
  }, 120_000)
})
