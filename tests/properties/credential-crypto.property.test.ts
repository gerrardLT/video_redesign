// Feature: local-life-depth-enhancements, Property 25: 凭证加密往返
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fc from 'fast-check'
import { encryptCredential, decryptCredential } from '@/lib/platform-metrics-crawler'

/**
 * Feature: local-life-depth-enhancements
 * Property 25: 凭证加密往返
 *
 * *For any* 平台会话凭证 cookie 明文 x：
 *  - 加密后的存储值 SHALL NOT 等于明文（禁止明文存储凭证）；
 *  - decrypt(encrypt(x)) SHALL 等于 x（往返无损）；
 *  - 由于每次使用随机 IV，同一明文两次加密 SHALL 产生不同密文（语义安全，防关联）。
 *
 * 被测：src/lib/platform-metrics-crawler.ts 的 encryptCredential / decryptCredential
 *       （纯函数，AES-256-GCM，密钥派生自 process.env.PLATFORM_CRED_ENC_KEY）。
 *
 * **Validates: Requirements 7.4**
 */

// 测试加密密钥：在测试运行期注入 PLATFORM_CRED_ENC_KEY（被测函数惰性读取该环境变量）。
const ORIGINAL_ENC_KEY = process.env.PLATFORM_CRED_ENC_KEY

beforeAll(() => {
  process.env.PLATFORM_CRED_ENC_KEY = 'test-platform-cred-enc-key-7c0562b387ae6c89'
})

afterAll(() => {
  // 还原环境，避免影响其它测试
  if (ORIGINAL_ENC_KEY === undefined) {
    delete process.env.PLATFORM_CRED_ENC_KEY
  } else {
    process.env.PLATFORM_CRED_ENC_KEY = ORIGINAL_ENC_KEY
  }
})

// 随机 cookie 生成器：覆盖各种长度与字符（含 unicode/分隔符/空白），但非空（凭证不会为空串）。
const cookieArb = fc.string({ minLength: 1, maxLength: 4096 }).filter((s) => s.length > 0)

describe('Property 25: 凭证加密往返', () => {
  it('密文不等于明文，且 decrypt(encrypt(x)) === x', () => {
    fc.assert(
      fc.property(cookieArb, (cookie) => {
        const encrypted = encryptCredential(cookie)
        // 存储值（密文）必定不等于明文，杜绝明文存储
        expect(encrypted).not.toBe(cookie)
        // 往返无损
        expect(decryptCredential(encrypted)).toBe(cookie)
      }),
      { numRuns: 200 }
    )
  })

  it('同一明文两次加密因随机 IV 应产生不同密文，但均可正确解密回原文', () => {
    fc.assert(
      fc.property(cookieArb, (cookie) => {
        const a = encryptCredential(cookie)
        const b = encryptCredential(cookie)
        // 随机 IV ⇒ 两次密文不同（语义安全）
        expect(a).not.toBe(b)
        // 两份密文都能解密回同一明文
        expect(decryptCredential(a)).toBe(cookie)
        expect(decryptCredential(b)).toBe(cookie)
      }),
      { numRuns: 200 }
    )
  })
})
