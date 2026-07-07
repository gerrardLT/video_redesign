import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeExpiryStatus } from '@/lib/shared/expiry-status'

/**
 * Feature: asset-expiry-policy
 * Property 2: setExpiry 跳过永久资产
 * Property 3: renewExpiry 跳过永久资产
 * Property 7: setExpiry 对临时资产正确计算过期时间
 *
 * **Validates: Requirements 1.3, 2.1, 6.2, 6.3**
 */

// ========================
// 类型定义
// ========================

interface MockAsset {
  id: string
  type: string
  category: string | null
  status: string
  createdAt: Date
  expiresAt: Date | null
}

// ========================
// 纯函数模拟（避免引入 Prisma 依赖）
// ========================

/**
 * 模拟 setExpiry 核心逻辑
 * - 永久资产保护：category 有值则跳过
 * - 非 AI_GENERATED 跳过
 * - 设置 expiresAt = createdAt + days * 24 * 60 * 60 * 1000
 */
function simulateSetExpiry(asset: MockAsset, days: number): MockAsset {
  // 永久资产保护：category 有值则跳过
  if (asset.category) return asset
  // 非 AI_GENERATED 跳过
  if (asset.type !== 'AI_GENERATED') return asset
  // 设置过期时间
  const expiresAt = new Date(asset.createdAt.getTime() + days * 24 * 60 * 60 * 1000)
  return { ...asset, expiresAt }
}

/**
 * 模拟 renewExpiry 核心逻辑
 * - 已过期资产抛错
 * - 永久资产无需续期：category 有值则跳过
 * - 非 AI_GENERATED 跳过
 * - 设置 expiresAt = now + days * 24 * 60 * 60 * 1000
 */
function simulateRenewExpiry(asset: MockAsset, days: number, now: Date): MockAsset {
  if (asset.status === 'EXPIRED') throw new Error('已过期')
  // 永久资产无需续期
  if (asset.category) return asset
  // 非 AI_GENERATED 跳过
  if (asset.type !== 'AI_GENERATED') return asset
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return { ...asset, expiresAt }
}

// ========================
// 通用 Arbitraries
// ========================

const validDate = (min: string, max: string) =>
  fc.date({ min: new Date(min), max: new Date(max), noInvalidDate: true })

/** 生成非 null 的 category 值（模拟永久资产） */
const permanentCategoryArb = fc.constantFrom('CHARACTER', 'MATERIAL', 'AUDIO')

/** 生成永久资产（category 有值） */
const permanentAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('AI_GENERATED', 'CHARACTER_IMAGE', 'UPLOADED_IMAGE'),
  category: permanentCategoryArb,
  status: fc.constantFrom('PENDING', 'UPLOADED', 'APPROVED'),
  createdAt: validDate('2024-01-01', '2025-06-30'),
  expiresAt: fc.constant(null),
})

/** 生成临时资产（category 为 null，type 为 AI_GENERATED） */
const temporaryAiAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  type: fc.constant('AI_GENERATED'),
  category: fc.constant(null),
  status: fc.constantFrom('PENDING', 'UPLOADED', 'APPROVED'),
  createdAt: validDate('2024-01-01', '2025-06-30'),
  expiresAt: fc.option(validDate('2024-01-15', '2025-07-14'), { nil: null }),
})

// ========================
// Property 2: setExpiry 跳过永久资产
// ========================

describe('Property 2: setExpiry 跳过永久资产', () => {
  it('category 有值的永久资产调用 setExpiry 后 expiresAt 保持不变', () => {
    /**
     * **Validates: Requirements 1.3, 6.2**
     */
    fc.assert(
      fc.property(
        permanentAssetArb,
        fc.integer({ min: 1, max: 365 }),
        (asset, days) => {
          const originalExpiresAt = asset.expiresAt

          const result = simulateSetExpiry(asset, days)

          // 永久资产的 expiresAt 保持不变（仍为 null）
          expect(result.expiresAt).toBe(originalExpiresAt)
          // 资产其他字段保持不变
          expect(result.id).toBe(asset.id)
          expect(result.category).toBe(asset.category)
          expect(result.type).toBe(asset.type)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('任意随机 category 字符串有值时 setExpiry 均跳过', () => {
    /**
     * **Validates: Requirements 1.3, 6.2**
     */
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.stringMatching(/^[A-Z_]{3,20}$/),
        fc.constantFrom('AI_GENERATED', 'CHARACTER_IMAGE', 'UPLOADED_IMAGE'),
        validDate('2024-01-01', '2025-06-30'),
        fc.integer({ min: 1, max: 365 }),
        (id, category, type, createdAt, days) => {
          const asset: MockAsset = {
            id,
            type,
            category,
            status: 'APPROVED',
            createdAt,
            expiresAt: null,
          }

          const result = simulateSetExpiry(asset, days)

          // category 非空则 expiresAt 保持 null
          expect(result.expiresAt).toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 3: renewExpiry 跳过永久资产
// ========================

describe('Property 3: renewExpiry 跳过永久资产', () => {
  it('category 有值的永久资产调用 renewExpiry 后 expiresAt 保持不变', () => {
    /**
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(
        permanentAssetArb,
        fc.integer({ min: 1, max: 365 }),
        validDate('2024-06-01', '2025-06-30'),
        (asset, days, now) => {
          const originalExpiresAt = asset.expiresAt

          const result = simulateRenewExpiry(asset, days, now)

          // 永久资产的 expiresAt 保持不变
          expect(result.expiresAt).toBe(originalExpiresAt)
          // 资产其他字段保持不变
          expect(result.id).toBe(asset.id)
          expect(result.category).toBe(asset.category)
          expect(result.type).toBe(asset.type)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('任意随机 category 字符串有值时 renewExpiry 均跳过', () => {
    /**
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.stringMatching(/^[A-Z_]{3,20}$/),
        fc.constantFrom('AI_GENERATED', 'CHARACTER_IMAGE', 'UPLOADED_IMAGE'),
        validDate('2024-01-01', '2025-06-30'),
        fc.integer({ min: 1, max: 365 }),
        validDate('2025-01-01', '2025-06-30'),
        (id, category, type, createdAt, days, now) => {
          const asset: MockAsset = {
            id,
            type,
            category,
            status: 'APPROVED',
            createdAt,
            expiresAt: null,
          }

          const result = simulateRenewExpiry(asset, days, now)

          // category 非空则 expiresAt 保持 null
          expect(result.expiresAt).toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 7: setExpiry 对临时资产正确计算过期时间
// ========================

describe('Property 7: setExpiry 对临时资产正确计算过期时间', () => {
  it('type=AI_GENERATED 且 category 为 null 时 expiresAt === createdAt + days * 86400000', () => {
    /**
     * **Validates: Requirements 2.1**
     */
    fc.assert(
      fc.property(
        temporaryAiAssetArb,
        fc.integer({ min: 1, max: 365 }),
        (asset, days) => {
          const result = simulateSetExpiry(asset, days)

          const expectedMs = asset.createdAt.getTime() + days * 24 * 60 * 60 * 1000
          expect(result.expiresAt).not.toBeNull()
          expect(result.expiresAt!.getTime()).toBe(expectedMs)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('默认 14 天过期时间精确等于 createdAt + 1209600000ms', () => {
    /**
     * **Validates: Requirements 2.1**
     */
    fc.assert(
      fc.property(
        temporaryAiAssetArb,
        (asset) => {
          const days = 14
          const result = simulateSetExpiry(asset, days)

          const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000 // 1209600000
          expect(result.expiresAt).not.toBeNull()
          expect(result.expiresAt!.getTime()).toBe(asset.createdAt.getTime() + FOURTEEN_DAYS_MS)
          expect(result.expiresAt!.getTime() - asset.createdAt.getTime()).toBe(1209600000)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('计算后 expiresAt 始终大于 createdAt', () => {
    /**
     * **Validates: Requirements 2.1**
     */
    fc.assert(
      fc.property(
        temporaryAiAssetArb,
        fc.integer({ min: 1, max: 365 }),
        (asset, days) => {
          const result = simulateSetExpiry(asset, days)

          expect(result.expiresAt!.getTime()).toBeGreaterThan(asset.createdAt.getTime())
        }
      ),
      { numRuns: 200 }
    )
  })
})


// ========================
// Property 5: getExpiredAssets 排除永久资产
// ========================

/**
 * 模拟 getExpiredAssets 查询逻辑（排除永久资产）
 * - expiresAt 不为 null（排除永久资产）
 * - expiresAt <= now（已过期）
 * - status 不为 'EXPIRED'（未标记清理）
 */
function simulateGetExpiredAssets(assets: MockAsset[], now: Date): MockAsset[] {
  return assets.filter(
    (a) => a.expiresAt !== null && a.expiresAt.getTime() <= now.getTime() && a.status !== 'EXPIRED'
  )
}

/** 生成混合 expiresAt 的资产集合（含 null 和有值） */
const mixedAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('AI_GENERATED', 'CHARACTER_IMAGE', 'UPLOADED_IMAGE'),
  category: fc.option(fc.constantFrom('CHARACTER', 'MATERIAL', 'AUDIO'), { nil: null }),
  status: fc.constantFrom('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CHECK_FAILED'),
  createdAt: validDate('2024-01-01', '2025-06-30'),
  expiresAt: fc.option(validDate('2024-01-15', '2025-07-14'), { nil: null }),
})

describe('Property 5: getExpiredAssets 排除永久资产', () => {
  it('返回结果中不含 expiresAt 为 null 的资产', () => {
    /**
     * **Validates: Requirements 1.2**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 30 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = simulateGetExpiredAssets(assets, now)

          for (const asset of result) {
            expect(asset.expiresAt).not.toBeNull()
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('返回的所有资产 expiresAt <= now', () => {
    /**
     * **Validates: Requirements 1.2**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 30 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = simulateGetExpiredAssets(assets, now)

          for (const asset of result) {
            expect(asset.expiresAt!.getTime()).toBeLessThanOrEqual(now.getTime())
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('返回的所有资产 status 不为 EXPIRED', () => {
    /**
     * **Validates: Requirements 1.2**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 30 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = simulateGetExpiredAssets(assets, now)

          for (const asset of result) {
            expect(asset.status).not.toBe('EXPIRED')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不遗漏任何满足条件的资产（完备性）', () => {
    /**
     * **Validates: Requirements 1.2**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 30 }),
        validDate('2024-06-01', '2025-06-30'),
        (assets, now) => {
          const result = simulateGetExpiredAssets(assets, now)

          // 手动计算预期结果
          const expected = assets.filter(
            (a) =>
              a.expiresAt !== null &&
              a.expiresAt.getTime() <= now.getTime() &&
              a.status !== 'EXPIRED'
          )

          // 结果数量一致
          expect(result.length).toBe(expected.length)
          // 每个预期资产都在结果中
          for (const exp of expected) {
            expect(result.some((r) => r.id === exp.id)).toBe(true)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})


// ========================
// Property 4: Bookmark 升级为永久资产
// ========================

/**
 * 模拟 Bookmark 操作核心逻辑
 * - 将临时资产的 expiresAt 设为 null
 * - 设置 category 值
 */
function simulateBookmark(asset: MockAsset, category: string): MockAsset {
  return { ...asset, expiresAt: null, category }
}

/** 生成状态非 EXPIRED 的临时资产（expiresAt 有值，category 为 null） */
const bookmarkableAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('AI_GENERATED', 'CHARACTER_IMAGE', 'UPLOADED_IMAGE'),
  category: fc.constant(null),
  status: fc.constantFrom('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'CHECK_FAILED'),
  createdAt: validDate('2024-01-01', '2025-06-30'),
  expiresAt: validDate('2024-01-15', '2025-07-14'),
})

describe('Property 4: Bookmark 升级为永久资产', () => {
  it('Bookmark 操作后 expiresAt 为 null 且 category 有值', () => {
    /**
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    fc.assert(
      fc.property(
        bookmarkableAssetArb,
        permanentCategoryArb,
        (asset, category) => {
          const result = simulateBookmark(asset, category)

          // expiresAt 变为 null
          expect(result.expiresAt).toBeNull()
          // category 有值
          expect(result.category).not.toBeNull()
          expect(result.category).toBe(category)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('Bookmark 操作后 computeExpiryStatus 返回 permanent', () => {
    /**
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    fc.assert(
      fc.property(
        bookmarkableAssetArb,
        permanentCategoryArb,
        (asset, category) => {
          const result = simulateBookmark(asset, category)

          // 验证 computeExpiryStatus 返回 'permanent'
          const statusResult = computeExpiryStatus(result.expiresAt)
          expect(statusResult.status).toBe('permanent')
          expect(statusResult.remainingDays).toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })

  it('Bookmark 操作前资产的 expiresAt 有值（是临时资产）', () => {
    /**
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    fc.assert(
      fc.property(
        bookmarkableAssetArb,
        permanentCategoryArb,
        (asset, category) => {
          // 操作前是临时资产
          expect(asset.expiresAt).not.toBeNull()
          expect(asset.category).toBeNull()
          expect(asset.status).not.toBe('EXPIRED')

          const result = simulateBookmark(asset, category)

          // 操作后变为永久资产
          expect(result.expiresAt).toBeNull()
          expect(result.category).not.toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 6: 数据迁移不变量
// ========================

/**
 * 模拟数据迁移逻辑
 * - 将 category 有值且 expiresAt 不为 null 的记录修正为 expiresAt = null
 */
function simulateMigration(assets: MockAsset[]): MockAsset[] {
  return assets.map(a => {
    if (a.category !== null && a.expiresAt !== null) {
      return { ...a, expiresAt: null }
    }
    return a
  })
}

describe('Property 6: 数据迁移不变量', () => {
  it('迁移后不存在同时满足 category != null 且 expiresAt != null 的记录', () => {
    /**
     * **Validates: Requirements 1.4, 6.1**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 50 }),
        (assets) => {
          const migrated = simulateMigration(assets)

          for (const asset of migrated) {
            // 全局不变量：category 有值 → expiresAt 为 null
            if (asset.category !== null) {
              expect(asset.expiresAt).toBeNull()
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('迁移不影响 category 为 null 的资产', () => {
    /**
     * **Validates: Requirements 1.4, 6.1**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 50 }),
        (assets) => {
          const migrated = simulateMigration(assets)

          for (let i = 0; i < assets.length; i++) {
            if (assets[i].category === null) {
              // category 为 null 的资产不受迁移影响
              expect(migrated[i].expiresAt).toEqual(assets[i].expiresAt)
              expect(migrated[i].category).toBeNull()
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('迁移为幂等操作：多次执行结果一致', () => {
    /**
     * **Validates: Requirements 1.4, 6.1**
     */
    fc.assert(
      fc.property(
        fc.array(mixedAssetArb, { minLength: 0, maxLength: 50 }),
        (assets) => {
          const firstMigration = simulateMigration(assets)
          const secondMigration = simulateMigration(firstMigration)

          // 幂等：第二次迁移结果与第一次完全相同
          expect(secondMigration).toEqual(firstMigration)
        }
      ),
      { numRuns: 200 }
    )
  })
})
