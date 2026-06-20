/**
 * 属性测试：外观文案长度约束
 * Property 4: 对于任意 AppearanceDescriptor 和角色名，
 * formatAppearancePrompt 生成的文案字符串长度应 ≤ 80 字符（默认 maxLength）
 *
 * Feature: ai-character-appearance-detection, Property 4: 外观文案长度约束
 * Validates: Requirements 3.4
 */

import { describe, it } from 'vitest'
import fc from 'fast-check'
import { formatAppearancePrompt } from '@/lib/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

/**
 * 生成随机中文字符串（1-maxLen 字符）
 * 使用常见汉字范围 \u4e00-\u9fff
 */
function chineseString(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0x4e00, max: 0x9fff }), { minLength: minLen, maxLength: maxLen })
    .map((codes) => String.fromCharCode(...codes))
}

/**
 * 生成随机英文字符串（1-maxLen 字符）
 */
function englishString(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc.string({ minLength: minLen, maxLength: maxLen, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) })
}

/**
 * 生成随机角色名（中文或英文，1-50字符）
 */
const characterNameArb: fc.Arbitrary<string> = fc.oneof(
  chineseString(1, 50),
  englishString(1, 50)
)

/**
 * 生成随机外观维度描述（中文或英文或空字符串，0-100字符）
 */
function dimensionDescArb(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(''),
    chineseString(1, 100),
    englishString(1, 100)
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

describe('Property 4: 外观文案长度约束', () => {
  it('formatAppearancePrompt 默认 maxLength=80 时返回值长度 ≤ 80 或为空字符串', () => {
    fc.assert(
      fc.property(characterNameArb, appearanceArb, (name, appearance) => {
        const result = formatAppearancePrompt(name, appearance)
        // 返回值要么是空字符串（所有维度为空），要么长度 ≤ 80
        return result === '' || result.length <= 80
      }),
      { numRuns: 100 }
    )
  })

  it('formatAppearancePrompt 自定义 maxLength 时返回值长度 ≤ maxLength 或为空字符串', () => {
    const maxLengthArb = fc.integer({ min: 10, max: 200 })

    fc.assert(
      fc.property(characterNameArb, appearanceArb, maxLengthArb, (name, appearance, maxLength) => {
        const result = formatAppearancePrompt(name, appearance, maxLength)
        // 返回值要么是空字符串，要么长度 ≤ maxLength
        return result === '' || result.length <= maxLength
      }),
      { numRuns: 100 }
    )
  })

  it('formatAppearancePrompt 返回的非空字符串以正确前缀开头', () => {
    fc.assert(
      fc.property(characterNameArb, appearanceArb, (name, appearance) => {
        const result = formatAppearancePrompt(name, appearance)
        if (result === '') return true
        // 非空结果应以「本镜头中{角色名}的造型：」开头或因截断而包含前缀的部分
        const expectedPrefix = `本镜头中${name}的造型：`
        // 如果文案没被从前缀处截断，应该以完整前缀开头
        // 如果前缀本身超长，截断后以省略号结尾
        return result.startsWith(expectedPrefix) || result.endsWith('…')
      }),
      { numRuns: 100 }
    )
  })
})
