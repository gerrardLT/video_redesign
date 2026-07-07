// Feature: local-life-depth-enhancements, Property 31: 发布标记往返
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 31: 发布标记往返
 *
 * 对任意「平台 + 发布时间」序列，依次调用 publish-queue-service.markPublished 后，
 * PublishQueueItem.publishedPlatforms 必须：
 *   1. 包含每个被标记过的平台，且每个平台恰出现一次（同平台去重）；
 *   2. 每个平台记录的 publishedAt 等于该平台最后一次标记时间的 ISO 8601 字符串
 *      （同平台重复标记以最新时间覆盖）；
 *   3. 标记后该内容即被纳入后续数据回填/复盘范围（即 publishedPlatforms 非空，
 *      可被复盘读取）。
 *
 * **Validates: Requirements 8.4**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——用一行内存状态模拟 PublishQueueItem
 * 的 publishedPlatforms JSON 数组。findUnique 读取内存状态、update 写回内存状态，
 * 真实复现「标记写入后再读取」的往返语义；不依赖真实数据库、无 fallback、无伪造数据。
 */

// ========================
// Mock Prisma（内存桩：模拟 PublishQueueItem.publishedPlatforms JSON 数组读写）
// ========================

// 单行内存状态（每次迭代重置）：仅含 markPublished 关心的 publishedPlatforms 列
const dbState = vi.hoisted(() => ({
  // publishedPlatforms 以 JSON 数组形式存储（与生产 Prisma Json 列一致）
  publishedPlatforms: [] as unknown[] | null,
  exists: true,
}))

vi.mock('@/lib/shared/db', () => {
  const publishQueueItem = {
    // markPublished select publishedPlatforms + contentBriefId；行不存在时返回 null
    findUnique: vi.fn(async () =>
      dbState.exists
        ? { publishedPlatforms: dbState.publishedPlatforms, contentBriefId: 'brief_test' }
        : null,
    ),
    // 捕获写入的 publishedPlatforms 落到内存行（模拟持久化）
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ('publishedPlatforms' in data) {
        dbState.publishedPlatforms = data.publishedPlatforms as unknown[]
      }
      return { id: 'item_test', ...data }
    }),
  }
  const contentBrief = {
    // markPublished 同步 ContentBrief 状态（EXPORTED → PUBLISHED）
    findUnique: vi.fn(async () => ({ status: 'EXPORTED' })),
    update: vi.fn(async () => ({})),
  }
  return { prisma: { publishQueueItem, contentBrief } }
})

// 动态导入以确保 mock 生效
const { markPublished } = await import('@/lib/merchant/publish-queue-service')

// PublishPlatform 枚举取值（与 src/types/merchant.ts PublishPlatformSchema 对齐）
const PUBLISH_PLATFORMS = [
  'DOUYIN',
  'KUAISHOU',
  'XIAOHONGSHU',
  'WECHAT_CHANNELS',
  'MANUAL_EXPORT',
] as const

// 已发布平台条目结构（与服务层 PublishedPlatformEntry 对齐）
interface Entry {
  platform: string
  publishedAt: string
}

// ========================
// Arbitraries
// ========================

const platformArb = fc.constantFrom(...PUBLISH_PLATFORMS)

// 发布时间：限定在合理区间，确保 toISOString 稳定（避免无效 Date）
const dateArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) })
  .map((ms) => new Date(ms))

// 一次标记动作：平台 + 发布时间
const markArb = fc.record({ platform: platformArb, publishedAt: dateArb })

// 标记序列：至少 1 次，可包含同平台多次（验证去重与最新覆盖）
const markSequenceArb = fc.array(markArb, { minLength: 1, maxLength: 20 })

// ========================
// Property 31: 发布标记往返
// ========================

describe('Property 31: 发布标记往返', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('依次标记后 publishedPlatforms 含每个平台与其最后一次发布时间(ISO)，同平台去重', async () => {
    /**
     * **Validates: Requirements 8.4**
     */
    await fc.assert(
      fc.asyncProperty(fc.uuid(), markSequenceArb, async (publishQueueItemId, marks) => {
        // 每次迭代重置内存行状态（避免跨迭代污染）
        dbState.publishedPlatforms = []
        dbState.exists = true

        // 计算预期：每个平台 → 最后一次标记时间（模拟「最新覆盖去重」语义）
        const expectedLatest = new Map<string, Date>()
        for (const m of marks) {
          await markPublished({ publishQueueItemId, platform: m.platform, publishedAt: m.publishedAt })
          expectedLatest.set(m.platform, m.publishedAt)
        }

        const stored = dbState.publishedPlatforms as Entry[]

        // 1) 标记后内容被纳入复盘范围：publishedPlatforms 非空
        expect(stored.length).toBeGreaterThan(0)

        // 2) 同平台去重：每个平台恰出现一次，平台集合与被标记集合一致
        const storedPlatforms = stored.map((e) => e.platform)
        expect(new Set(storedPlatforms).size).toBe(storedPlatforms.length)
        expect(new Set(storedPlatforms)).toStrictEqual(new Set(expectedLatest.keys()))

        // 3) 每个平台记录最后一次发布时间的 ISO 8601 字符串
        for (const entry of stored) {
          const latest = expectedLatest.get(entry.platform)
          expect(latest).toBeDefined()
          expect(entry.publishedAt).toBe(latest!.toISOString())
        }
      }),
      { numRuns: 200 },
    )
  })

  it('同平台重复标记以最新时间覆盖且不重复堆积', async () => {
    /**
     * **Validates: Requirements 8.4**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        platformArb,
        fc.array(dateArb, { minLength: 2, maxLength: 10 }),
        async (publishQueueItemId, platform, times) => {
          dbState.publishedPlatforms = []
          dbState.exists = true

          for (const t of times) {
            await markPublished({ publishQueueItemId, platform, publishedAt: t })
          }

          const stored = dbState.publishedPlatforms as Entry[]
          // 同一平台多次标记后仅保留一条记录
          expect(stored.length).toBe(1)
          expect(stored[0].platform).toBe(platform)
          // 时间为最后一次标记（覆盖语义）
          expect(stored[0].publishedAt).toBe(times[times.length - 1].toISOString())
        },
      ),
      { numRuns: 200 },
    )
  })
})
