/**
 * Property-Based Test: scriptHash 确定性与格式
 * Feature: production-reliability, Property 1: scriptHash 确定性与无冲突性
 *
 * Validates: Requirements 4.1
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeScriptHash } from '@/lib/shared/script-hash'

describe('computeScriptHash 属性测试', () => {
  it('Property 1.1: 相同输入恒产生相同输出（确定性）', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.double({ min: 0.1, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom('480p', '720p'),
        (script, duration, resolution) => {
          const hash1 = computeScriptHash(script, duration, resolution)
          const hash2 = computeScriptHash(script, duration, resolution)
          expect(hash1).toBe(hash2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('Property 1.2: 输出为恰好 16 位的十六进制字符串', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.double({ min: 0.1, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom('480p', '720p'),
        (script, duration, resolution) => {
          const hash = computeScriptHash(script, duration, resolution)
          expect(hash).toHaveLength(16)
          expect(hash).toMatch(/^[0-9a-f]{16}$/)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('Property 1.3: 任意一个输入参数变化时，输出应不同', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom('480p', '720p'),
        (script, duration, resolution) => {
          const baseHash = computeScriptHash(script, duration, resolution)

          // 改变 script
          const diffScript = computeScriptHash(script + 'x', duration, resolution)
          expect(diffScript).not.toBe(baseHash)

          // 改变 duration
          const diffDuration = computeScriptHash(script, duration + 1, resolution)
          expect(diffDuration).not.toBe(baseHash)
        }
      ),
      { numRuns: 100 }
    )
  })
})
