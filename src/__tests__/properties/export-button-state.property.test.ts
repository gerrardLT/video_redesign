import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 1: 导出按钮可用状态正确反映分镜组完成情况
 *
 * For any 非空的 ShotGroup 数组，"合并导出"按钮应当在且仅在所有组的 genStatus 均为 'SUCCEEDED' 时可用；
 * 若数组为空或任一组状态非 SUCCEEDED，按钮应禁用。
 *
 * Validates: Requirements 2.1, 2.2, 9.1, 9.3
 */

// 导出按钮状态逻辑（从 EditPage 中提取的纯函数）
function computeExportButtonEnabled(groups: { genStatus: string }[]): boolean {
  return groups.length > 0 && groups.every((g) => g.genStatus === 'SUCCEEDED')
}

// genStatus 枚举值
const GEN_STATUSES = ['PENDING', 'QUEUED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED']

const genStatusArb = fc.constantFrom(...GEN_STATUSES)

const shotGroupArb = fc.record({
  genStatus: genStatusArb,
})

describe('Property 1: 导出按钮可用状态正确反映分镜组完成情况', () => {
  it('空数组时按钮始终禁用', () => {
    expect(computeExportButtonEnabled([])).toBe(false)
  })

  it('所有组均为 SUCCEEDED 时按钮启用', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant({ genStatus: 'SUCCEEDED' }), { minLength: 1, maxLength: 20 }),
        (groups) => {
          expect(computeExportButtonEnabled(groups)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('存在任何非 SUCCEEDED 状态的组时按钮禁用', () => {
    fc.assert(
      fc.property(
        fc.array(shotGroupArb, { minLength: 1, maxLength: 20 }).filter(
          (groups) => groups.some((g) => g.genStatus !== 'SUCCEEDED')
        ),
        (groups) => {
          expect(computeExportButtonEnabled(groups)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('按钮可用 ⟺ 所有组均为 SUCCEEDED（双向等价）', () => {
    fc.assert(
      fc.property(
        fc.array(shotGroupArb, { minLength: 0, maxLength: 20 }),
        (groups) => {
          const enabled = computeExportButtonEnabled(groups)
          const allSucceeded = groups.length > 0 && groups.every((g) => g.genStatus === 'SUCCEEDED')
          expect(enabled).toBe(allSucceeded)
        }
      ),
      { numRuns: 100 }
    )
  })
})
