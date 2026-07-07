/**
 * Feature: ai-character-appearance-detection
 * Property 5: 外观比对算法正确性
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 *
 * 验证 hasAppearanceChanged 和 hasGroupAppearanceChanged 的比对逻辑正确性：
 * - 对于任意两个 AppearanceDescriptor，hasAppearanceChanged 返回 true 当且仅当
 *   存在至少一个维度 D 使得 normalize(prev[D]) 和 normalize(next[D]) 均非空且不相等
 * - hasGroupAppearanceChanged 在任一共有角色变化时返回 true，无共有角色时返回 false
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  normalizeAppearanceText,
  hasAppearanceChanged,
  hasGroupAppearanceChanged,
} from '@/lib/video/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

/** 外观描述的四个维度 */
const DIMENSIONS: Array<keyof AppearanceDescriptor> = [
  'hair',
  'clothing',
  'accessories',
  'makeup',
]

/**
 * 生成外观维度文本的 arbitrary
 * 包含：空字符串、中文、英文、标点、大小写变体、纯空白/标点
 */
const dimensionTextArb = fc.oneof(
  // 空字符串
  fc.constant(''),
  // 纯空白/标点（规范化后为空）
  fc.constantFrom('  ', '，。', '  ，  ', '...', '!!!'),
  // 中文描述
  fc.constantFrom(
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
  ),
  // 带标点/空白的中文描述（规范化后应与无标点版本相同）
  fc.constantFrom(
    '黑色长发，马尾',
    '白色衬衫。',
    '  金色耳环  ',
    '淡妆、红唇',
    '红色连衣裙！',
  ),
  // 英文描述（测试大小写规范化）
  fc.constantFrom(
    'Black Hair',
    'black hair',
    'WHITE SHIRT',
    'white shirt',
    'Gold Earrings',
    'gold earrings',
    'Light Makeup',
    'light makeup',
  ),
  // 带标点/大小写混合的英文
  fc.constantFrom(
    'Black, Long Hair!',
    'black long hair',
    'WHITE, Shirt.',
    'white shirt',
  ),
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
 * 手动计算期望的 hasAppearanceChanged 结果（作为 oracle）
 * 逐维度比对，某维度任一侧规范化后为空则忽略，否则比较规范化后文本是否不同
 */
function expectedHasAppearanceChanged(
  prev: AppearanceDescriptor,
  next: AppearanceDescriptor
): boolean {
  for (const dim of DIMENSIONS) {
    const prevNormalized = normalizeAppearanceText(prev[dim])
    const nextNormalized = normalizeAppearanceText(next[dim])

    // 任一侧为空字符串时忽略该维度
    if (prevNormalized === '' || nextNormalized === '') {
      continue
    }

    // 规范化后不相等即存在差异
    if (prevNormalized !== nextNormalized) {
      return true
    }
  }

  return false
}

/**
 * 手动计算期望的 hasGroupAppearanceChanged 结果
 */
function expectedHasGroupAppearanceChanged(
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

  // 无共有角色返回 false
  if (commonCharacters.length === 0) {
    return false
  }

  // 任一共有角色外观变化即返回 true
  for (const name of commonCharacters) {
    if (expectedHasAppearanceChanged(prevAppearances.get(name)!, nextAppearances.get(name)!)) {
      return true
    }
  }

  return false
}

describe('Feature: ai-character-appearance-detection, Property 5: 外观比对算法正确性', () => {
  /**
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4
   *
   * 对于任意两个 AppearanceDescriptor，hasAppearanceChanged 返回值
   * 应与手动逐维度计算结果一致
   */
  it('hasAppearanceChanged 返回值与逐维度手动计算结果一致', () => {
    fc.assert(
      fc.property(
        appearanceDescriptorArb,
        appearanceDescriptorArb,
        (prev, next) => {
          const actual = hasAppearanceChanged(prev, next)
          const expected = expectedHasAppearanceChanged(prev, next)
          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 5.1, 5.2
   *
   * 自反性：任意 AppearanceDescriptor 与自身比对应返回 false
   */
  it('相同 AppearanceDescriptor 与自身比对始终返回 false', () => {
    fc.assert(
      fc.property(
        appearanceDescriptorArb,
        (desc) => {
          expect(hasAppearanceChanged(desc, desc)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 5.4
   *
   * 规范化不影响实质内容相同的判定：
   * 仅标点/空白/大小写差异不应导致 hasAppearanceChanged 返回 true
   */
  it('仅标点、空白、大小写差异不应判定为外观变化', () => {
    // 使用固定的非空文本对，添加随机标点和大小写变体
    const baseTexts = ['黑色长发', 'white shirt', '金色耳环', '淡妆红唇']
    const punctuationVariants = ['', '，', '。', '!', '  ', '、', '...']

    const variantArb = fc.tuple(
      fc.constantFrom(...baseTexts),
      fc.constantFrom(...punctuationVariants),
      fc.constantFrom(...punctuationVariants),
    ).map(([text, prefix, suffix]) => prefix + text + suffix)

    fc.assert(
      fc.property(
        fc.tuple(variantArb, variantArb, variantArb, variantArb),
        fc.tuple(variantArb, variantArb, variantArb, variantArb),
        (prevDims, nextDims) => {
          // 使用相同的 base text，只是加了不同标点/空白
          const prev: AppearanceDescriptor = {
            hair: prevDims[0],
            clothing: prevDims[1],
            accessories: prevDims[2],
            makeup: prevDims[3],
          }
          const next: AppearanceDescriptor = {
            hair: nextDims[0],
            clothing: nextDims[1],
            accessories: nextDims[2],
            makeup: nextDims[3],
          }
          // 用 oracle 验证实现正确性
          const actual = hasAppearanceChanged(prev, next)
          const expected = expectedHasAppearanceChanged(prev, next)
          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 5.3
   *
   * 空字符串维度忽略：当某维度任一侧为空时，该维度不影响比对结果
   */
  it('空字符串维度不影响比对结果', () => {
    // 生成一个确保有非空差异的 descriptor 对，然后将差异维度的某一侧设为空
    const nonEmptyTextArb = fc.constantFrom(
      '黑色长发', '金色短发', '白色衬衫', '红色连衣裙',
      '珍珠项链', '金色耳环', '淡妆', '浓妆红唇',
    )
    const dimIndexArb = fc.integer({ min: 0, max: 3 })

    fc.assert(
      fc.property(
        appearanceDescriptorArb,
        nonEmptyTextArb,
        dimIndexArb,
        (base, differentText, dimIndex) => {
          const dim = DIMENSIONS[dimIndex]

          // 创建一个 next，将某维度设为不同值
          const next: AppearanceDescriptor = { ...base, [dim]: differentText }

          // 将 prev 的该维度设为空字符串
          const prevWithEmpty: AppearanceDescriptor = { ...base, [dim]: '' }

          // 该维度应被忽略，结果应等同于没有这个维度参与比对
          const actual = hasAppearanceChanged(prevWithEmpty, next)
          const expected = expectedHasAppearanceChanged(prevWithEmpty, next)
          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4
   *
   * hasGroupAppearanceChanged 的正确性：
   * - 任一共有角色外观变化返回 true
   * - 无共有角色返回 false
   * - 所有共有角色外观一致返回 false
   */
  it('hasGroupAppearanceChanged 返回值与手动计算结果一致', () => {
    // 生成角色名集合
    const characterNameArb = fc.constantFrom(
      '主角', '女主', '配角A', '配角B', '路人甲',
    )

    // 生成一个 Map<string, AppearanceDescriptor> 的 arbitrary
    const appearanceMapArb = fc.array(
      fc.tuple(characterNameArb, appearanceDescriptorArb),
      { minLength: 0, maxLength: 4 }
    ).map((entries) => {
      const map = new Map<string, AppearanceDescriptor>()
      for (const [name, desc] of entries) {
        map.set(name, desc) // 后出现覆盖前出现
      }
      return map
    })

    fc.assert(
      fc.property(
        appearanceMapArb,
        appearanceMapArb,
        (prevMap, nextMap) => {
          const actual = hasGroupAppearanceChanged(prevMap, nextMap)
          const expected = expectedHasGroupAppearanceChanged(prevMap, nextMap)
          expect(actual).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4
   *
   * hasGroupAppearanceChanged 无共有角色时始终返回 false
   */
  it('hasGroupAppearanceChanged 无共有角色时返回 false', () => {
    fc.assert(
      fc.property(
        appearanceDescriptorArb,
        appearanceDescriptorArb,
        (desc1, desc2) => {
          // 使用完全不同的角色名
          const prev = new Map<string, AppearanceDescriptor>([['角色A', desc1]])
          const next = new Map<string, AppearanceDescriptor>([['角色B', desc2]])
          expect(hasGroupAppearanceChanged(prev, next)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
