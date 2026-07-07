import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseAssetReferences, validateReferences } from '@/lib/video/prompt-parser'

/**
 * Feature: video-reshaping-mvp
 * Property 3: Prompt 素材引用校验
 *
 * **Validates: Requirements 9.3, 9.4, 9.7**
 *
 * 对任意 prompt 文本和素材总数 N，解析出的 [图X] 引用应满足：
 * - 所有 X ∈ [1, N] 为合法引用
 * - X > N 或 X < 1 为非法引用
 * - 总引用数不超过 9 张时校验通过
 * - 当存在非法引用或超过 9 张时，校验函数应拒绝并返回具体错误信息
 */
describe('Prompt 素材引用校验 Property', () => {
  it('parseAssetReferences 应正确解析所有 [图N] 引用并去重', () => {
    fc.assert(
      fc.property(
        // 生成 1-15 个引用编号（可重复）
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 0, maxLength: 15 }),
        // 额外的非引用文本
        fc.string({ minLength: 0, maxLength: 100 }),
        (nums, extraText) => {
          // 构造含有 [图N] 引用的 prompt
          const refs = nums.map((n) => `[图${n}]`).join('')
          const prompt = extraText + refs

          const parsed = parseAssetReferences(prompt)

          // 解析结果应为去重后的集合
          const expectedSet = [...new Set(nums)]
          expect(parsed.length).toBe(expectedSet.length)

          // 每个解析出的引用都应在原始 nums 中
          for (const ref of parsed) {
            expect(nums).toContain(ref)
          }

          // 每个唯一的原始数字都应被解析出
          for (const num of expectedSet) {
            expect(parsed).toContain(num)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('validateReferences 应在所有引用 ∈ [1, totalAssets] 且 ≤ 9 时通过', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }), // totalAssets
        (totalAssets) => {
          // 生成合法引用：1-9 个引用，每个在 [1, totalAssets] 范围内
          const validRefs = fc.sample(
            fc.array(
              fc.integer({ min: 1, max: totalAssets }),
              { minLength: 1, maxLength: 9 }
            ),
            1
          )[0]

          // 去重后不超过 9 个
          const uniqueRefs = [...new Set(validRefs)]
          if (uniqueRefs.length > 9) return // 跳过

          const result = validateReferences(uniqueRefs, totalAssets)
          expect(result.valid).toBe(true)
          expect(result.errors).toHaveLength(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('validateReferences 应在引用超过 9 张时拒绝', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 50 }), // totalAssets (足够大)
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 10, maxLength: 20 }),
        (totalAssets, rawRefs) => {
          // 确保去重后 > 9 个
          const refs = [...new Set(rawRefs)]
          if (refs.length <= 9) return // 跳过不满足条件的

          const result = validateReferences(refs, totalAssets)
          expect(result.valid).toBe(false)
          expect(result.errors.some((e) => e.includes('最多引用 9 张'))).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('validateReferences 应在引用超出范围时拒绝', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }), // totalAssets
        fc.integer({ min: 1, max: 9 }),   // 引用数量
        (totalAssets, refCount) => {
          // 生成包含至少一个越界引用的数组
          const validRefs = Array.from({ length: Math.max(0, refCount - 1) }, () =>
            Math.floor(Math.random() * totalAssets) + 1
          )
          const outOfRange = totalAssets + Math.floor(Math.random() * 10) + 1
          const refs = [...new Set([...validRefs, outOfRange])]

          const result = validateReferences(refs, totalAssets)
          expect(result.valid).toBe(false)
          expect(result.errors.some((e) => e.includes('不存在'))).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('parseAssetReferences 对不含 [图N] 的文本应返回空数组', () => {
    fc.assert(
      fc.property(
        // 生成不含 [图 字符组合的文本
        fc.string({ minLength: 0, maxLength: 200 }).filter(
          (s) => !/\[图\d+\]/.test(s)
        ),
        (text) => {
          const result = parseAssetReferences(text)
          expect(result).toHaveLength(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('validateReferences 对空引用数组应返回通过', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }), // totalAssets
        (totalAssets) => {
          const result = validateReferences([], totalAssets)
          expect(result.valid).toBe(true)
          expect(result.errors).toHaveLength(0)
        }
      ),
      { numRuns: 50 }
    )
  })
})
