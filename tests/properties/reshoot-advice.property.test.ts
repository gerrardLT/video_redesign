// Feature: local-life-depth-enhancements, Property 13: 重拍建议对应失败维度
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 13: 重拍建议对应失败维度
 *
 * 对任意 QualityInspectionResult.report（各维度 pass 布尔 + value），
 * capture-director.buildReshootAdvice 返回的 advice：
 *   - 其覆盖的维度集合，恰等于 5 个可重拍维度
 *     (orientation/resolution/duration/brightness/audio) 中 pass=false 的集合；
 *   - 不为 pass=true 的通过维度产出建议（无多余）；
 *   - 不遗漏任何 pass=false 的失败维度（无遗漏）；
 *   - 仅覆盖 5 个可重拍维度，fileSize 维度无论 pass 与否都不纳入。
 *
 * **Validates: Requirements 3.4**
 *
 * 测试手段：buildReshootAdvice 为纯计算函数，无需 mock。
 * 仅对 @/lib/db 做内存桩，避免 capture-director 模块在加载时经依赖链触发
 * Prisma（DATABASE_URL）初始化抛错；被测纯函数本身不触达任何数据库/外部依赖。
 */

// ========================
// Mock Prisma（仅为打断模块加载期的 db 初始化副作用，被测纯函数不使用）
// ========================
vi.mock('@/lib/db', () => ({ prisma: {} }))

// 动态导入以确保 mock 生效
const { buildReshootAdvice } = await import('@/lib/capture-director')
type ReshootInput = Parameters<typeof buildReshootAdvice>[0]
type Report = ReshootInput['report']
type Thresholds = ReshootInput['thresholds']
type DimensionResult = Report['orientation']

/** buildReshootAdvice 仅覆盖的 5 个可重拍维度（不含 fileSize） */
const RESHOOT_DIMENSIONS = [
  'orientation',
  'resolution',
  'duration',
  'brightness',
  'audio',
] as const

/** 固定阈值（buildReshootAdvice 仅用于话术参照，不影响维度判定） */
const thresholds: Thresholds = {
  aspectRatio: { target: 0.5625, tolerancePct: 2 },
  minShortSidePx: 720,
  durationSec: { min: 5, max: 15 },
  minAvgBrightness: 60,
  needsAudio: true,
}

/** 随机单维度检测结果：pass 布尔 + 任意 value（字符串/数值/布尔） */
const dimensionResultArb: fc.Arbitrary<DimensionResult> = fc.record({
  value: fc.oneof(
    fc.string(),
    fc.double({ noNaN: true }),
    fc.boolean()
  ),
  pass: fc.boolean(),
  message: fc.option(fc.string(), { nil: undefined }),
})

/** 随机完整 report：6 个维度各自独立生成（含不参与重拍的 fileSize） */
const reportArb: fc.Arbitrary<Report> = fc.record({
  orientation: dimensionResultArb,
  resolution: dimensionResultArb,
  duration: dimensionResultArb,
  fileSize: dimensionResultArb,
  brightness: dimensionResultArb,
  audio: dimensionResultArb,
})

describe('Property 13: 重拍建议对应失败维度 (buildReshootAdvice)', () => {
  it('建议覆盖的维度集合恰等于 5 个可重拍维度中 pass=false 的集合', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const advices = buildReshootAdvice({ report, thresholds })
        const adviceDims = advices.map((a) => a.dimension)

        // 期望失败维度集合：5 个可重拍维度中 pass=false（fileSize 不纳入）
        const expectedFailed = RESHOOT_DIMENSIONS.filter((d) => !report[d].pass)

        // 集合相等：无多余、无遗漏
        expect([...adviceDims].sort()).toEqual([...expectedFailed].sort())

        // 维度不重复
        expect(new Set(adviceDims).size).toBe(adviceDims.length)

        // 不为通过维度产出建议
        for (const a of advices) {
          expect(report[a.dimension].pass).toBe(false)
        }

        // 不遗漏任何失败维度
        for (const d of expectedFailed) {
          expect(adviceDims).toContain(d)
        }

        // fileSize 永不出现在建议中（仅覆盖 5 个可重拍维度）
        expect(adviceDims).not.toContain('fileSize')

        // 每条建议的 failedValue 来自对应维度的 value
        for (const a of advices) {
          expect(a.failedValue).toBe(String(report[a.dimension].value))
          expect(typeof a.advice).toBe('string')
          expect(a.advice.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 200 }
    )
  })
})
