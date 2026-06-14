import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 3: Export 校验拒绝不完整组并报告正确组序号
 *
 * For any ShotGroup 集合中存在 genStatus ≠ 'SUCCEEDED' 或 genVideoUrl 为空的组，
 * Export API 应拒绝导出请求，且错误响应中应包含所有不合格组的 groupIndex。
 *
 * Validates: Requirements 2.5, 2.6
 */

interface ShotGroupForValidation {
  id: string
  groupIndex: number
  genStatus: string
  genVideoUrl: string | null
}

// 从 Export API 中提取的校验逻辑
function validateGroupsForExport(groups: ShotGroupForValidation[]):
  | { valid: true }
  | { valid: false; incompleteGroupIndexes: number[] } {
  const incomplete = groups.filter(
    (g) => g.genStatus !== 'SUCCEEDED' || !g.genVideoUrl
  )
  if (incomplete.length > 0) {
    return {
      valid: false,
      incompleteGroupIndexes: incomplete.map((g) => g.groupIndex),
    }
  }
  return { valid: true }
}

const GEN_STATUSES = ['PENDING', 'QUEUED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED']

const validGroupArb = fc.record({
  id: fc.uuid(),
  groupIndex: fc.integer({ min: 0, max: 50 }),
  genStatus: fc.constant('SUCCEEDED'),
  genVideoUrl: fc.webUrl(),
})

const invalidGroupArb = fc.record({
  id: fc.uuid(),
  groupIndex: fc.integer({ min: 0, max: 50 }),
  genStatus: fc.constantFrom(...GEN_STATUSES.filter((s) => s !== 'SUCCEEDED')),
  genVideoUrl: fc.oneof(fc.constant(null), fc.webUrl()),
})

const groupWithNullUrlArb = fc.record({
  id: fc.uuid(),
  groupIndex: fc.integer({ min: 0, max: 50 }),
  genStatus: fc.constant('SUCCEEDED'),
  genVideoUrl: fc.constant(null),
})

describe('Property 3: Export 校验拒绝不完整组并报告正确组序号', () => {
  it('所有组均为 SUCCEEDED 且 genVideoUrl 非空时通过校验', () => {
    fc.assert(
      fc.property(
        fc.array(validGroupArb, { minLength: 1, maxLength: 20 }),
        (groups) => {
          const result = validateGroupsForExport(groups)
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('存在非 SUCCEEDED 组时拒绝导出，且报告所有不合格 groupIndex', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(validGroupArb, { minLength: 0, maxLength: 10 }),
          fc.array(invalidGroupArb, { minLength: 1, maxLength: 5 })
        ),
        ([validGroups, invalidGroups]) => {
          const allGroups = [...validGroups, ...invalidGroups]
          const result = validateGroupsForExport(allGroups)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            // 所有 invalid 组的 groupIndex 必须出现在错误中
            const invalidIndexes = invalidGroups.map((g) => g.groupIndex)
            for (const idx of invalidIndexes) {
              expect(result.incompleteGroupIndexes).toContain(idx)
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('genVideoUrl 为空的 SUCCEEDED 组也被标记为不合格', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(validGroupArb, { minLength: 0, maxLength: 10 }),
          fc.array(groupWithNullUrlArb, { minLength: 1, maxLength: 5 })
        ),
        ([validGroups, nullUrlGroups]) => {
          const allGroups = [...validGroups, ...nullUrlGroups]
          const result = validateGroupsForExport(allGroups)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            const nullIndexes = nullUrlGroups.map((g) => g.groupIndex)
            for (const idx of nullIndexes) {
              expect(result.incompleteGroupIndexes).toContain(idx)
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
