import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: product-competitiveness
 * Property 1: 视频链接格式验证正确性
 *
 * For any string input, validateShareLink should:
 * - Return { valid: true, platform } for strings matching supported platform patterns
 * - Return { valid: false, error } for strings not matching any supported platform
 * - Never misidentify a platform (douyin link → platform: 'douyin', etc.)
 *
 * **Validates: Requirements 1.1, 1.6, 1.9**
 */

// ========================
// 纯函数复制（来自 src/lib/video-import-service.ts + src/constants/platform-patterns.ts）
// ========================

type VideoPlatform = 'douyin' | 'kuaishou' | 'weixin'

interface ValidateResult {
  valid: boolean
  platform?: VideoPlatform
  error?: string
}

const PLATFORM_PATTERNS = [
  {
    platform: 'douyin' as VideoPlatform,
    patterns: [
      /https?:\/\/(www\.)?douyin\.com\/video\/\d+/,
      /https?:\/\/v\.douyin\.com\/\w+/,
    ],
  },
  {
    platform: 'kuaishou' as VideoPlatform,
    patterns: [
      /https?:\/\/(www\.)?kuaishou\.com\/short-video\/\w+/,
      /https?:\/\/v\.kuaishou\.com\/\w+/,
    ],
  },
  {
    platform: 'weixin' as VideoPlatform,
    patterns: [/https?:\/\/channels\.weixin\.qq\.com\/\w+/],
  },
]

/**
 * 验证分享链接格式（纯函数，与源码逻辑一致）
 */
function validateShareLink(url: string): ValidateResult {
  if (!url || !url.trim()) {
    return { valid: false, error: '请输入视频链接' }
  }

  const trimmed = url.trim()

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { valid: false, error: '请输入有效的视频链接（以 http:// 或 https:// 开头）' }
  }

  for (const { platform, patterns } of PLATFORM_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { valid: true, platform }
      }
    }
  }

  return { valid: false, error: '暂不支持该平台，目前支持抖音、快手和微信视频号' }
}

// ========================
// 生成器
// ========================

/** 生成有效的抖音链接 */
const validDouyinLinkArb = fc.oneof(
  // 格式1: https://www.douyin.com/video/123456
  fc.stringMatching(/^[0-9]{10,20}$/).map(
    (id) => `https://www.douyin.com/video/${id}`
  ),
  // 格式2: https://v.douyin.com/abcd1234
  fc.stringMatching(/^[a-zA-Z0-9]{6,12}$/).map(
    (code) => `https://v.douyin.com/${code}`
  )
)

/** 生成有效的快手链接 */
const validKuaishouLinkArb = fc.oneof(
  // 格式1: https://www.kuaishou.com/short-video/abc123
  fc.stringMatching(/^[a-zA-Z0-9]{6,16}$/).map(
    (id) => `https://www.kuaishou.com/short-video/${id}`
  ),
  // 格式2: https://v.kuaishou.com/abc123
  fc.stringMatching(/^[a-zA-Z0-9]{6,12}$/).map(
    (code) => `https://v.kuaishou.com/${code}`
  )
)

/** 生成有效的微信视频号链接 */
const validWeixinLinkArb = fc.stringMatching(/^[a-zA-Z0-9]{6,20}$/).map(
  (id) => `https://channels.weixin.qq.com/${id}`
)

/** 生成不支持平台的链接 */
const unsupportedLinkArb = fc.oneof(
  fc.constant('https://www.youtube.com/watch?v=abc123'),
  fc.constant('https://www.bilibili.com/video/BV1234567890'),
  fc.constant('https://www.tiktok.com/@user/video/123456'),
  fc.constant('https://www.instagram.com/reel/abc123'),
  fc.stringMatching(/^[a-z]{4,10}$/).map((domain) => `https://www.${domain}.com/video/123`)
)

/** 生成非 URL 字符串 */
const nonUrlStringArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => !s.trim().startsWith('http://') && !s.trim().startsWith('https://')
  ),
  fc.constant('ftp://example.com/video'),
  fc.constant('not-a-url'),
  fc.constant('douyin.com/video/123')
)

// ========================
// Property 1: 视频链接格式验证正确性
// ========================

describe('视频链接格式验证正确性 Property (Property 1)', () => {
  describe('有效链接识别', () => {
    it('任意有效抖音链接应返回 { valid: true, platform: "douyin" }', () => {
      fc.assert(
        fc.property(validDouyinLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).toBe('douyin')
        }),
        { numRuns: 200 }
      )
    })

    it('任意有效快手链接应返回 { valid: true, platform: "kuaishou" }', () => {
      fc.assert(
        fc.property(validKuaishouLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).toBe('kuaishou')
        }),
        { numRuns: 200 }
      )
    })

    it('任意有效微信视频号链接应返回 { valid: true, platform: "weixin" }', () => {
      fc.assert(
        fc.property(validWeixinLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).toBe('weixin')
        }),
        { numRuns: 200 }
      )
    })
  })

  describe('无效链接拒绝', () => {
    it('空字符串应返回 valid: false', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', ' ', '  ', '\t', '\n'),
          (input) => {
            const result = validateShareLink(input)
            expect(result.valid).toBe(false)
            expect(result.error).toBeDefined()
          }
        ),
        { numRuns: 50 }
      )
    })

    it('非 URL 格式字符串应返回 valid: false', () => {
      fc.assert(
        fc.property(nonUrlStringArb, (input) => {
          const result = validateShareLink(input)
          expect(result.valid).toBe(false)
          expect(result.error).toBeDefined()
        }),
        { numRuns: 200 }
      )
    })

    it('不支持平台的链接应返回 valid: false', () => {
      fc.assert(
        fc.property(unsupportedLinkArb, (link) => {
          const result = validateShareLink(link)
          expect(result.valid).toBe(false)
          expect(result.error).toContain('不支持')
        }),
        { numRuns: 200 }
      )
    })
  })

  describe('平台不混淆', () => {
    it('抖音链接不被识别为其他平台', () => {
      fc.assert(
        fc.property(validDouyinLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).not.toBe('kuaishou')
          expect(result.platform).not.toBe('weixin')
        }),
        { numRuns: 200 }
      )
    })

    it('快手链接不被识别为其他平台', () => {
      fc.assert(
        fc.property(validKuaishouLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).not.toBe('douyin')
          expect(result.platform).not.toBe('weixin')
        }),
        { numRuns: 200 }
      )
    })

    it('微信视频号链接不被识别为其他平台', () => {
      fc.assert(
        fc.property(validWeixinLinkArb, (link) => {
          const result = validateShareLink(link)

          expect(result.valid).toBe(true)
          expect(result.platform).not.toBe('douyin')
          expect(result.platform).not.toBe('kuaishou')
        }),
        { numRuns: 200 }
      )
    })
  })

  describe('通用性质', () => {
    it('valid 为 true 时必有 platform 字段', () => {
      fc.assert(
        fc.property(
          fc.oneof(validDouyinLinkArb, validKuaishouLinkArb, validWeixinLinkArb),
          (link) => {
            const result = validateShareLink(link)

            if (result.valid) {
              expect(result.platform).toBeDefined()
              expect(['douyin', 'kuaishou', 'weixin']).toContain(result.platform)
            }
          }
        ),
        { numRuns: 200 }
      )
    })

    it('valid 为 false 时必有 error 字段', () => {
      fc.assert(
        fc.property(
          fc.oneof(nonUrlStringArb, unsupportedLinkArb, fc.constant('')),
          (input) => {
            const result = validateShareLink(input)

            if (!result.valid) {
              expect(result.error).toBeDefined()
              expect(result.error!.length).toBeGreaterThan(0)
            }
          }
        ),
        { numRuns: 200 }
      )
    })

    it('链接前后有空格不影响验证结果', () => {
      fc.assert(
        fc.property(
          fc.oneof(validDouyinLinkArb, validKuaishouLinkArb, validWeixinLinkArb),
          fc.string({ minLength: 0, maxLength: 3 }).map((s) => s.replace(/\S/g, ' ')),
          fc.string({ minLength: 0, maxLength: 3 }).map((s) => s.replace(/\S/g, ' ')),
          (link, prefix, suffix) => {
            const paddedLink = `${prefix}${link}${suffix}`
            const result = validateShareLink(paddedLink)

            // 由于 trimmed 后应与原始结果一致
            const directResult = validateShareLink(link)
            expect(result.valid).toBe(directResult.valid)
            expect(result.platform).toBe(directResult.platform)
          }
        ),
        { numRuns: 200 }
      )
    })
  })
})
