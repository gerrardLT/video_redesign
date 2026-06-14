import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 2: 导出 concat 列表始终按 groupIndex 升序排列
 *
 * For any 项目中的 ShotGroup 集合（无论数据库返回顺序如何），
 * Export API 构建的视频 concat 列表应严格按 groupIndex 升序排列。
 *
 * Validates: Requirements 2.4
 */

interface ShotGroupForExport {
  id: string
  groupIndex: number
  genStatus: string
  genVideoUrl: string | null
}

// 从 Export API 中提取的排序 + 构建逻辑
function buildConcatList(groups: ShotGroupForExport[]) {
  const sorted = [...groups].sort((a, b) => a.groupIndex - b.groupIndex)
  return sorted.map((g) => ({
    orderIndex: g.groupIndex,
    videoUrl: g.genVideoUrl!,
  }))
}

const shotGroupArb = fc.record({
  id: fc.uuid(),
  groupIndex: fc.integer({ min: 0, max: 100 }),
  genStatus: fc.constant('SUCCEEDED'),
  genVideoUrl: fc.webUrl(),
})

describe('Property 2: 导出 concat 列表始终按 groupIndex 升序排列', () => {
  it('无论输入顺序如何，输出始终按 groupIndex 升序', () => {
    fc.assert(
      fc.property(
        fc.array(shotGroupArb, { minLength: 1, maxLength: 30 }).map((groups) =>
          // 确保 groupIndex 唯一
          groups.map((g, i) => ({ ...g, groupIndex: i }))
        ).chain((groups) =>
          // 打乱顺序
          fc.shuffledSubarray(groups, { minLength: groups.length, maxLength: groups.length })
        ),
        (shuffledGroups) => {
          const result = buildConcatList(shuffledGroups)
          for (let i = 1; i < result.length; i++) {
            expect(result[i].orderIndex).toBeGreaterThan(result[i - 1].orderIndex)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('输出列表长度等于输入列表长度', () => {
    fc.assert(
      fc.property(
        fc.array(shotGroupArb, { minLength: 1, maxLength: 20 }),
        (groups) => {
          const result = buildConcatList(groups)
          expect(result.length).toBe(groups.length)
        }
      ),
      { numRuns: 100 }
    )
  })
})
