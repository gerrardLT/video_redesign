// Feature: local-life-depth-enhancements, Property 9: 文案就地编辑往返
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 9: 文案就地编辑往返
 *
 * 对任意平台文案 PlatformCopy（title/coverTitle/caption/tags/cta）与任意平台 platform：
 * 调用 publish-copy-service.saveManualCopy 保存后，再读取 ContentBrief.platformCopies[platform]
 * 必须等于入参 copy（原样保存，编辑往返一致），且 ContentBrief.copyEdited 被置为 true（人工修改标记）。
 *
 * **Validates: Requirements 2.1**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——用一块内存状态模拟 ContentBrief 的
 * platformCopies / copyEdited 列。$transaction 透传内存事务对象，findUniqueOrThrow 读取
 * 内存状态、update 写入内存状态，从而真实复现「写入后再读取」的往返语义；不依赖真实数据库、无 fallback。
 */

// ========================
// Mock Prisma（内存桩：模拟 ContentBrief 行的读写往返）
// ========================

// 单行内存状态（每次迭代重置）：仅含 saveManualCopy 关心的两列
const dbState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: { platformCopies: null as Record<string, any> | null, copyEdited: false },
}))

vi.mock('@/lib/db', () => {
  // tx 上的 contentBrief 读写实现，直接作用于内存行状态
  const contentBrief = {
    // 按 select 返回 platformCopies（saveManualCopy 仅 select platformCopies）
    findUniqueOrThrow: vi.fn(async () => ({ platformCopies: dbState.row.platformCopies })),
    // 捕获写入的 data，落到内存行（模拟持久化）
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ('platformCopies' in data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dbState.row.platformCopies = data.platformCopies as Record<string, any>
      }
      if ('copyEdited' in data) {
        dbState.row.copyEdited = data.copyEdited as boolean
      }
      return { id: 'brief_test', ...data }
    }),
  }
  return {
    prisma: {
      contentBrief,
      // $transaction 透传同一组内存读写方法（callback 形式）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({ contentBrief })),
    },
  }
})

// 动态导入以确保 mock 生效
const { saveManualCopy } = await import('@/lib/publish-copy-service')

// PublishPlatform 枚举取值（与 src/types/merchant.ts PublishPlatformSchema 对齐）
const PUBLISH_PLATFORMS = [
  'DOUYIN',
  'KUAISHOU',
  'XIAOHONGSHU',
  'WECHAT_CHANNELS',
  'MANUAL_EXPORT',
] as const

// ========================
// Arbitraries
// ========================

// 随机生成单平台文案：覆盖各字段（含空字符串、空标签数组等边界），原样保存不应被改动
const platformCopyArb = fc.record({
  title: fc.string({ maxLength: 40 }),
  coverTitle: fc.string({ maxLength: 20 }),
  caption: fc.string({ maxLength: 300 }),
  tags: fc.array(fc.string({ maxLength: 16 }), { maxLength: 12 }),
  cta: fc.string({ maxLength: 24 }),
})

const platformArb = fc.constantFrom(...PUBLISH_PLATFORMS)

// 初始 platformCopies：可能为 null，或已含其它平台/同平台的旧文案（验证写入不破坏其它平台）
const initialCopiesArb = fc.option(
  fc.dictionary(fc.constantFrom(...PUBLISH_PLATFORMS), platformCopyArb, { maxKeys: 4 }),
  { nil: null }
)

// ========================
// Property 9: 文案就地编辑往返
// ========================

describe('Property 9: 文案就地编辑往返', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saveManualCopy 保存后再读取 platformCopies[platform] 等于入参，且 copyEdited=true', async () => {
    /**
     * **Validates: Requirements 2.1**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        platformArb,
        platformCopyArb,
        initialCopiesArb,
        async (contentBriefId, platform, copy, initialCopies) => {
          // 每次迭代重置内存行状态（避免跨迭代污染）
          dbState.row.platformCopies = initialCopies
            ? // 深拷贝，避免与断言引用同一对象
              (JSON.parse(JSON.stringify(initialCopies)) as Record<string, unknown>)
            : null
          dbState.row.copyEdited = false

          await saveManualCopy({ contentBriefId, platform, copy })

          // 往返一致：再读取该平台文案，必须深等于入参 copy（原样保存，未被改写）
          const saved = dbState.row.platformCopies
          expect(saved).not.toBeNull()
          expect(saved![platform]).toStrictEqual(copy)

          // 人工修改标记必须被置为 true
          expect(dbState.row.copyEdited).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('写入目标平台不破坏其它已存在平台的文案', async () => {
    /**
     * **Validates: Requirements 2.1**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        platformArb,
        platformCopyArb,
        // 保证初始含其它平台的旧文案
        fc.dictionary(fc.constantFrom(...PUBLISH_PLATFORMS), platformCopyArb, { minKeys: 1, maxKeys: 5 }),
        async (contentBriefId, platform, copy, initialCopies) => {
          const snapshot = JSON.parse(JSON.stringify(initialCopies)) as Record<string, unknown>
          dbState.row.platformCopies = JSON.parse(JSON.stringify(initialCopies))
          dbState.row.copyEdited = false

          await saveManualCopy({ contentBriefId, platform, copy })

          const saved = dbState.row.platformCopies!
          // 目标平台等于新入参
          expect(saved[platform]).toStrictEqual(copy)
          // 其它平台保持快照中的原值（未被波及）
          for (const key of Object.keys(snapshot)) {
            if (key === platform) continue
            expect(saved[key]).toStrictEqual(snapshot[key])
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
