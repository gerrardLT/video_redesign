import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * 属性测试：privilege-engine + priority-scheduler
 *
 * 验证用户等级（FREE/MONTHLY/YEARLY）→ 并发限额、队列优先级、升级建议等核心映射逻辑。
 * 纯函数测试，不依赖数据库或 Redis。
 *
 * **Validates: Requirements 11.1, 11.2**
 */

import {
  getConcurrencyConfig,
  determineTier,
  determinePrivileges,
  determineMerchantPrivileges,
} from '@/lib/shared/privilege-engine'
import { getQueuePriority } from '@/lib/shared/priority-scheduler'
import {
  type UserTier,
  CONCURRENCY_LIMITS,
  QUEUE_PRIORITIES,
} from '@/constants/concurrency'

// ========================
// 辅助 Arbitrary
// ========================

/** 合法用户等级生成器 */
const arbTier = fc.constantFrom<UserTier>('FREE', 'MONTHLY', 'YEARLY')

/** 等级对比对（低→高）生成器 */
const arbTierPairAscending = fc.constantFrom<[UserTier, UserTier]>(
  ['FREE', 'MONTHLY'],
  ['FREE', 'YEARLY'],
  ['MONTHLY', 'YEARLY']
)

/** 升级路径映射（纯数据，与 concurrency-controller 内部一致） */
const TIER_UPGRADE_PATH: Record<UserTier, UserTier | null> = {
  FREE: 'MONTHLY',
  MONTHLY: 'YEARLY',
  YEARLY: null,
}

// ========================
// Property 1: 层级单调性
// ========================

describe('Property 1: 层级单调性 — 更高等级的并发限额 >= 更低等级', () => {
  it('parse/generate/merge 限额随等级递增', () => {
    fc.assert(
      fc.property(arbTierPairAscending, ([lowerTier, higherTier]) => {
        const lower = getConcurrencyConfig(lowerTier)
        const higher = getConcurrencyConfig(higherTier)

        expect(higher.parse).toBeGreaterThanOrEqual(lower.parse)
        expect(higher.generate).toBeGreaterThanOrEqual(lower.generate)
        expect(higher.merge).toBeGreaterThanOrEqual(lower.merge)
      }),
      { numRuns: 100 }
    )
  })

  it('determinePrivileges 返回的 concurrency 也满足单调性', () => {
    fc.assert(
      fc.property(arbTierPairAscending, ([lowerTier, higherTier]) => {
        const lower = determinePrivileges(lowerTier).concurrency
        const higher = determinePrivileges(higherTier).concurrency

        expect(higher.parse).toBeGreaterThanOrEqual(lower.parse)
        expect(higher.generate).toBeGreaterThanOrEqual(lower.generate)
        expect(higher.merge).toBeGreaterThanOrEqual(lower.merge)
      }),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 2: 优先级单调性
// ========================

describe('Property 2: 优先级单调性 — 更高等级的优先级值更低（BullMQ 值越小越优先）', () => {
  it('getQueuePriority: 高等级数值 <= 低等级数值', () => {
    fc.assert(
      fc.property(arbTierPairAscending, ([lowerTier, higherTier]) => {
        const lowerPriority = getQueuePriority(lowerTier)
        const higherPriority = getQueuePriority(higherTier)

        // BullMQ: 数值越小 → 优先级越高
        expect(higherPriority).toBeLessThanOrEqual(lowerPriority)
      }),
      { numRuns: 100 }
    )
  })

  it('determinePrivileges 返回的 queuePriority 也满足单调性', () => {
    fc.assert(
      fc.property(arbTierPairAscending, ([lowerTier, higherTier]) => {
        const lowerP = determinePrivileges(lowerTier).queuePriority
        const higherP = determinePrivileges(higherTier).queuePriority

        expect(higherP).toBeLessThanOrEqual(lowerP)
      }),
      { numRuns: 100 }
    )
  })

  it('getQueuePriority 与 QUEUE_PRIORITIES 常量表一致', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        expect(getQueuePriority(tier)).toBe(QUEUE_PRIORITIES[tier])
      }),
      { numRuns: 50 }
    )
  })
})

// ========================
// Property 3: 所有等级有效
// ========================

describe('Property 3: 所有等级有效 — 任意合法等级输入都返回有效配置', () => {
  it('getConcurrencyConfig 返回有效对象（不 undefined、不 NaN）', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const config = getConcurrencyConfig(tier)

        expect(config).toBeDefined()
        expect(config.parse).not.toBeNaN()
        expect(config.generate).not.toBeNaN()
        expect(config.merge).not.toBeNaN()
        expect(Number.isFinite(config.parse)).toBe(true)
        expect(Number.isFinite(config.generate)).toBe(true)
        expect(Number.isFinite(config.merge)).toBe(true)
      }),
      { numRuns: 50 }
    )
  })

  it('getQueuePriority 返回有效正整数', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const priority = getQueuePriority(tier)

        expect(priority).toBeDefined()
        expect(priority).not.toBeNaN()
        expect(Number.isFinite(priority)).toBe(true)
        expect(priority).toBeGreaterThan(0)
        expect(Number.isInteger(priority)).toBe(true)
      }),
      { numRuns: 50 }
    )
  })

  it('determinePrivileges 返回完整有效配置', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const p = determinePrivileges(tier)

        expect(p).toBeDefined()
        expect(p.tier).toBe(tier)
        expect(p.queuePriority).toBeGreaterThan(0)
        expect(p.allowedResolutions.length).toBeGreaterThan(0)
        expect(typeof p.watermarkEnabled).toBe('boolean')
        expect(p.historyRetentionDays).toBeGreaterThan(0)
        expect(typeof p.isActiveMember).toBe('boolean')
        expect(p.concurrency).toBeDefined()
      }),
      { numRuns: 50 }
    )
  })

  it('determineTier 对所有合法输入组合返回合法等级', () => {
    const arbStatus = fc.constantFrom('ACTIVE', 'CANCELED', 'EXPIRED', null)
    const arbPlanType = fc.constantFrom('monthly', 'yearly', null)

    fc.assert(
      fc.property(arbStatus, arbPlanType, (status, planType) => {
        const tier = determineTier(status, planType)

        expect(['FREE', 'MONTHLY', 'YEARLY']).toContain(tier)
      }),
      { numRuns: 100 }
    )
  })

  it('determineMerchantPrivileges 返回有效商家权益', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const mp = determineMerchantPrivileges(tier)

        expect(mp).toBeDefined()
        expect(mp.tier).toBe(tier)
        expect(['720p', '1080p']).toContain(mp.exportResolution)
        expect(typeof mp.complianceCheckEnabled).toBe('boolean')
        expect(typeof mp.insightsEnabled).toBe('boolean')
        expect(mp.maxStores).toBeGreaterThan(0)
        expect(mp.batchConcurrency).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })
})

// ========================
// Property 4: 升级建议正确
// ========================

describe('Property 4: 升级建议正确 — FREE→MONTHLY, MONTHLY→YEARLY', () => {
  it('FREE 的下一级是 MONTHLY', () => {
    fc.assert(
      fc.property(fc.constant('FREE' as UserTier), (tier) => {
        expect(TIER_UPGRADE_PATH[tier]).toBe('MONTHLY')
      }),
      { numRuns: 10 }
    )
  })

  it('MONTHLY 的下一级是 YEARLY', () => {
    fc.assert(
      fc.property(fc.constant('MONTHLY' as UserTier), (tier) => {
        expect(TIER_UPGRADE_PATH[tier]).toBe('YEARLY')
      }),
      { numRuns: 10 }
    )
  })

  it('升级后等级的并发限额严格高于当前等级', () => {
    const arbUpgradableTier = fc.constantFrom<UserTier>('FREE', 'MONTHLY')

    fc.assert(
      fc.property(arbUpgradableTier, (currentTier) => {
        const nextTier = TIER_UPGRADE_PATH[currentTier]!
        const currentConfig = getConcurrencyConfig(currentTier)
        const nextConfig = getConcurrencyConfig(nextTier)

        // 升级后至少有一项限额严格大于当前
        const hasImprovement =
          nextConfig.parse > currentConfig.parse ||
          nextConfig.generate > currentConfig.generate ||
          nextConfig.merge > currentConfig.merge

        expect(hasImprovement).toBe(true)
      }),
      { numRuns: 50 }
    )
  })

  it('升级后队列优先级更高（数值更小）', () => {
    const arbUpgradableTier = fc.constantFrom<UserTier>('FREE', 'MONTHLY')

    fc.assert(
      fc.property(arbUpgradableTier, (currentTier) => {
        const nextTier = TIER_UPGRADE_PATH[currentTier]!
        const currentPriority = getQueuePriority(currentTier)
        const nextPriority = getQueuePriority(nextTier)

        expect(nextPriority).toBeLessThan(currentPriority)
      }),
      { numRuns: 50 }
    )
  })
})

// ========================
// Property 5: 最高等级无升级
// ========================

describe('Property 5: 最高等级无升级 — YEARLY 不应有 nextTier', () => {
  it('YEARLY 的升级路径为 null', () => {
    fc.assert(
      fc.property(fc.constant('YEARLY' as UserTier), (tier) => {
        expect(TIER_UPGRADE_PATH[tier]).toBeNull()
      }),
      { numRuns: 10 }
    )
  })

  it('YEARLY 已拥有最高并发限额', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const yearlyConfig = getConcurrencyConfig('YEARLY')
        const currentConfig = getConcurrencyConfig(tier)

        expect(yearlyConfig.parse).toBeGreaterThanOrEqual(currentConfig.parse)
        expect(yearlyConfig.generate).toBeGreaterThanOrEqual(currentConfig.generate)
        expect(yearlyConfig.merge).toBeGreaterThanOrEqual(currentConfig.merge)
      }),
      { numRuns: 50 }
    )
  })

  it('YEARLY 已拥有最高队列优先级（最小值）', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const yearlyPriority = getQueuePriority('YEARLY')
        const currentPriority = getQueuePriority(tier)

        expect(yearlyPriority).toBeLessThanOrEqual(currentPriority)
      }),
      { numRuns: 50 }
    )
  })
})

// ========================
// Property 6: 并发限额 > 0
// ========================

describe('Property 6: 并发限额 > 0 — 任何等级的 parse/generate/merge 限额都 > 0', () => {
  it('getConcurrencyConfig 所有字段 > 0', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const config = getConcurrencyConfig(tier)

        expect(config.parse).toBeGreaterThan(0)
        expect(config.generate).toBeGreaterThan(0)
        expect(config.merge).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })

  it('CONCURRENCY_LIMITS 常量表所有值 > 0', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const config = CONCURRENCY_LIMITS[tier]

        expect(config.parse).toBeGreaterThan(0)
        expect(config.generate).toBeGreaterThan(0)
        expect(config.merge).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })

  it('determinePrivileges 返回的并发限额 > 0', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const { concurrency } = determinePrivileges(tier)

        expect(concurrency.parse).toBeGreaterThan(0)
        expect(concurrency.generate).toBeGreaterThan(0)
        expect(concurrency.merge).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })

  it('determineMerchantPrivileges 的 batchConcurrency > 0', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const mp = determineMerchantPrivileges(tier)

        expect(mp.batchConcurrency).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })
})
