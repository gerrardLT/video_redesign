// Feature: local-life-depth-enhancements, Property 28: 来源共存不覆盖
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 28: 来源共存不覆盖
 *
 * 对任意已存在若干 source=MANUAL 的 PublishMetric 记录，且账号满足抓取频率门控时，
 * crawlAccountMetrics 成功路径（注入返回随机作品数据的 fetcher）应当：
 *  - 以 source=API_SYNC 追加（create）新的 PublishMetric 记录；
 *  - 绝不 update / delete 任何既有 MANUAL 记录（手动数据全部原样保留）；
 *  - 自动（API_SYNC）与手动（MANUAL）两类记录共存，各带正确 source 标注。
 *
 * **Validates: Requirements 7.8**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——用内存集合模拟 PublishMetric 的 create/update/delete，
 * platformAccount 的 findUnique/update，contentBrief 的 findUnique。publishMetric.create 仅追加，
 * update/deleteMany 等写入操作被记录为调用以便断言「从未触碰手动记录」。
 * 凭证密钥经 PLATFORM_CRED_ENC_KEY 真实设置，account.encryptedCookie 用真实 encryptCredential 生成，
 * 抓取成功路径真实执行解密→fetcher→写库，不依赖真实数据库、无 fallback、无伪造数据。
 */

// 凭证加密密钥：crawlAccountMetrics 解密 account.encryptedCookie 需要，必须在导入被测模块前设置
process.env.PLATFORM_CRED_ENC_KEY = 'property28-platform-cred-enc-key-deterministic'

// ========================
// 内存数据库状态（vi.hoisted 保证 mock 工厂可引用）
// ========================
const db = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  briefs: new Map<string, any>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: [] as any[],
  metricSeq: 0,
  // 记录对 publishMetric 的破坏性写操作（update/delete），断言其从未被调用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metricMutations: [] as any[],
}))

vi.mock('@/lib/db', () => {
  const platformAccount = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: vi.fn(async ({ where }: any) => {
      if (db.account && where.id === db.account.id) return { ...db.account }
      return null
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: vi.fn(async ({ data }: any) => {
      Object.assign(db.account, data)
      return { ...db.account }
    }),
  }
  const contentBrief = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: vi.fn(async ({ where }: any) => {
      const b = db.briefs.get(where.id)
      return b ? { id: b.id, storeId: b.storeId } : null
    }),
  }
  const publishMetric = {
    // create：仅追加新行（模拟自动数据落库，与既有记录共存）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `pm_auto_${db.metricSeq++}`, ...data }
      db.metrics.push(row)
      return { ...row }
    }),
    // 以下为破坏性写操作：被测逻辑不应调用；一旦调用即记录，供断言失败
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: vi.fn(async (args: any) => {
      db.metricMutations.push({ op: 'update', args })
      return {}
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany: vi.fn(async (args: any) => {
      db.metricMutations.push({ op: 'updateMany', args })
      return { count: 0 }
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: vi.fn(async (args: any) => {
      db.metricMutations.push({ op: 'upsert', args })
      return {}
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: vi.fn(async (args: any) => {
      db.metricMutations.push({ op: 'delete', args })
      return {}
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteMany: vi.fn(async (args: any) => {
      db.metricMutations.push({ op: 'deleteMany', args })
      return { count: 0 }
    }),
  }
  return { prisma: { platformAccount, contentBrief, publishMetric } }
})

// logger 桩：避免测试期日志噪声
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 动态导入以确保 mock 生效
const { crawlAccountMetrics, encryptCredential } = await import('@/lib/platform-metrics-crawler')

// PublishPlatform 枚举取值（与 src/types/merchant.ts 对齐）
const PLATFORMS = ['DOUYIN', 'KUAISHOU', 'XIAOHONGSHU', 'WECHAT_CHANNELS', 'MANUAL_EXPORT'] as const

// ========================
// Arbitraries
// ========================

// 单条作品/指标计数（覆盖 0 与较大值边界）
const countsArb = fc.record({
  views: fc.nat(100000),
  likes: fc.nat(10000),
  comments: fc.nat(5000),
  shares: fc.nat(5000),
  saves: fc.nat(5000),
})

// 完整场景：先确定门店/账号/平台/归属本店的 briefId 集合，再生成依赖这些 briefId 的手动记录与抓取作品
const scenarioArb = fc
  .record({
    storeId: fc.uuid(),
    accountId: fc.uuid(),
    platform: fc.constantFrom(...PLATFORMS),
    briefIds: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 }),
  })
  .chain((base) => {
    const briefIdArb = fc.constantFrom(...base.briefIds)
    return fc.record({
      base: fc.constant(base),
      // 至少 1 条 MANUAL 记录，保证「共存」断言有意义
      manualRecords: fc.array(
        fc.record({ contentBriefId: briefIdArb, platform: fc.constantFrom(...PLATFORMS), counts: countsArb }),
        { minLength: 1, maxLength: 8 }
      ),
      // 至少 1 条抓取作品，保证有 API_SYNC 写入
      works: fc.array(fc.record({ contentBriefId: briefIdArb, counts: countsArb }), {
        minLength: 1,
        maxLength: 8,
      }),
    })
  })

// ========================
// Property 28: 来源共存不覆盖
// ========================

describe('Property 28: 来源共存不覆盖', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功抓取以 source=API_SYNC 追加记录，既有 MANUAL 记录全部保留且共存，绝不 update/delete', async () => {
    /**
     * **Validates: Requirements 7.8**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ base, manualRecords, works }) => {
        // ── 每次迭代重置内存状态 ──
        db.briefs = new Map()
        db.metrics = []
        db.metricSeq = 0
        db.metricMutations = []

        // 门店下的 brief（fetcher 返回的 briefId 均属本店，确保写入）
        for (const id of base.briefIds) {
          db.briefs.set(id, { id, storeId: base.storeId })
        }

        // 预置若干 source=MANUAL 记录（手动录入兜底数据）
        for (let i = 0; i < manualRecords.length; i++) {
          const m = manualRecords[i]
          db.metrics.push({
            id: `pm_manual_${i}`,
            contentBriefId: m.contentBriefId,
            platform: m.platform,
            views: m.counts.views,
            likes: m.counts.likes,
            comments: m.counts.comments,
            shares: m.counts.shares,
            saves: m.counts.saves,
            source: 'MANUAL',
            capturedAt: new Date('2024-01-01T00:00:00Z'),
          })
        }
        // 手动记录快照（深拷贝，structuredClone 保留 Date 类型），用于断言原样保留
        const manualSnapshot = structuredClone(db.metrics) as Array<Record<string, unknown>>

        // 账号：lastCrawledAt=null → 满足频率门控（允许抓取）；凭证用真实加密生成
        db.account = {
          id: base.accountId,
          storeId: base.storeId,
          platform: base.platform,
          encryptedCookie: encryptCredential('session-cookie-for-property28'),
          authConfirmed: true,
          status: 'ACTIVE',
          lastCrawledAt: null,
          crawlIntervalH: 24,
        }

        // 注入 fetcher：返回随机作品数据（source 由 crawler 标注为 API_SYNC）
        const fetcher = {
          fetchWorks: async () =>
            works.map((w) => ({
              contentBriefId: w.contentBriefId,
              platform: base.platform,
              views: w.counts.views,
              likes: w.counts.likes,
              comments: w.counts.comments,
              shares: w.counts.shares,
              saves: w.counts.saves,
            })),
        }

        const result = await crawlAccountMetrics({ platformAccountId: base.accountId, fetcher })

        // ── 断言 1：成功路径，无失败、无跳过 ──
        expect(result.failed).toBeUndefined()
        expect(result.skipped).toBeUndefined()
        expect(result.updatedBriefIds).toEqual(works.map((w) => w.contentBriefId))

        // ── 断言 2：从未对 PublishMetric 执行 update/delete/upsert（不覆盖手动记录）──
        expect(db.metricMutations).toEqual([])

        // ── 断言 3：既有 MANUAL 记录全部原样保留（按 id 深等于快照）──
        for (const snap of manualSnapshot) {
          const found = db.metrics.find((m) => m.id === snap.id)
          expect(found).toBeDefined()
          expect(found).toStrictEqual(snap)
        }

        // ── 断言 4：新增记录全部为 source=API_SYNC，且数量与作品数一致 ──
        const apiRecords = db.metrics.filter((m) => m.id.startsWith('pm_auto_'))
        expect(apiRecords.length).toBe(works.length)
        for (const r of apiRecords) {
          expect(r.source).toBe('API_SYNC')
        }

        // ── 断言 5：两类来源共存，总量 = 手动 + 自动 ──
        const manualCount = db.metrics.filter((m) => m.source === 'MANUAL').length
        const apiCount = db.metrics.filter((m) => m.source === 'API_SYNC').length
        expect(manualCount).toBe(manualRecords.length)
        expect(apiCount).toBe(works.length)
        expect(db.metrics.length).toBe(manualRecords.length + works.length)
      }),
      { numRuns: 200 }
    )
  })
})
