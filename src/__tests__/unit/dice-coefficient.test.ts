/**
 * Dice Coefficient 单元测试
 *
 * 验证 diceCoefficient 函数的核心行为：
 * - diceCoefficient('', '') === 0
 * - diceCoefficient('abc', 'abc') === 1
 * - 对称性：diceCoefficient(a, b) === diceCoefficient(b, a)
 * - 结果始终在 [0, 1] 范围内
 *
 * **Validates: Requirements 13.3**
 */
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

// Mock Prisma db 模块，避免 DATABASE_URL 依赖
vi.mock('@/lib/shared/db', () => ({
  prisma: {},
}))

import { diceCoefficient } from '@/lib/merchant/content-entropy-service'

describe('diceCoefficient 单元测试', () => {
  // ========================
  // 基础行为
  // ========================

  it('两个空字符串返回 0', () => {
    expect(diceCoefficient('', '')).toBe(0)
  })

  it('空字符串与非空字符串返回 0', () => {
    expect(diceCoefficient('', 'abc')).toBe(0)
    expect(diceCoefficient('hello', '')).toBe(0)
  })

  it('相同字符串返回 1', () => {
    expect(diceCoefficient('abc', 'abc')).toBe(1)
  })

  it('相同较长字符串返回 1', () => {
    expect(diceCoefficient('hello world', 'hello world')).toBe(1)
  })

  it('完全不同的字符串返回 0 或接近 0', () => {
    // 无任何共同 bigram
    const result = diceCoefficient('ab', 'cd')
    expect(result).toBe(0)
  })

  it('单字符字符串返回 0（无法形成 bigram）', () => {
    expect(diceCoefficient('a', 'a')).toBe(1) // 相同字符串快路径
    expect(diceCoefficient('a', 'b')).toBe(0) // 无 bigram
  })

  // ========================
  // 属性测试
  // ========================

  it('对称性: diceCoefficient(a, b) === diceCoefficient(b, a)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (a, b) => {
          expect(diceCoefficient(a, b)).toBe(diceCoefficient(b, a))
        }
      ),
      { numRuns: 100 }
    )
  })

  it('结果始终在 [0, 1] 范围内', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (a, b) => {
          const result = diceCoefficient(a, b)
          expect(result).toBeGreaterThanOrEqual(0)
          expect(result).toBeLessThanOrEqual(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('相同非空字符串（长度 >= 2）返回 1', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 50 }),
        (s) => {
          expect(diceCoefficient(s, s)).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('不区分大小写（内部 lowercase）', () => {
    fc.assert(
      fc.property(
        // 生成纯字母字符串（长度 >= 2），避免 trim 后长度不足的问题
        fc.stringMatching(/^[a-zA-Z]{2,30}$/),
        (s) => {
          const upper = s.toUpperCase()
          const lower = s.toLowerCase()
          expect(diceCoefficient(upper, lower)).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  // ========================
  // 已知值验证
  // ========================

  it('已知计算结果验证', () => {
    // "night" bigrams: ni, ig, gh, ht (4 个)
    // "nacht" bigrams: na, ac, ch, ht (4 个)
    // 交集: ht (1 个)
    // dice = 2 * 1 / (4 + 4) = 0.25
    expect(diceCoefficient('night', 'nacht')).toBeCloseTo(0.25, 5)
  })
})
