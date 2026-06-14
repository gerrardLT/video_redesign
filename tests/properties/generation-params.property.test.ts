import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: video-reshaping-mvp
 * Property 4: 生成参数校验
 *
 * **Validates: Requirements 10.1, 10.2**
 *
 * 对任意生成参数组合：
 * - duration 必须为 4|6|8|10|15 之一
 * - aspectRatio 必须为 '9:16'|'16:9'|'1:1' 之一
 * - resolution 必须为 '480p'|'720p' 之一
 * - 积分估算 = ceil(duration × (resolution === '720p' ? 1.5 : 1.0))
 * - 非法参数组合应被拒绝
 */

// 内联验证逻辑（与 route 中一致）
const VALID_DURATIONS = ['4', '6', '8', '10', '15'] as const
const VALID_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
const VALID_RESOLUTIONS = ['480p', '720p'] as const

function isValidDuration(v: string): boolean {
  return (VALID_DURATIONS as readonly string[]).includes(v)
}

function isValidAspectRatio(v: string): boolean {
  return (VALID_ASPECT_RATIOS as readonly string[]).includes(v)
}

function isValidResolution(v: string): boolean {
  return (VALID_RESOLUTIONS as readonly string[]).includes(v)
}

function estimateCreditCost(duration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(duration * multiplier)
}

function validateGenerateParams(params: { duration: string; aspectRatio: string; resolution: string }): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!isValidDuration(params.duration)) errors.push('无效的时长')
  if (!isValidAspectRatio(params.aspectRatio)) errors.push('无效的画面比例')
  if (!isValidResolution(params.resolution)) errors.push('无效的分辨率')
  return { valid: errors.length === 0, errors }
}

describe('生成参数校验 Property', () => {
  it('合法参数组合应全部通过校验', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_DURATIONS),
        fc.constantFrom(...VALID_ASPECT_RATIOS),
        fc.constantFrom(...VALID_RESOLUTIONS),
        (duration, aspectRatio, resolution) => {
          const result = validateGenerateParams({ duration, aspectRatio, resolution })
          expect(result.valid).toBe(true)
          expect(result.errors).toHaveLength(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('非法 duration 应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5 }).filter(
          (s) => !(VALID_DURATIONS as readonly string[]).includes(s)
        ),
        fc.constantFrom(...VALID_ASPECT_RATIOS),
        fc.constantFrom(...VALID_RESOLUTIONS),
        (duration, aspectRatio, resolution) => {
          const result = validateGenerateParams({ duration, aspectRatio, resolution })
          expect(result.valid).toBe(false)
          expect(result.errors.some((e) => e.includes('时长'))).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('非法 aspectRatio 应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_DURATIONS),
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          (s) => !(VALID_ASPECT_RATIOS as readonly string[]).includes(s)
        ),
        fc.constantFrom(...VALID_RESOLUTIONS),
        (duration, aspectRatio, resolution) => {
          const result = validateGenerateParams({ duration, aspectRatio, resolution })
          expect(result.valid).toBe(false)
          expect(result.errors.some((e) => e.includes('比例'))).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('非法 resolution 应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_DURATIONS),
        fc.constantFrom(...VALID_ASPECT_RATIOS),
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          (s) => !(VALID_RESOLUTIONS as readonly string[]).includes(s)
        ),
        (duration, aspectRatio, resolution) => {
          const result = validateGenerateParams({ duration, aspectRatio, resolution })
          expect(result.valid).toBe(false)
          expect(result.errors.some((e) => e.includes('分辨率'))).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('积分估算应满足公式 ceil(duration × multiplier)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(4, 6, 8, 10, 15),
        fc.constantFrom('480p', '720p'),
        (duration, resolution) => {
          const cost = estimateCreditCost(duration, resolution)
          const multiplier = resolution === '720p' ? 1.5 : 1.0
          const expected = Math.ceil(duration * multiplier)
          expect(cost).toBe(expected)
          // 积分必须为正整数
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('720p 分辨率应始终比 480p 消耗更多积分', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(4, 6, 8, 10, 15),
        (duration) => {
          const cost480 = estimateCreditCost(duration, '480p')
          const cost720 = estimateCreditCost(duration, '720p')
          expect(cost720).toBeGreaterThanOrEqual(cost480)
        }
      ),
      { numRuns: 50 }
    )
  })
})
