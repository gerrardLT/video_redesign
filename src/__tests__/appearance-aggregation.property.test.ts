/**
 * Feature: ai-character-appearance-detection
 * Property 2: 组级外观聚合取众数
 *
 * **Validates: Requirements 2.3**
 *
 * 验证 aggregateGroupAppearances 对于任意一组 Shots 中同一角色的外观描述集合，
 * 对每个维度应返回出现频率最高的非空描述；若所有值均为空字符串，则该维度结果为空字符串。
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { aggregateGroupAppearances } from '@/lib/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

/** 外观描述涉及的四个维度 */
const DIMENSIONS: Array<keyof AppearanceDescriptor> = ['hair', 'clothing', 'accessories', 'makeup']

/**
 * 手动计算某维度的预期众数：
 * - 忽略空字符串
 * - 取出现频率最高的非空描述
 * - 平局时取首次出现的描述
 * - 所有值均为空字符串时返回空字符串
 */
function expectedMode(values: string[]): string {
  const countMap = new Map<string, { count: number; firstIndex: number }>()

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val === '') continue

    if (countMap.has(val)) {
      countMap.get(val)!.count++
    } else {
      countMap.set(val, { count: 1, firstIndex: i })
    }
  }

  if (countMap.size === 0) return ''

  let bestValue = ''
  let bestCount = 0
  let bestFirstIndex = Infinity

  for (const [val, { count, firstIndex }] of countMap) {
    if (count > bestCount || (count === bestCount && firstIndex < bestFirstIndex)) {
      bestValue = val
      bestCount = count
      bestFirstIndex = firstIndex
    }
  }

  return bestValue
}

/**
 * 生成器：生成非空的外观描述文本（中文为主，模拟实际使用场景）
 */
const nonEmptyDescArb = fc.oneof(
  fc.constantFrom(
    '黑色短发', '金色长发', '棕色卷发', '红色马尾', '银色寸头',
    '白色衬衫', '蓝色外套', '红色连衣裙', '黑色西装', '灰色卫衣',
    '金色耳环', '珍珠项链', '黑框眼镜', '银色手表', '无',
    '淡妆', '浓妆', '红唇', '烟熏妆', '素颜'
  ),
  fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0)
)

/**
 * 生成器：生成外观描述值（含空字符串变体，模拟某些维度无法识别的场景）
 */
const descValueArb = fc.oneof(
  { weight: 3, arbitrary: nonEmptyDescArb },
  { weight: 1, arbitrary: fc.constant('') }
)

/**
 * 生成器：生成单个 AppearanceDescriptor
 */
const appearanceArb: fc.Arbitrary<AppearanceDescriptor> = fc.record({
  hair: descValueArb,
  clothing: descValueArb,
  accessories: descValueArb,
  makeup: descValueArb,
})

/**
 * 生成器：生成角色名（从固定集合中选取，模拟实际分镜中角色名有限的场景）
 */
const characterNameArb = fc.constantFrom('主角', '女主', '配角A', '配角B', '路人')

/**
 * 生成器：生成单个 Shot 中的角色外观列表（1-3 个角色）
 */
const shotCharactersArb = fc.array(
  fc.record({
    name: characterNameArb,
    appearance: appearanceArb,
  }),
  { minLength: 1, maxLength: 3 }
).map(chars => {
  // 去重：同一个 Shot 中同一角色只保留首次出现
  const seen = new Set<string>()
  return chars.filter(c => {
    if (seen.has(c.name)) return false
    seen.add(c.name)
    return true
  })
})

/**
 * 生成器：生成一组 Shots 的外观数据（1-5 个 Shot）
 */
const shotAppearancesArb = fc.array(shotCharactersArb, { minLength: 1, maxLength: 5 })

describe('Property 2: 组级外观聚合取众数', () => {
  it('对每个角色的每个维度返回出现频率最高的非空描述', () => {
    fc.assert(
      fc.property(shotAppearancesArb, (shotAppearances) => {
        const result = aggregateGroupAppearances(shotAppearances)

        // 手动计算期望结果：按角色收集每个维度的值
        const characterDimValues = new Map<string, Map<keyof AppearanceDescriptor, string[]>>()

        for (const shotChars of shotAppearances) {
          for (const { name, appearance } of shotChars) {
            if (!characterDimValues.has(name)) {
              const dimMap = new Map<keyof AppearanceDescriptor, string[]>()
              for (const dim of DIMENSIONS) {
                dimMap.set(dim, [])
              }
              characterDimValues.set(name, dimMap)
            }

            const dimMap = characterDimValues.get(name)!
            for (const dim of DIMENSIONS) {
              dimMap.get(dim)!.push(appearance[dim])
            }
          }
        }

        // 验证每个角色的每个维度
        for (const [name, dimMap] of characterDimValues) {
          const aggregated = result.get(name)
          expect(aggregated).toBeDefined()

          for (const dim of DIMENSIONS) {
            const values = dimMap.get(dim)!
            const expected = expectedMode(values)
            expect(aggregated![dim]).toBe(expected)
          }
        }

        // 验证结果中不包含输入中不存在的角色
        expect(result.size).toBe(characterDimValues.size)
      }),
      { numRuns: 100 }
    )
  })

  it('所有值均为空字符串时该维度结果为空字符串', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        characterNameArb,
        (shotCount, charName) => {
          // 构造所有维度均为空的 Shots
          const shotAppearances = Array.from({ length: shotCount }, () => [
            {
              name: charName,
              appearance: { hair: '', clothing: '', accessories: '', makeup: '' } as AppearanceDescriptor,
            },
          ])

          const result = aggregateGroupAppearances(shotAppearances)
          const aggregated = result.get(charName)!

          for (const dim of DIMENSIONS) {
            expect(aggregated[dim]).toBe('')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('空字符串不参与众数统计（非空描述即使只出现 1 次也应胜出）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),  // 空字符串数量
        nonEmptyDescArb,                  // 唯一的非空描述
        characterNameArb,
        (emptyCount, nonEmptyDesc, charName) => {
          // 构造：多个空字符串 + 1 个非空描述
          const shotAppearances: Array<Array<{ name: string; appearance: AppearanceDescriptor }>> = []

          // emptyCount 个空值 Shot
          for (let i = 0; i < emptyCount; i++) {
            shotAppearances.push([{
              name: charName,
              appearance: { hair: '', clothing: '', accessories: '', makeup: '' },
            }])
          }

          // 1 个有 hair 值的 Shot
          shotAppearances.push([{
            name: charName,
            appearance: { hair: nonEmptyDesc, clothing: '', accessories: '', makeup: '' },
          }])

          const result = aggregateGroupAppearances(shotAppearances)
          const aggregated = result.get(charName)!

          // hair 维度应返回唯一的非空描述
          expect(aggregated.hair).toBe(nonEmptyDesc)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('众数为出现次数最多的非空值（而非出现次数最多的值含空字符串）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),  // 众数值重复次数
        nonEmptyDescArb,
        nonEmptyDescArb.filter(s => s.length > 0),
        characterNameArb,
        (modeCount, modeValue, otherValue, charName) => {
          // 确保两个值不同
          if (modeValue === otherValue) return

          // 构造数据：modeValue 出现 modeCount 次，otherValue 出现 1 次
          const shotAppearances: Array<Array<{ name: string; appearance: AppearanceDescriptor }>> = []

          for (let i = 0; i < modeCount; i++) {
            shotAppearances.push([{
              name: charName,
              appearance: { hair: modeValue, clothing: '', accessories: '', makeup: '' },
            }])
          }

          shotAppearances.push([{
            name: charName,
            appearance: { hair: otherValue, clothing: '', accessories: '', makeup: '' },
          }])

          const result = aggregateGroupAppearances(shotAppearances)

          // hair 维度应返回 modeValue（出现次数更多）
          expect(result.get(charName)!.hair).toBe(modeValue)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('平局时取首次出现的描述', () => {
    fc.assert(
      fc.property(
        nonEmptyDescArb,
        nonEmptyDescArb.filter(s => s.length > 0),
        characterNameArb,
        (firstValue, secondValue, charName) => {
          // 确保两个值不同
          if (firstValue === secondValue) return

          // 构造数据：两个值各出现 1 次，firstValue 先出现
          const shotAppearances = [
            [{ name: charName, appearance: { hair: firstValue, clothing: '', accessories: '', makeup: '' } as AppearanceDescriptor }],
            [{ name: charName, appearance: { hair: secondValue, clothing: '', accessories: '', makeup: '' } as AppearanceDescriptor }],
          ]

          const result = aggregateGroupAppearances(shotAppearances)

          // 平局取首次出现的 firstValue
          expect(result.get(charName)!.hair).toBe(firstValue)
        }
      ),
      { numRuns: 100 }
    )
  })
})
