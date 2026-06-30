// Feature: local-life-depth-enhancements, Property 24: 授权确认前置
/**
 * 属性测试：平台凭证「授权确认前置」（Property 24）
 *
 * **Validates: Requirements 7.2**
 *
 * 不变式：saveCredential 当 authConfirmed=false（即 !== true）时必被拒绝，
 * 抛出 CredentialAuthError 且不进入凭证存储（prisma.platformAccount.upsert 未被调用）；
 * 仅当 authConfirmed=true 时方可保存，此时 upsert 被调用恰一次，且落库的
 * encryptedCookie 不等于明文 cookie（服务端加密，禁止明文存储）。
 *
 * 隔离策略：saveCredential 仅经 prisma.platformAccount.upsert 写库，其余为
 * 纯逻辑（授权校验 + AES-256-GCM 加密）。参照既有属性测试约定
 *（tests/properties/performance-learning.property.test.ts），对 @/lib/db 做内存桩，
 * 仅替换 DB 写入以隔离纯断言逻辑——不 mock 加密等关键逻辑。
 * 加密密钥经 process.env.PLATFORM_CRED_ENC_KEY 注入。fast-check 运行 ≥100 次迭代，Node 环境。
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import * as fc from 'fast-check'

// ========================
// 加密密钥：saveCredential 内部加密依赖该环境变量，缺失会直接抛错
// ========================

beforeAll(() => {
  process.env.PLATFORM_CRED_ENC_KEY = 'test-platform-cred-enc-key-属性测试专用-7c0562'
})

// ========================
// Mock Prisma：仅替换 platformAccount.upsert 写入，隔离纯授权/加密逻辑
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    platformAccount: { upsert: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { saveCredential, CredentialAuthError } from '@/lib/platform-metrics-crawler'
import type { PublishPlatform } from '@/types/merchant'

// upsert 内存桩：回显传入的 create 数据（含 encryptedCookie）作为返回账号
const upsertMock = vi.mocked(prisma.platformAccount.upsert)

// ========================
// 生成器
// ========================

/** 支持的发布平台枚举 */
const platformArb = fc.constantFrom(
  'DOUYIN',
  'KUAISHOU',
  'XIAOHONGSHU',
  'WECHAT_CHANNELS',
  'MANUAL_EXPORT',
) as fc.Arbitrary<PublishPlatform>

/** 非空 cookie（明文会话凭证）—— 至少含一个非空白字符，避免触发空凭证校验分支 */
const cookieArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0)

/** storeId：非空标识 */
const storeIdArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0)

/** 抓取间隔（小时）可选项 */
const intervalArb = fc.option(fc.integer({ min: -10, max: 100 }), { nil: undefined })

describe('Property 24: 授权确认前置（saveCredential）', () => {
  beforeEach(() => {
    upsertMock.mockReset()
    // 默认回显 create 数据，使返回结构含 encryptedCookie 供断言
    upsertMock.mockImplementation(async (args: any) => ({
      id: 'acc-test',
      ...args.create,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  })

  it('authConfirmed !== true 时拒绝保存且不调用 upsert；=== true 时调用 upsert 且存储值非明文 cookie', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        cookieArb,
        platformArb,
        storeIdArb,
        intervalArb,
        async (authConfirmed, cookie, platform, storeId, crawlIntervalH) => {
          upsertMock.mockClear()

          if (authConfirmed !== true) {
            // ─── 未授权确认：必拒绝（CredentialAuthError）且不进入凭证存储 ───
            await expect(
              saveCredential({ storeId, platform, cookie, authConfirmed, crawlIntervalH }),
            ).rejects.toBeInstanceOf(CredentialAuthError)
            expect(upsertMock).not.toHaveBeenCalled()
          } else {
            // ─── 已授权确认：保存成功，upsert 恰调用一次，存储值非明文 ───
            const account = await saveCredential({
              storeId,
              platform,
              cookie,
              authConfirmed,
              crawlIntervalH,
            })
            expect(upsertMock).toHaveBeenCalledTimes(1)

            // 落库的 encryptedCookie 不得等于明文 cookie（服务端加密）
            const callArg = upsertMock.mock.calls[0][0] as any
            expect(callArg.create.encryptedCookie).not.toBe(cookie)
            expect(account.encryptedCookie).not.toBe(cookie)
            // 唯一约束按 (storeId, platform) upsert
            expect(callArg.where).toEqual({ storeId_platform: { storeId, platform } })
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})
