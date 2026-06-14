import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 4: timelineScript 长度校验
 *
 * For any 字符串输入，PATCH /api/shot-groups/[id] 接口应当在字符长度 ≤ 500 时接受保存，
 * 在字符长度 > 500 时拒绝保存并返回错误。
 *
 * Validates: Requirements 6.5
 */

const MAX_SCRIPT_LENGTH = 500

// 从 PATCH API 中提取的长度校验逻辑
function validateScriptLength(script: string): { valid: boolean; error?: string } {
  if (script.length > MAX_SCRIPT_LENGTH) {
    return { valid: false, error: '脚本内容不能超过500个字符' }
  }
  return { valid: true }
}

describe('Property 4: timelineScript 长度校验', () => {
  it('长度 ≤ 500 的字符串始终通过校验', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: MAX_SCRIPT_LENGTH }),
        (script) => {
          const result = validateScriptLength(script)
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('长度 > 500 的字符串始终被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_SCRIPT_LENGTH + 1, maxLength: MAX_SCRIPT_LENGTH + 500 }),
        (script) => {
          const result = validateScriptLength(script)
          expect(result.valid).toBe(false)
          expect(result.error).toBe('脚本内容不能超过500个字符')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('边界值：恰好 500 字符通过，501 字符被拒绝', () => {
    const exactly500 = 'a'.repeat(500)
    const exactly501 = 'a'.repeat(501)

    expect(validateScriptLength(exactly500).valid).toBe(true)
    expect(validateScriptLength(exactly501).valid).toBe(false)
  })

  it('中文字符也按字符数计算（非字节数）', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0x4e00, max: 0x9fff }).map((code) => String.fromCharCode(code)),
          { minLength: 0, maxLength: MAX_SCRIPT_LENGTH }
        ).map((chars) => chars.join('')),
        (chineseScript) => {
          // 中文字符串长度 ≤ 500 应通过
          const result = validateScriptLength(chineseScript)
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('超过 500 个中文字符被拒绝', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0x4e00, max: 0x9fff }).map((code) => String.fromCharCode(code)),
          { minLength: MAX_SCRIPT_LENGTH + 1, maxLength: MAX_SCRIPT_LENGTH + 100 }
        ).map((chars) => chars.join('')),
        (chineseScript) => {
          const result = validateScriptLength(chineseScript)
          expect(result.valid).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
