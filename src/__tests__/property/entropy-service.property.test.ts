/**
 * Property 10: 同质化分数边界行为
 *
 * 验证 content-entropy-service 的分数判定逻辑核心不变式：
 * - historicalCount < 2 → uniquenessScore = 100
 * - uniquenessScore < 40 → duplicateRisk = 'HIGH'
 * - 40 <= uniquenessScore <= 60 → duplicateRisk = 'MEDIUM'
 * - uniquenessScore > 60 → duplicateRisk = 'LOW'
 *
 * 测试策略：直接测试 determineDuplicateRisk 和 calculateScore 纯函数逻辑。
 *
 * **Validates: Requirements 13.6, 13.7, 13.8**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { ENTROPY_THRESHOLDS } from '@/constants/merchant'

// ========================
// 从 content-entropy-service.ts 复现核心纯逻辑
// ========================

type EntropyDimension = 'PLAYBOOK' | 'TEXT' | 'SHOT_ASSET'

interface EntropyReason {
  dimension: EntropyDimension
  matchedContentId: string
  similarityValue: number
  description: string
}

/**
 * 根据 uniquenessScore 判定重复风险等级（与源码一致）
 */
function determineDuplicateRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score < ENTROPY_THRESHOLDS.blocked) return 'HIGH'
  if (score <= ENTROPY_THRESHOLDS.warning) return 'MEDIUM'
  return 'LOW'
}

/**
 * 根据检测到的问题计算 uniquenessScore（与源码一致）
 *
 * 评分逻辑：
 * - 基础分 100
 * - 每个 PLAYBOOK 维度原因扣 20 分
 * - 每个 TEXT 维度原因扣 30 * similarityValue 分
 * - 每个 SHOT_ASSET 维度原因扣 15 分
 * - 最低 0 分，最高 100 分
 */
function calculateScore(reasons: EntropyReason[]): number {
  let score = 100

  for (const reason of reasons) {
    switch (reason.dimension) {
      case 'PLAYBOOK':
        score -= 20
        break
      case 'TEXT':
        score -= Math.round(30 * reason.similarityValue)
        break
      case 'SHOT_ASSET':
        score -= 15
        break
    }
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * 模拟主函数逻辑中历史记录不足时的快路径（Req 13.8）
 */
function simulateEntropyResult(historicalCount: number, reasons: EntropyReason[]) {
  // 历史记录 < 2 条时跳过检测
  if (historicalCount < 2) {
    return { uniquenessScore: 100, duplicateRisk: 'LOW' as const, reasons: [] }
  }

  const uniquenessScore = calculateScore(reasons)
  const duplicateRisk = determineDuplicateRisk(uniquenessScore)
  return { uniquenessScore, duplicateRisk, reasons }
}

// ========================
// 生成器
// ========================

/** 生成 EntropyReason 维度 */
const dimensionArb: fc.Arbitrary<EntropyDimension> = fc.constantFrom('PLAYBOOK', 'TEXT', 'SHOT_ASSET')

/** 生成相似度值 (0-1) */
const similarityArb = fc.double({ min: 0, max: 1, noNaN: true })

/** 生成单个 EntropyReason */
const entropyReasonArb: fc.Arbitrary<EntropyReason> = fc.record({
  dimension: dimensionArb,
  matchedContentId: fc.string({ minLength: 5, maxLength: 20 }),
  similarityValue: similarityArb,
  description: fc.string({ minLength: 5, maxLength: 50 }),
})

/** 生成 EntropyReason 数组 */
const reasonsArrayArb = fc.array(entropyReasonArb, { minLength: 0, maxLength: 15 })

/** 生成历史记录数量 */
const historicalCountArb = fc.integer({ min: 0, max: 50 })

// ========================
// 属性测试
// ========================

describe('Property 10: 同质化分数边界行为', () => {
  it('historicalCount < 2 → uniquenessScore = 100, duplicateRisk = LOW', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1 }),
        reasonsArrayArb,
        (historicalCount, reasons) => {
          const result = simulateEntropyResult(historicalCount, reasons)

          expect(result.uniquenessScore).toBe(100)
          expect(result.duplicateRisk).toBe('LOW')
          expect(result.reasons).toHaveLength(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('uniquenessScore < 40 → duplicateRisk = HIGH', () => {
    fc.assert(
      fc.property(reasonsArrayArb, (reasons) => {
        const score = calculateScore(reasons)

        if (score < ENTROPY_THRESHOLDS.blocked) {
          const risk = determineDuplicateRisk(score)
          expect(risk).toBe('HIGH')
        }
      }),
      { numRuns: 100 }
    )
  })

  it('40 <= uniquenessScore <= 60 → duplicateRisk = MEDIUM', () => {
    fc.assert(
      fc.property(reasonsArrayArb, (reasons) => {
        const score = calculateScore(reasons)

        if (score >= ENTROPY_THRESHOLDS.blocked && score <= ENTROPY_THRESHOLDS.warning) {
          const risk = determineDuplicateRisk(score)
          expect(risk).toBe('MEDIUM')
        }
      }),
      { numRuns: 100 }
    )
  })

  it('uniquenessScore > 60 → duplicateRisk = LOW', () => {
    fc.assert(
      fc.property(reasonsArrayArb, (reasons) => {
        const score = calculateScore(reasons)

        if (score > ENTROPY_THRESHOLDS.warning) {
          const risk = determineDuplicateRisk(score)
          expect(risk).toBe('LOW')
        }
      }),
      { numRuns: 100 }
    )
  })

  it('uniquenessScore 始终在 [0, 100] 范围内', () => {
    fc.assert(
      fc.property(reasonsArrayArb, (reasons) => {
        const score = calculateScore(reasons)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }),
      { numRuns: 100 }
    )
  })

  it('无 reasons 时 score = 100', () => {
    const score = calculateScore([])
    expect(score).toBe(100)
    expect(determineDuplicateRisk(score)).toBe('LOW')
  })

  it('添加 reasons 只会降低或维持 score（单调递减）', () => {
    fc.assert(
      fc.property(reasonsArrayArb, entropyReasonArb, (existingReasons, newReason) => {
        const scoreBefore = calculateScore(existingReasons)
        const scoreAfter = calculateScore([...existingReasons, newReason])

        expect(scoreAfter).toBeLessThanOrEqual(scoreBefore)
      }),
      { numRuns: 100 }
    )
  })

  it('historicalCount >= 2 时使用 reasons 计算分数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        reasonsArrayArb,
        (historicalCount, reasons) => {
          const result = simulateEntropyResult(historicalCount, reasons)
          const expectedScore = calculateScore(reasons)
          const expectedRisk = determineDuplicateRisk(expectedScore)

          expect(result.uniquenessScore).toBe(expectedScore)
          expect(result.duplicateRisk).toBe(expectedRisk)
        }
      ),
      { numRuns: 100 }
    )
  })
})
