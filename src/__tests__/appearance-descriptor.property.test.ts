/**
 * Property-Based Test: AppearanceDescriptor Schema 验证
 * Feature: ai-character-appearance-detection, Property 1: AppearanceDescriptor Schema 验证
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 *
 * 验证 AppearanceDescriptorSchema 的 safeParse 行为：
 * - 包含 4 个 string 字段的对象（含空字符串）→ success=true
 * - 缺少字段时，由于 z.string().default('')，safeParse 仍然 success=true（自动填充默认值）
 * - 字段值类型不是 string（数字、null、数组等）→ success=false
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { AppearanceDescriptorSchema } from '@/lib/shot-schema'

// ========================
// 生成器
// ========================

/** 生成有效的 AppearanceDescriptor 对象（4 个 string 字段，含空字符串可能） */
const validAppearanceArb = fc.record({
  hair: fc.string({ maxLength: 50 }),
  clothing: fc.string({ maxLength: 50 }),
  accessories: fc.string({ maxLength: 50 }),
  makeup: fc.string({ maxLength: 50 }),
})

/** 生成部分字段缺失的对象（由于 default('')，safeParse 仍应 success=true） */
const partialValidAppearanceArb = fc.record(
  {
    hair: fc.string({ maxLength: 50 }),
    clothing: fc.string({ maxLength: 50 }),
    accessories: fc.string({ maxLength: 50 }),
    makeup: fc.string({ maxLength: 50 }),
  },
  { requiredKeys: [] }
)

/** 生成非 string 类型的值（用于构造无效字段） */
const nonStringValueArb = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.dictionary(fc.string({ maxLength: 5 }), fc.integer(), { maxKeys: 3 }),
)

/** 四个维度字段名 */
const dimensionFields = ['hair', 'clothing', 'accessories', 'makeup'] as const

/** 生成至少一个字段值为非 string 类型的对象（应导致 safeParse 失败） */
const invalidTypeAppearanceArb = fc.tuple(
  fc.constantFrom(...dimensionFields),
  nonStringValueArb,
  fc.record({
    hair: fc.string({ maxLength: 50 }),
    clothing: fc.string({ maxLength: 50 }),
    accessories: fc.string({ maxLength: 50 }),
    makeup: fc.string({ maxLength: 50 }),
  }),
).map(([field, badValue, base]) => ({
  ...base,
  [field]: badValue,
}))

// ========================
// 属性测试
// ========================

describe('Feature: ai-character-appearance-detection, Property 1: AppearanceDescriptor Schema 验证', () => {
  it('有效对象（4 个 string 字段）safeParse 应返回 success=true', () => {
    fc.assert(
      fc.property(validAppearanceArb, (obj) => {
        const result = AppearanceDescriptorSchema.safeParse(obj)
        expect(result.success).toBe(true)
        if (result.success) {
          // 验证解析后的值与输入一致
          expect(result.data.hair).toBe(obj.hair)
          expect(result.data.clothing).toBe(obj.clothing)
          expect(result.data.accessories).toBe(obj.accessories)
          expect(result.data.makeup).toBe(obj.makeup)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('部分字段缺失时，safeParse 仍应 success=true（default 自动填充空字符串）', () => {
    fc.assert(
      fc.property(partialValidAppearanceArb, (obj) => {
        const result = AppearanceDescriptorSchema.safeParse(obj)
        expect(result.success).toBe(true)
        if (result.success) {
          // 缺失的字段应被填充为空字符串
          for (const field of dimensionFields) {
            if (field in obj) {
              expect(result.data[field]).toBe(obj[field as keyof typeof obj])
            } else {
              expect(result.data[field]).toBe('')
            }
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('字段值类型不是 string 时，safeParse 应返回 success=false', () => {
    fc.assert(
      fc.property(invalidTypeAppearanceArb, (obj) => {
        const result = AppearanceDescriptorSchema.safeParse(obj)
        expect(result.success).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('空对象 {} 经 safeParse 后所有字段应为空字符串（default 机制）', () => {
    const result = AppearanceDescriptorSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hair).toBe('')
      expect(result.data.clothing).toBe('')
      expect(result.data.accessories).toBe('')
      expect(result.data.makeup).toBe('')
    }
  })
})
