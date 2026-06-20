/**
 * Feature: ai-character-appearance-detection
 * Property 6: 基于外观变化的承接跳过决策
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 *
 * 验证基于外观变化的承接跳过决策逻辑：
 * - 对于任意相邻两个分镜组，当它们满足同场景判定条件时：
 *   - 若任一共有角色的外观描述存在变化，则尾帧承接应被跳过
 *   - 若所有共有角色外观一致或无共有角色，承接决策不受外观比对影响
 *
 * 由于 applySameSceneContinuation 依赖 Prisma DB，这里测试 hasGroupAppearanceChanged
 * 的行为作为承接决策的 proxy：
 * - hasGroupAppearanceChanged 返回 true → 承接应跳过（applied=false）
 * - hasGroupAppearanceChanged 返回 false → 承接决策不受外观影响
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  hasGroupAppearanceChanged,
  aggregateGroupAppearances,
  normalizeAppearanceText,
  hasAppearanceChanged,
} from '@/lib/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

/** 外观描述的四个维度 */
const DIMENSIONS: Array<keyof AppearanceDescriptor> = [
  'hair',
  'clothing',
  'accessories',
  'makeup',
]

/**
 * 生成非空的外观维度文本 arbitrary（保证规范化后非空）
 */
const nonEmptyDimensionTextArb = fc.constantFrom(
  '黑色长发',
  '金色短发',
  '白色衬衫',
  '红色连衣裙',
  '珍珠项链',
  '金色耳环',
  '淡妆',
  '浓妆红唇',
  '棕色卷发马尾',
  '蓝色西装外套',
  '黑色高跟鞋',
  '银色手表',
  'black hair',
  'white shirt',
  'gold earrings',
  'light makeup',
)

/**
 * 生成外观维度文本的 arbitrary（含空字符串可能性）
 */
const dimensionTextArb = fc.oneof(
  fc.constant(''),
  nonEmptyDimensionTextArb,
)

/**
 * 生成 AppearanceDescriptor 的 arbitrary
 */
const appearanceDescriptorArb: fc.Arbitrary<AppearanceDescriptor> = fc.record({
  hair: dimensionTextArb,
  clothing: dimensionTextArb,
  accessories: dimensionTextArb,
  makeup: dimensionTextArb,
})

/**
 * 生成保证至少一个维度非空的 AppearanceDescriptor
 */
const nonEmptyAppearanceArb: fc.Arbitrary<AppearanceDescriptor> = fc.record({
  hair: nonEmptyDimensionTextArb,
  clothing: dimensionTextArb,
  accessories: dimensionTextArb,
  makeup: dimensionTextArb,
})

/**
 * 角色名集合
 */
const characterNameArb = fc.constantFrom(
  '主角', '女主', '配角A', '配角B', '路人甲', '反派',
)

/**
 * 生成一个 Map<string, AppearanceDescriptor> 的 arbitrary
 */
const appearanceMapArb = fc.array(
  fc.tuple(characterNameArb, appearanceDescriptorArb),
  { minLength: 0, maxLength: 5 }
).map((entries) => {
  const map = new Map<string, AppearanceDescriptor>()
  for (const [name, desc] of entries) {
    map.set(name, desc)
  }
  return map
})

/**
 * 生成保证有共有角色且外观一致的两组 Map
 * 策略：使用相同的角色名和相同的外观描述
 */
const consistentPairArb = fc.tuple(
  fc.array(characterNameArb, { minLength: 1, maxLength: 4 }),
  fc.array(appearanceDescriptorArb, { minLength: 1, maxLength: 4 }),
).map(([names, descs]) => {
  const uniqueNames = [...new Set(names)]
  const prevMap = new Map<string, AppearanceDescriptor>()
  const nextMap = new Map<string, AppearanceDescriptor>()
  for (let i = 0; i < uniqueNames.length; i++) {
    const desc = descs[i % descs.length]
    prevMap.set(uniqueNames[i], desc)
    nextMap.set(uniqueNames[i], desc)
  }
  return { prevMap, nextMap }
})

/**
 * 生成保证有共有角色且外观存在差异的两组 Map
 * 策略：至少一个共有角色的某个非空维度不同
 */
const divergentPairArb = fc.tuple(
  characterNameArb,
  nonEmptyDimensionTextArb,
  nonEmptyDimensionTextArb,
  fc.integer({ min: 0, max: 3 }),
).filter(([_name, text1, text2, _dimIdx]) => {
  // 确保规范化后两个文本确实不同
  return normalizeAppearanceText(text1) !== normalizeAppearanceText(text2)
}).map(([name, text1, text2, dimIdx]) => {
  const dim = DIMENSIONS[dimIdx]
  const basePrev: AppearanceDescriptor = { hair: '', clothing: '', accessories: '', makeup: '' }
  const baseNext: AppearanceDescriptor = { hair: '', clothing: '', accessories: '', makeup: '' }
  basePrev[dim] = text1
  baseNext[dim] = text2

  const prevMap = new Map<string, AppearanceDescriptor>([[name, basePrev]])
  const nextMap = new Map<string, AppearanceDescriptor>([[name, baseNext]])
  return { prevMap, nextMap }
})

/**
 * 生成无共有角色的两组 Map
 * 策略：使用完全不同的角色名集合
 */
const noCommonCharPairArb = fc.tuple(
  appearanceDescriptorArb,
  appearanceDescriptorArb,
).map(([desc1, desc2]) => {
  // 使用保证不重叠的角色名
  const prevMap = new Map<string, AppearanceDescriptor>([['角色甲', desc1]])
  const nextMap = new Map<string, AppearanceDescriptor>([['角色乙', desc2]])
  return { prevMap, nextMap }
})

/**
 * 模拟承接决策逻辑：
 * - hasGroupAppearanceChanged 返回 true → 承接应被跳过（skipContinuation = true）
 * - hasGroupAppearanceChanged 返回 false → 承接不受外观影响（skipContinuation = false）
 */
function shouldSkipContinuationDueToAppearance(
  prevAppearances: Map<string, AppearanceDescriptor>,
  nextAppearances: Map<string, AppearanceDescriptor>
): boolean {
  return hasGroupAppearanceChanged(prevAppearances, nextAppearances)
}

/**
 * Oracle 函数：手动计算期望的承接跳过决策
 */
function expectedSkipDecision(
  prevAppearances: Map<string, AppearanceDescriptor>,
  nextAppearances: Map<string, AppearanceDescriptor>
): boolean {
  // 提取共有角色
  const commonCharacters: string[] = []
  for (const name of prevAppearances.keys()) {
    if (nextAppearances.has(name)) {
      commonCharacters.push(name)
    }
  }

  // 无共有角色时返回 false（不影响承接决策）
  if (commonCharacters.length === 0) {
    return false
  }

  // 任一共有角色外观变化即返回 true（应跳过承接）
  for (const name of commonCharacters) {
    const prev = prevAppearances.get(name)!
    const next = nextAppearances.get(name)!

    for (const dim of DIMENSIONS) {
      const prevNorm = normalizeAppearanceText(prev[dim])
      const nextNorm = normalizeAppearanceText(next[dim])
      if (prevNorm === '' || nextNorm === '') continue
      if (prevNorm !== nextNorm) return true
    }
  }

  return false
}

describe('Feature: ai-character-appearance-detection, Property 6: 基于外观变化的承接跳过决策', () => {
  /**
   * Validates: Requirements 4.2, 4.3, 4.4
   *
   * 核心属性：对于任意两组角色外观数据，承接跳过决策与手动计算结果一致
   */
  it('承接跳过决策与手动计算的期望结果一致', () => {
    fc.assert(
      fc.property(
        appearanceMapArb,
        appearanceMapArb,
        (prevMap, nextMap) => {
          const actual = shouldSkipContinuationDueToAppearance(prevMap, nextMap)
          const expected = expectedSkipDecision(prevMap, nextMap)
          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 4.2
   *
   * 有共有角色且外观存在差异时，承接应被跳过
   */
  it('有共有角色且外观差异时，承接应被跳过（applied=false）', () => {
    fc.assert(
      fc.property(
        divergentPairArb,
        ({ prevMap, nextMap }) => {
          const skipDecision = shouldSkipContinuationDueToAppearance(prevMap, nextMap)
          expect(skipDecision).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 4.3
   *
   * 有共有角色且外观一致时，承接不受外观比对影响
   */
  it('有共有角色且外观一致时，承接决策不受外观比对影响', () => {
    fc.assert(
      fc.property(
        consistentPairArb,
        ({ prevMap, nextMap }) => {
          const skipDecision = shouldSkipContinuationDueToAppearance(prevMap, nextMap)
          expect(skipDecision).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 4.4
   *
   * 无共有角色时，承接决策不受外观比对影响（返回 false）
   */
  it('无共有角色时，承接决策不受外观比对影响', () => {
    fc.assert(
      fc.property(
        noCommonCharPairArb,
        ({ prevMap, nextMap }) => {
          const skipDecision = shouldSkipContinuationDueToAppearance(prevMap, nextMap)
          expect(skipDecision).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 4.2, 4.3, 4.4
   *
   * 端到端验证：从 shotAppearances 聚合到承接决策的完整链路
   * 使用 aggregateGroupAppearances 聚合后再传入 hasGroupAppearanceChanged
   */
  it('从 shotAppearances 聚合到承接决策的完整链路正确', () => {
    // 生成 Shot 外观数据的 arbitrary
    const shotAppearancesArb = fc.array(
      fc.array(
        fc.tuple(characterNameArb, appearanceDescriptorArb).map(([name, appearance]) => ({
          name,
          appearance,
        })),
        { minLength: 1, maxLength: 3 }
      ),
      { minLength: 1, maxLength: 4 }
    )

    fc.assert(
      fc.property(
        shotAppearancesArb,
        shotAppearancesArb,
        (prevShotAppearances, nextShotAppearances) => {
          // 聚合两组的角色外观
          const prevMap = aggregateGroupAppearances(prevShotAppearances)
          const nextMap = aggregateGroupAppearances(nextShotAppearances)

          // 计算承接跳过决策
          const actual = shouldSkipContinuationDueToAppearance(prevMap, nextMap)
          const expected = expectedSkipDecision(prevMap, nextMap)

          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })
})
