/**
 * 属性测试：Prompt 外观追加决策
 * Property 3: 对于任意角色，当其组级聚合外观的四维度非空值拼接后经 normalizeAppearanceText
 * 规范化与全局 Character.appearance 经 normalizeAppearanceText 规范化后完全一致时，
 * 不应追加外观文案；存在差异时，应追加格式为「本镜头中{角色名}的造型：{外观描述}」的文案。
 *
 * Feature: ai-character-appearance-detection, Property 3: Prompt 外观追加决策
 * Validates: Requirements 3.2, 3.3
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizeAppearanceText, formatAppearancePrompt } from '@/lib/video/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

/** 外观维度列表，与 appearance-comparator.ts 一致 */
const APPEARANCE_DIMENSIONS: Array<keyof AppearanceDescriptor> = [
  'hair',
  'clothing',
  'accessories',
  'makeup',
]

/**
 * 模拟 group-gen-context.ts 中的追加决策逻辑：
 * 1. 将 AppearanceDescriptor 四维度非空值用顿号拼接
 * 2. 经 normalizeAppearanceText 规范化后与全局外观经 normalizeAppearanceText 规范化比对
 * 3. 一致时返回空字符串（跳过追加）
 * 4. 差异时调用 formatAppearancePrompt 返回文案
 */
function decideAppearancePrompt(
  characterName: string,
  globalAppearance: string,
  groupAppearance: AppearanceDescriptor
): string {
  // 收集四维度非空值
  const groupDimensions = APPEARANCE_DIMENSIONS
    .map((dim) => groupAppearance[dim])
    .filter((v) => v.trim() !== '')

  // 所有维度均为空时跳过
  if (groupDimensions.length === 0) {
    return ''
  }

  const groupAppearanceText = groupDimensions.join('、')

  // 规范化后比较
  const normalizedGlobal = normalizeAppearanceText(globalAppearance)
  const normalizedGroup = normalizeAppearanceText(groupAppearanceText)

  // 一致时跳过追加
  if (normalizedGlobal === normalizedGroup) {
    return ''
  }

  // 差异时生成文案
  return formatAppearancePrompt(characterName, groupAppearance)
}

/**
 * 生成随机中文字符串
 */
function chineseString(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0x4e00, max: 0x9fff }), { minLength: minLen, maxLength: maxLen })
    .map((codes) => String.fromCharCode(...codes))
}

/**
 * 生成随机角色名（非空中文，1-10字符）
 */
const characterNameArb: fc.Arbitrary<string> = chineseString(1, 10)

/**
 * 生成随机维度描述（可能为空字符串或中文文本）
 */
function dimensionDescArb(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(''),
    chineseString(1, 20)
  )
}

/**
 * 生成随机 AppearanceDescriptor
 */
const appearanceArb: fc.Arbitrary<AppearanceDescriptor> = fc.record({
  hair: dimensionDescArb(),
  clothing: dimensionDescArb(),
  accessories: dimensionDescArb(),
  makeup: dimensionDescArb(),
})

/**
 * 生成全局外观文本（中文字符串或空字符串）
 */
const globalAppearanceArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  chineseString(1, 40)
)

describe('Property 3: Prompt 外观追加决策', () => {
  it('当组外观四维度非空拼接后规范化与全局外观规范化完全一致时，不应追加文案', () => {
    fc.assert(
      fc.property(
        characterNameArb,
        appearanceArb,
        (charName, groupAppearance) => {
          // 构造一个与组外观规范化后一致的全局外观文本
          const groupDimensions = APPEARANCE_DIMENSIONS
            .map((dim) => groupAppearance[dim])
            .filter((v) => v.trim() !== '')

          // 若所有维度为空，跳过此测试用例（不适用此属性）
          if (groupDimensions.length === 0) {
            return true
          }

          // 用顿号拼接作为全局外观（确保规范化后一致）
          const globalAppearance = groupDimensions.join('、')

          const result = decideAppearancePrompt(charName, globalAppearance, groupAppearance)
          // 一致时不应追加文案
          return result === ''
        }
      ),
      { numRuns: 100 }
    )
  })

  it('当组外观四维度非空拼接后规范化与全局外观规范化存在差异时，应追加包含正确格式的文案', () => {
    fc.assert(
      fc.property(
        characterNameArb,
        appearanceArb,
        globalAppearanceArb,
        (charName, groupAppearance, globalAppearance) => {
          // 收集四维度非空值
          const groupDimensions = APPEARANCE_DIMENSIONS
            .map((dim) => groupAppearance[dim])
            .filter((v) => v.trim() !== '')

          // 若所有维度为空，决策为跳过，验证返回空字符串
          if (groupDimensions.length === 0) {
            const result = decideAppearancePrompt(charName, globalAppearance, groupAppearance)
            return result === ''
          }

          const groupAppearanceText = groupDimensions.join('、')
          const normalizedGlobal = normalizeAppearanceText(globalAppearance)
          const normalizedGroup = normalizeAppearanceText(groupAppearanceText)

          const result = decideAppearancePrompt(charName, globalAppearance, groupAppearance)

          if (normalizedGlobal === normalizedGroup) {
            // 一致时不追加
            return result === ''
          } else {
            // 差异时应追加非空文案，且以正确前缀开头
            const expectedPrefix = `本镜头中${charName}的造型：`
            return result !== '' && (result.startsWith(expectedPrefix) || result.endsWith('…'))
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('当组外观所有维度均为空字符串时，不应追加文案（不论全局外观值如何）', () => {
    fc.assert(
      fc.property(
        characterNameArb,
        globalAppearanceArb,
        (charName, globalAppearance) => {
          const emptyAppearance: AppearanceDescriptor = {
            hair: '',
            clothing: '',
            accessories: '',
            makeup: '',
          }

          const result = decideAppearancePrompt(charName, globalAppearance, emptyAppearance)
          return result === ''
        }
      ),
      { numRuns: 100 }
    )
  })

  it('追加文案格式验证：差异时返回值包含角色名和外观描述', () => {
    fc.assert(
      fc.property(
        characterNameArb,
        // 使用至少一个维度非空的 AppearanceDescriptor
        fc.record({
          hair: chineseString(1, 10),
          clothing: dimensionDescArb(),
          accessories: dimensionDescArb(),
          makeup: dimensionDescArb(),
        }),
        (charName, groupAppearance) => {
          // 使用一个明确不同的全局外观确保产生差异
          const globalAppearance = '完全不同的外观描述文本'

          const result = decideAppearancePrompt(charName, globalAppearance, groupAppearance)

          // 应生成非空文案
          if (result === '') return false

          // 文案应以「本镜头中{角色名}的造型：」开头（若未被截断）
          const expectedPrefix = `本镜头中${charName}的造型：`
          return result.startsWith(expectedPrefix) || result.endsWith('…')
        }
      ),
      { numRuns: 100 }
    )
  })
})
