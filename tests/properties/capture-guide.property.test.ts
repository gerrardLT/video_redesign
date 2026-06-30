// Feature: local-life-depth-enhancements, Property 12: 拍摄指导阈值映射一致
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 12: 拍摄指导阈值映射一致
 *
 * 对任意 ShotTaskWithGuide（不同 type / durationSec / framingGuide），
 * capture-director.buildCaptureGuide 输出的 qualityThresholds 必须满足：
 *   - 固定阈值取值恒定：宽高比 0.5625(±2%)、短边 ≥720、亮度均值 ≥60；
 *   - durationSec.min / max 由该 ShotTask 设定的目标时长派生（±50%），
 *     来源唯一为 shotTask.durationSec，不被 type / framingGuide 影响。
 *
 * **Validates: Requirements 3.3**
 *
 * 测试手段：buildCaptureGuide 为纯计算函数，无需 mock。
 * 仅对 @/lib/db 做内存桩，避免 capture-director 模块在加载时经依赖链触发
 * Prisma（DATABASE_URL）初始化抛错；被测纯函数本身不触达任何数据库/外部依赖。
 */

// ========================
// Mock Prisma（仅为打断模块加载期的 db 初始化副作用，被测纯函数不使用）
// ========================
vi.mock('@/lib/db', () => ({ prisma: {} }))

// 动态导入以确保 mock 生效
const { buildCaptureGuide } = await import('@/lib/capture-director')
type ShotTaskWithGuide = Parameters<typeof buildCaptureGuide>[0]['shotTask']

// ShotTaskType 全集（与 src/types/merchant.ts ShotTaskTypeSchema 保持一致）
const SHOT_TASK_TYPES: ShotTaskWithGuide['type'][] = [
  'STOREFRONT',
  'PRODUCT_CLOSEUP',
  'COOKING_PROCESS',
  'STAFF_ACTION',
  'CUSTOMER_REACTION',
  'OWNER_TALKING',
  'ENVIRONMENT',
  'OFFER_DISPLAY',
  'CTA_SCREEN',
  'AI_GENERATED_FILLER',
]

/** 与实现一致的「保留 1 位小数」舍入，用于校验时长派生区间 */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 随机 framingGuide：可能为 null、空对象，或含任意 angle/movement/tips 字符串字段 */
const framingGuideArb: fc.Arbitrary<Record<string, unknown> | null> = fc.oneof(
  fc.constant(null),
  fc.record(
    {
      angle: fc.option(fc.string(), { nil: undefined }),
      movement: fc.option(fc.string(), { nil: undefined }),
      tips: fc.option(fc.string(), { nil: undefined }),
    },
    { requiredKeys: [] }
  )
)

/** 随机 qualityRules：可能为 null，或含 needsAudio 布尔 / 缺省 */
const qualityRulesArb: fc.Arbitrary<Record<string, unknown> | null> = fc.oneof(
  fc.constant(null),
  fc.record({ needsAudio: fc.option(fc.boolean(), { nil: undefined }) }, { requiredKeys: [] })
)

/** 随机 ShotTaskWithGuide 生成器 */
const shotTaskArb: fc.Arbitrary<ShotTaskWithGuide> = fc.record({
  type: fc.constantFrom(...SHOT_TASK_TYPES),
  title: fc.string(),
  instruction: fc.string(),
  // 目标时长：本地生活短视频镜头常见区间，保留 1 位小数
  durationSec: fc.double({ min: 1, max: 120, noNaN: true }).map(round1),
  framingGuide: framingGuideArb,
  qualityRules: qualityRulesArb,
  referenceUrls: fc.option(fc.array(fc.webUrl()), { nil: undefined }),
})

describe('Property 12: 拍摄指导阈值映射一致 (buildCaptureGuide)', () => {
  it('固定阈值恒定，时长区间由 shotTask.durationSec 派生(±50%)', () => {
    fc.assert(
      fc.property(shotTaskArb, (shotTask) => {
        const guide = buildCaptureGuide({ shotTask })
        const t = guide.qualityThresholds

        // 固定阈值取值恒定（不随输入变化）
        expect(t.aspectRatio.target).toBe(0.5625)
        expect(t.aspectRatio.tolerancePct).toBe(2)
        expect(t.minShortSidePx).toBe(720)
        expect(t.minAvgBrightness).toBe(60)

        // 时长区间来源唯一为 shotTask.durationSec（±50%）
        expect(t.durationSec.min).toBe(round1(shotTask.durationSec * 0.5))
        expect(t.durationSec.max).toBe(round1(shotTask.durationSec * 1.5))

        // 区间合法：min ≤ 目标 ≤ max
        expect(t.durationSec.min).toBeLessThanOrEqual(shotTask.durationSec)
        expect(t.durationSec.max).toBeGreaterThanOrEqual(shotTask.durationSec)
      }),
      { numRuns: 200 }
    )
  })
})
