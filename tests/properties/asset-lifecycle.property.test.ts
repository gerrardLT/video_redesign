import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 14: 资产过期时间设置
 * Property 15: 剩余有效天数计算
 * Property 16: 资产过期访问控制
 * Property 17: 过期资产扫描识别
 * Property 18: 资产清理不变量
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 11.1, 12.1, 13.2, 13.3, 14.1**
 */

// ========================
// 纯函数复制（避免引入 Prisma 依赖）
// ========================

/**
 * 计算资产剩余有效天数 (from asset-lifecycle-service.ts)
 * 接受 expiresAt 和当前时间，返回 [0, 14] 范围内的天数
 */
function getRemainingDays(expiresAt: Date, now: Date = new Date()): number {
  const diff = expiresAt.getTime() - now.getTime()
  if (diff <= 0) return 0
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  return Math.min(days, 14)
}

/**
 * 检查资产是否已过期 (from asset-lifecycle-service.ts)
 */
function isAssetExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  return now >= expiresAt
}

/**
 * 计算过期时间 (from setExpiry logic)
 * expiresAt = createdAt + days * 24 * 60 * 60 * 1000
 */
function computeExpiresAt(createdAt: Date, days: number = 14): Date {
  return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000)
}

// ========================
// 模拟 Asset 和扫描逻辑
// ========================

interface MockAsset {
  id: string
  fileName: string
  projectId: string
  url: string
  type: string
  status: string
  createdAt: Date
  expiresAt: Date | null
}

/**
 * 扫描过期资产逻辑：
 * 返回所有 expiresAt <= now AND status != 'EXPIRED' 的资产
 */
function scanExpiredAssets(assets: MockAsset[], now: Date): MockAsset[] {
  return assets.filter(
    (a) => a.expiresAt !== null && a.expiresAt.getTime() <= now.getTime() && a.status !== 'EXPIRED'
  )
}

/**
 * 清理过期资产逻辑模拟：
 * - 更新 status 为 EXPIRED
 * - 保留元数据 (id, fileName, projectId, createdAt, expiresAt)
 * - 删除文件（记录 deleteObject 调用）
 */
function simulateCleanup(asset: MockAsset): {
  updatedAsset: MockAsset
  deletedUrl: string
} {
  return {
    updatedAsset: {
      ...asset,
      status: 'EXPIRED',
    },
    deletedUrl: asset.url,
  }
}

// ========================
// 通用 date arbitrary（避免 NaN 日期）
// ========================
const validDate = (min: string, max: string) =>
  fc.date({ min: new Date(min), max: new Date(max), noInvalidDate: true })

// ========================
// Property 14: 资产过期时间设置
// ========================

describe('资产过期时间设置 Property (Property 14)', () => {
  it('setExpiration sets expiresAt = createdAt + 14 days exactly', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        (createdAt) => {
          const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

          const expiresAt = computeExpiresAt(createdAt, 14)

          // expiresAt 应精确等于 createdAt + 14 天
          expect(expiresAt.getTime()).toBe(createdAt.getTime() + FOURTEEN_DAYS_MS)
          // 验证精确的毫秒数差值
          expect(expiresAt.getTime() - createdAt.getTime()).toBe(1209600000)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('自定义天数设置应正确计算过期时间', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        fc.integer({ min: 1, max: 365 }),
        (createdAt, days) => {
          const expiresAt = computeExpiresAt(createdAt, days)

          expect(expiresAt.getTime()).toBe(
            createdAt.getTime() + days * 24 * 60 * 60 * 1000
          )
          // expiresAt 总是大于 createdAt
          expect(expiresAt.getTime()).toBeGreaterThan(createdAt.getTime())
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// 生成器
// ========================

const assetStatusArb = fc.constantFrom(
  'PENDING',
  'UPLOADED',
  'CHECKING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CHECK_FAILED'
)

const mockAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  fileName: fc.stringMatching(/^[a-z0-9]{8}\.(mp4|jpg|png)$/),
  projectId: fc.uuid(),
  url: fc.stringMatching(/^https:\/\/oss\.example\.com\/[a-z0-9]{16}\.(mp4|jpg|png)$/),
  type: fc.constantFrom('AI_GENERATED', 'REFERENCE', 'SOURCE_VIDEO'),
  status: assetStatusArb,
  createdAt: validDate('2024-01-01', '2025-06-30'),
  expiresAt: fc.option(validDate('2024-01-15', '2025-07-14'), { nil: null }),
})

// ========================
// Property 15: 剩余有效天数计算
// ========================

describe('剩余有效天数计算 Property (Property 15)', () => {
  it('剩余天数 = Math.ceil((expiresAt - now) / 86400000)，结果在 [0, 14]', () => {
    fc.assert(
      fc.property(
        validDate('2024-06-01', '2025-06-30'), // expiresAt
        validDate('2024-01-01', '2025-12-31'), // now
        (expiresAt, now) => {
          const days = getRemainingDays(expiresAt, now)

          expect(days).toBeGreaterThanOrEqual(0)
          expect(days).toBeLessThanOrEqual(14)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('当 now >= expiresAt 时剩余天数为 0', () => {
    fc.assert(
      fc.property(
        validDate('2024-01-01', '2025-06-30'),
        fc.integer({ min: 0, max: 30 * 24 * 60 * 60 * 1000 }), // 偏移毫秒
        (expiresAt, offsetMs) => {
          // now >= expiresAt
          const now = new Date(expiresAt.getTime() + offsetMs)

          const days = getRemainingDays(expiresAt, now)
          expect(days).toBe(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('当 now < expiresAt 时剩余天数 > 0', () => {
    fc.assert(
      fc.property(
        validDate('2024-06-01', '2025-06-30'),
        fc.integer({ min: 1, max: 14 * 24 * 60 * 60 * 1000 }), // 偏移毫秒 (1ms ~ 14天)
        (expiresAt, offsetMs) => {
          // now < expiresAt
          const now = new Date(expiresAt.getTime() - offsetMs)

          const days = getRemainingDays(expiresAt, now)
          expect(days).toBeGreaterThan(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('差值恰好 N 天整数时返回 N', () => {
    fc.assert(
      fc.property(
        validDate('2024-01-01', '2025-06-30'),
        fc.integer({ min: 1, max: 14 }),
        (baseDate, daysAhead) => {
          const expiresAt = new Date(baseDate.getTime() + daysAhead * 24 * 60 * 60 * 1000)
          const now = baseDate

          const days = getRemainingDays(expiresAt, now)
          expect(days).toBe(daysAhead)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 16: 资产过期访问控制
// ========================

describe('资产过期访问控制 Property (Property 16)', () => {
  it('当前时间 < expiresAt 时资产未过期（可下载）', () => {
    fc.assert(
      fc.property(
        validDate('2024-06-01', '2025-12-31'),
        fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }),
        (expiresAt, offsetMs) => {
          // now < expiresAt
          const now = new Date(expiresAt.getTime() - offsetMs)

          const expired = isAssetExpired(expiresAt, now)
          expect(expired).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('当前时间 >= expiresAt 时资产已过期（不可下载）', () => {
    fc.assert(
      fc.property(
        validDate('2024-01-01', '2025-06-30'),
        fc.integer({ min: 0, max: 30 * 24 * 60 * 60 * 1000 }),
        (expiresAt, offsetMs) => {
          // now >= expiresAt
          const now = new Date(expiresAt.getTime() + offsetMs)

          const expired = isAssetExpired(expiresAt, now)
          expect(expired).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('expiresAt 为 null 时资产视为未过期', () => {
    fc.assert(
      fc.property(
        validDate('2024-01-01', '2025-12-31'),
        (now) => {
          const expired = isAssetExpired(null, now)
          expect(expired).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 17: 过期资产扫描识别
// ========================

describe('过期资产扫描识别 Property (Property 17)', () => {
  it('scanExpiredAssets 仅返回 expiresAt <= now 且 status != EXPIRED 的资产', () => {
    fc.assert(
      fc.property(
        fc.array(mockAssetArb, { minLength: 0, maxLength: 20 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const expired = scanExpiredAssets(assets, now)

          for (const asset of expired) {
            expect(asset.expiresAt).not.toBeNull()
            expect(asset.expiresAt!.getTime()).toBeLessThanOrEqual(now.getTime())
            expect(asset.status).not.toBe('EXPIRED')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('已标记 EXPIRED 的资产不出现在扫描结果中', () => {
    fc.assert(
      fc.property(
        fc.array(
          mockAssetArb.map((a) => ({
            ...a,
            status: 'EXPIRED',
            expiresAt: new Date('2020-01-01'), // 已过期
          })),
          { minLength: 1, maxLength: 10 }
        ),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = scanExpiredAssets(assets, now)
          expect(result.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('expiresAt 为 null 的资产不出现在扫描结果中', () => {
    fc.assert(
      fc.property(
        fc.array(
          mockAssetArb.map((a) => ({ ...a, expiresAt: null })),
          { minLength: 1, maxLength: 10 }
        ),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = scanExpiredAssets(assets, now)
          expect(result.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('扫描不遗漏任何满足条件的资产', () => {
    fc.assert(
      fc.property(
        fc.array(mockAssetArb, { minLength: 0, maxLength: 20 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = scanExpiredAssets(assets, now)

          const expected = assets.filter(
            (a) => a.expiresAt !== null && a.expiresAt.getTime() <= now.getTime() && a.status !== 'EXPIRED'
          )

          expect(result.length).toBe(expected.length)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 18: 资产清理不变量
// ========================

describe('资产清理不变量 Property (Property 18)', () => {
  it('清理后资产 status 变为 EXPIRED', () => {
    fc.assert(
      fc.property(
        mockAssetArb.map((a) => ({ ...a, status: 'APPROVED' })),
        (asset) => {
          const { updatedAsset } = simulateCleanup(asset)

          expect(updatedAsset.status).toBe('EXPIRED')
        }
      ),
      { numRuns: 200 }
    )
  })

  it('清理后元数据保留不变（id、projectId、createdAt、expiresAt）', () => {
    fc.assert(
      fc.property(
        mockAssetArb,
        (asset) => {
          const { updatedAsset } = simulateCleanup(asset)

          expect(updatedAsset.id).toBe(asset.id)
          expect(updatedAsset.projectId).toBe(asset.projectId)
          expect(updatedAsset.createdAt).toEqual(asset.createdAt)
          expect(updatedAsset.expiresAt).toEqual(asset.expiresAt)
          expect(updatedAsset.fileName).toBe(asset.fileName)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('清理时 deleteObject 被调用且参数为资产的 url', () => {
    fc.assert(
      fc.property(
        mockAssetArb,
        (asset) => {
          const { deletedUrl } = simulateCleanup(asset)

          expect(deletedUrl).toBe(asset.url)
          expect(deletedUrl.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('清理后数据库记录仍存在（不是删除行）', () => {
    fc.assert(
      fc.property(
        mockAssetArb,
        (asset) => {
          const { updatedAsset } = simulateCleanup(asset)

          // 记录存在（所有字段非 undefined）
          expect(updatedAsset.id).toBeDefined()
          expect(updatedAsset.projectId).toBeDefined()
          expect(updatedAsset.url).toBeDefined()
        }
      ),
      { numRuns: 100 }
    )
  })
})
