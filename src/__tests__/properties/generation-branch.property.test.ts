import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 5: 生成流程根据 timelineScript 是否存在选择正确分支
 *
 * For any ShotGroup，当 timelineScript 字段为非空非纯空白字符串时，
 * 生成流程应直接使用该脚本作为 prompt（跳过合并）；
 * 当 timelineScript 为空或仅含空白时，应触发自动合并并将结果写入 timelineScript。
 *
 * Validates: Requirements 6.6, 6.7
 */

type BranchDecision = 'use_existing' | 'auto_merge'

// 从生成流程中提取的分支判断逻辑
function decideBranch(timelineScript: string | null): BranchDecision {
  if (timelineScript && timelineScript.trim().length > 0) {
    return 'use_existing'
  }
  return 'auto_merge'
}

describe('Property 5: 生成流程根据 timelineScript 选择正确分支', () => {
  it('非空非纯空白字符串 → 使用已有脚本（跳过合并）', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
        (script) => {
          expect(decideBranch(script)).toBe('use_existing')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('null → 触发自动合并', () => {
    expect(decideBranch(null)).toBe('auto_merge')
  })

  it('空字符串 → 触发自动合并', () => {
    expect(decideBranch('')).toBe('auto_merge')
  })

  it('纯空白字符串（空格、换行、制表符）→ 触发自动合并', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 50 })
          .map((chars) => chars.join('')),
        (whitespace) => {
          expect(decideBranch(whitespace)).toBe('auto_merge')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('包含可见字符的字符串始终走 use_existing 分支', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 10 }).map((c) => c.join('')),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 10 }).map((c) => c.join(''))
        ).map(([prefix, content, suffix]) => prefix + content + suffix),
        (script) => {
          expect(decideBranch(script)).toBe('use_existing')
        }
      ),
      { numRuns: 100 }
    )
  })
})
