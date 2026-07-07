import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { resolveReferences } from '@/lib/video/prompt-parser'

/**
 * Feature: video-reshaping-pipeline-fix
 * 属性测试: Property 1
 *
 * **Validates: Requirements 2.2**
 */
describe('Video Pipeline Property Tests', () => {
  /**
   * Property 1: Prompt 清洁性
   * ∀ prompt 经 resolveReferences 处理后: cleanPrompt 中不包含 [图\d+] 模式的文本标记
   *
   * **Validates: Requirements 2.2**
   */
  describe('Property 1: cleanPrompt 不含 [图N] 标记', () => {
    it('任意 prompt + 任意 shotAssets → cleanPrompt 不含 [图N]', () => {
      // 生成可能含有 [图N] 标记的 prompt
      const promptArb = fc.oneof(
        fc.string({ minLength: 0, maxLength: 200 }),
        // 特意生成含 [图N] 标记的 prompt
        fc.array(
          fc.oneof(
            fc.string({ minLength: 0, maxLength: 20 }),
            fc.integer({ min: 1, max: 99 }).map(n => `[图${n}]`),
          ),
          { minLength: 1, maxLength: 10 }
        ).map(parts => parts.join(''))
      )

      // 生成 shotAssets 数组
      const shotAssetsArb = fc.array(
        fc.record({
          displayNum: fc.nat({ max: 100 }),
          asset: fc.record({
            url: fc.oneof(
              fc.webUrl(),
              fc.constant('https://oss.example.com/asset.jpg'),
            ),
          }),
        }),
        { minLength: 0, maxLength: 10 }
      )

      fc.assert(
        fc.property(promptArb, shotAssetsArb, (prompt, shotAssets) => {
          const { cleanPrompt } = resolveReferences(prompt, shotAssets)
          // 核心不变式：cleanPrompt 中不包含 [图N] 标记
          expect(cleanPrompt).not.toMatch(/\[图\d+\]/)
        }),
        { numRuns: 500 }
      )
    })

    it('包含大量 [图N] 标记的 prompt 全部被移除', () => {
      // 专门生成包含 [图N] 标记的 prompt
      const refsArb = fc.array(
        fc.integer({ min: 1, max: 99 }),
        { minLength: 1, maxLength: 20 }
      )
      const textArb = fc.string({ minLength: 0, maxLength: 50 })

      const shotAssetsArb = fc.array(
        fc.record({
          displayNum: fc.nat({ max: 100 }),
          asset: fc.record({
            url: fc.constant('https://oss.example.com/img.jpg'),
          }),
        }),
        { minLength: 0, maxLength: 20 }
      )

      fc.assert(
        fc.property(refsArb, textArb, shotAssetsArb, (refs, text, shotAssets) => {
          const prompt = refs.map(n => `[图${n}]`).join(' ') + ' ' + text
          const { cleanPrompt } = resolveReferences(prompt, shotAssets)
          expect(cleanPrompt).not.toMatch(/\[图\d+\]/)
        }),
        { numRuns: 300 }
      )
    })
  })
})
