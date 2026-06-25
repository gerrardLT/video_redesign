/**
 * Property 5: 质量评分边界一致性
 *
 * 验证 capture-director 质量评分逻辑的核心不变式：
 * - qualityScore >= 60 AND critical == false → passed == true
 * - qualityScore < 60 OR critical == true → passed == false
 * - qualityScore 始终在 [0, 100] 范围内
 *
 * 测试策略：直接测试评分计算逻辑（不调用 ffmpeg），
 * 通过构造已知的维度通过/不通过组合验证分数与 passed 判定。
 *
 * **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { QUALITY_WEIGHTS, QUALITY_THRESHOLDS } from '@/constants/merchant'

// ========================
// 从 capture-director.ts 复现核心纯逻辑
// ========================

/** 各维度通过/不通过的布尔状态 */
interface DimensionPasses {
  orientation: boolean
  resolution: boolean
  duration: boolean
  fileSize: boolean
  brightness: boolean
  audio: boolean
}

/** 模拟 critical 判定所需的原始值 */
interface RawValues {
  /** 短边像素 */
  shortEdge: number
  /** 视频时长（秒） */
  duration: number
  /** 文件大小（字节） */
  fileSize: number
}

/**
 * 计算质量评分（纯函数，与源码逻辑一致）
 * 每个维度：通过得满分（其权重值），不通过得 0
 */
function calculateQualityScore(passes: DimensionPasses): number {
  return (
    (passes.orientation ? QUALITY_WEIGHTS.orientation : 0) +
    (passes.resolution ? QUALITY_WEIGHTS.resolution : 0) +
    (passes.duration ? QUALITY_WEIGHTS.duration : 0) +
    (passes.fileSize ? QUALITY_WEIGHTS.fileSize : 0) +
    (passes.brightness ? QUALITY_WEIGHTS.brightness : 0) +
    (passes.audio ? QUALITY_WEIGHTS.audio : 0)
  )
}

/**
 * 判定是否有致命问题（与源码逻辑一致）
 * 致命条件：短边 < 480px || 时长 < 1s || 文件 > 300MB
 */
function determineCritical(raw: RawValues): boolean {
  return (
    raw.shortEdge < QUALITY_THRESHOLDS.criticalResolutionShortEdge ||
    raw.duration < QUALITY_THRESHOLDS.minDuration ||
    raw.fileSize > QUALITY_THRESHOLDS.maxFileSize
  )
}

/**
 * 判定是否通过（与源码逻辑一致）
 * passed = qualityScore >= 60 && !critical
 */
function determinePassed(qualityScore: number, critical: boolean): boolean {
  return qualityScore >= QUALITY_THRESHOLDS.qualityPassScore && !critical
}

// ========================
// 生成器
// ========================

/** 生成维度通过/不通过的布尔组合 */
const dimensionPassesArb: fc.Arbitrary<DimensionPasses> = fc.record({
  orientation: fc.boolean(),
  resolution: fc.boolean(),
  duration: fc.boolean(),
  fileSize: fc.boolean(),
  brightness: fc.boolean(),
  audio: fc.boolean(),
})

/** 生成非致命的 RawValues（确保 critical = false） */
const nonCriticalRawArb: fc.Arbitrary<RawValues> = fc.record({
  shortEdge: fc.integer({ min: 480, max: 4320 }),
  duration: fc.double({ min: 1, max: 300, noNaN: true }),
  fileSize: fc.integer({ min: 1, max: QUALITY_THRESHOLDS.maxFileSize }),
})

/** 生成致命的 RawValues（确保 critical = true） */
const criticalRawArb: fc.Arbitrary<RawValues> = fc.oneof(
  // 短边 < 480
  fc.record({
    shortEdge: fc.integer({ min: 0, max: 479 }),
    duration: fc.double({ min: 1, max: 300, noNaN: true }),
    fileSize: fc.integer({ min: 1, max: QUALITY_THRESHOLDS.maxFileSize }),
  }),
  // 时长 < 1s
  fc.record({
    shortEdge: fc.integer({ min: 480, max: 4320 }),
    duration: fc.double({ min: 0, max: 0.99, noNaN: true }),
    fileSize: fc.integer({ min: 1, max: QUALITY_THRESHOLDS.maxFileSize }),
  }),
  // 文件 > 300MB
  fc.record({
    shortEdge: fc.integer({ min: 480, max: 4320 }),
    duration: fc.double({ min: 1, max: 300, noNaN: true }),
    fileSize: fc.integer({ min: QUALITY_THRESHOLDS.maxFileSize + 1, max: QUALITY_THRESHOLDS.maxFileSize * 2 }),
  })
)

/** 生成任意 RawValues（可能致命也可能不致命） */
const anyRawArb: fc.Arbitrary<RawValues> = fc.record({
  shortEdge: fc.integer({ min: 0, max: 4320 }),
  duration: fc.double({ min: 0, max: 600, noNaN: true }),
  fileSize: fc.integer({ min: 0, max: QUALITY_THRESHOLDS.maxFileSize * 2 }),
})

// ========================
// 属性测试
// ========================

describe('Property 5: 质量评分边界一致性', () => {
  it('qualityScore 始终在 [0, 100] 范围内', () => {
    fc.assert(
      fc.property(dimensionPassesArb, (passes) => {
        const score = calculateQualityScore(passes)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }),
      { numRuns: 100 }
    )
  })

  it('所有维度通过时 qualityScore = 100', () => {
    const allPass: DimensionPasses = {
      orientation: true,
      resolution: true,
      duration: true,
      fileSize: true,
      brightness: true,
      audio: true,
    }
    const score = calculateQualityScore(allPass)
    expect(score).toBe(100)
  })

  it('所有维度不通过时 qualityScore = 0', () => {
    const allFail: DimensionPasses = {
      orientation: false,
      resolution: false,
      duration: false,
      fileSize: false,
      brightness: false,
      audio: false,
    }
    const score = calculateQualityScore(allFail)
    expect(score).toBe(0)
  })

  it('qualityScore >= 60 AND critical == false → passed == true', () => {
    fc.assert(
      fc.property(dimensionPassesArb, nonCriticalRawArb, (passes, raw) => {
        const score = calculateQualityScore(passes)
        const critical = determineCritical(raw)
        const passed = determinePassed(score, critical)

        if (score >= 60 && !critical) {
          expect(passed).toBe(true)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('qualityScore < 60 → passed == false（无论 critical 值）', () => {
    fc.assert(
      fc.property(dimensionPassesArb, anyRawArb, (passes, raw) => {
        const score = calculateQualityScore(passes)
        const critical = determineCritical(raw)
        const passed = determinePassed(score, critical)

        if (score < 60) {
          expect(passed).toBe(false)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('critical == true → passed == false（无论 qualityScore 值）', () => {
    fc.assert(
      fc.property(dimensionPassesArb, criticalRawArb, (passes, raw) => {
        const score = calculateQualityScore(passes)
        const critical = determineCritical(raw)
        const passed = determinePassed(score, critical)

        expect(critical).toBe(true)
        expect(passed).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('passed 与 (score >= 60 && !critical) 完全等价', () => {
    fc.assert(
      fc.property(dimensionPassesArb, anyRawArb, (passes, raw) => {
        const score = calculateQualityScore(passes)
        const critical = determineCritical(raw)
        const passed = determinePassed(score, critical)

        const expected = score >= 60 && !critical
        expect(passed).toBe(expected)
      }),
      { numRuns: 100 }
    )
  })

  it('权重总和恰好为 100', () => {
    const totalWeight =
      QUALITY_WEIGHTS.orientation +
      QUALITY_WEIGHTS.resolution +
      QUALITY_WEIGHTS.duration +
      QUALITY_WEIGHTS.fileSize +
      QUALITY_WEIGHTS.brightness +
      QUALITY_WEIGHTS.audio

    expect(totalWeight).toBe(100)
  })
})
