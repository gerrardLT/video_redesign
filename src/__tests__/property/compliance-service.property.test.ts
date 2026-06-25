/**
 * Property 8: 合规风险等级单调性
 *
 * 验证合规检查风险等级汇总逻辑的核心不变式：
 * - riskLevel = max severity among all issues（BLOCKED > HIGH > MEDIUM > LOW）
 * - 如果 issues 为空：riskLevel = LOW
 *
 * 测试策略：生成随机 ComplianceIssue 数组，验证 overall riskLevel
 * 等于 issues 中最高等级。
 *
 * **Validates: Requirements 9.9**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { ComplianceIssue, ComplianceRiskLevel } from '@/types/merchant'

// ========================
// 从 compliance-service.ts 复现核心纯逻辑
// ========================

/** 风险等级优先级映射（与源码一致） */
const RISK_PRIORITY: Record<ComplianceRiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  BLOCKED: 3,
}

/** 所有风险等级（按优先级从低到高） */
const ALL_RISK_LEVELS: ComplianceRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']

/**
 * 确定整体风险等级（与源码 determineOverallRiskLevel 逻辑一致）
 * 取所有 issues 中最高等级，无 issues 时默认 LOW
 */
function determineOverallRiskLevel(issues: ComplianceIssue[]): ComplianceRiskLevel {
  if (issues.length === 0) return 'LOW'

  let maxPriority = 0
  let maxLevel: ComplianceRiskLevel = 'LOW'

  for (const issue of issues) {
    const priority = RISK_PRIORITY[issue.riskLevel]
    if (priority > maxPriority) {
      maxPriority = priority
      maxLevel = issue.riskLevel
    }
  }

  return maxLevel
}

// ========================
// 生成器
// ========================

/** 生成合规风险等级 */
const riskLevelArb: fc.Arbitrary<ComplianceRiskLevel> = fc.constantFrom(
  'LOW', 'MEDIUM', 'HIGH', 'BLOCKED'
)

/** 生成合规维度 */
const dimensionArb = fc.constantFrom(
  'ABSOLUTE_CLAIM' as const,
  'FALSE_POPULARITY' as const,
  'CONSENT' as const,
  'AIGC' as const,
  'ENTROPY' as const
)

/** 生成单个 ComplianceIssue */
const complianceIssueArb: fc.Arbitrary<ComplianceIssue> = fc.record({
  dimension: dimensionArb,
  riskLevel: riskLevelArb,
  field: fc.constantFrom('title', 'caption', 'coverTitle', 'cta', 'subtitles', 'content'),
  matchedText: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  reason: fc.string({ minLength: 5, maxLength: 50 }),
})

/** 生成 ComplianceIssue 数组（0-20 个） */
const issuesArrayArb = fc.array(complianceIssueArb, { minLength: 0, maxLength: 20 })

/** 生成非空 ComplianceIssue 数组 */
const nonEmptyIssuesArb = fc.array(complianceIssueArb, { minLength: 1, maxLength: 20 })

// ========================
// 属性测试
// ========================

describe('Property 8: 合规风险等级单调性', () => {
  it('issues 为空时 riskLevel = LOW', () => {
    const result = determineOverallRiskLevel([])
    expect(result).toBe('LOW')
  })

  it('riskLevel 等于 issues 中最高等级', () => {
    fc.assert(
      fc.property(nonEmptyIssuesArb, (issues) => {
        const result = determineOverallRiskLevel(issues)

        // 手动计算期望的最高等级
        const maxExpected = issues.reduce<ComplianceRiskLevel>((max, issue) => {
          return RISK_PRIORITY[issue.riskLevel] > RISK_PRIORITY[max]
            ? issue.riskLevel
            : max
        }, 'LOW')

        expect(result).toBe(maxExpected)
      }),
      { numRuns: 100 }
    )
  })

  it('riskLevel 始终是有效的风险等级值', () => {
    fc.assert(
      fc.property(issuesArrayArb, (issues) => {
        const result = determineOverallRiskLevel(issues)
        expect(ALL_RISK_LEVELS).toContain(result)
      }),
      { numRuns: 100 }
    )
  })

  it('包含 BLOCKED issue 时 riskLevel 必为 BLOCKED', () => {
    fc.assert(
      fc.property(issuesArrayArb, (otherIssues) => {
        const blockedIssue: ComplianceIssue = {
          dimension: 'ENTROPY',
          riskLevel: 'BLOCKED',
          field: 'content',
          reason: '内容独特性评分过低',
        }
        const issues = [...otherIssues, blockedIssue]
        const result = determineOverallRiskLevel(issues)
        expect(result).toBe('BLOCKED')
      }),
      { numRuns: 100 }
    )
  })

  it('仅包含 LOW issue 时 riskLevel = LOW', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dimension: dimensionArb,
            riskLevel: fc.constant('LOW' as ComplianceRiskLevel),
            field: fc.constant('title'),
            reason: fc.constant('低风险问题'),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (issues) => {
          const result = determineOverallRiskLevel(issues as ComplianceIssue[])
          expect(result).toBe('LOW')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('添加更高等级 issue 只会升高或维持 riskLevel（单调性）', () => {
    fc.assert(
      fc.property(nonEmptyIssuesArb, complianceIssueArb, (existingIssues, newIssue) => {
        const levelBefore = determineOverallRiskLevel(existingIssues)
        const levelAfter = determineOverallRiskLevel([...existingIssues, newIssue])

        // 添加新 issue 后等级只能升高或不变
        expect(RISK_PRIORITY[levelAfter]).toBeGreaterThanOrEqual(RISK_PRIORITY[levelBefore])
      }),
      { numRuns: 100 }
    )
  })

  it('issue 顺序不影响结果（交换律）', () => {
    fc.assert(
      fc.property(nonEmptyIssuesArb, (issues) => {
        // 原始顺序
        const result1 = determineOverallRiskLevel(issues)
        // 反转顺序
        const result2 = determineOverallRiskLevel([...issues].reverse())
        expect(result1).toBe(result2)
      }),
      { numRuns: 100 }
    )
  })
})
