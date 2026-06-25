/**
 * Property 11: 订阅额度月度重置
 *
 * - BASIC/GROWTH/AGENCY: 月初（每月 1 号 00:00:00）计数器重置为 0
 * - FREE: 计数器永不重置（终身计数）
 *
 * 测试额度检查逻辑：使用跨月日期验证重置行为。
 *
 * **Validates: Requirements 14.2, 14.3, 14.4, 14.8**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { SUBSCRIPTION_TIERS } from '@/constants/merchant'

// ========================
// 从 merchant-quota-service.ts 复现核心纯逻辑
// ========================

type MerchantTier = keyof typeof SUBSCRIPTION_TIERS

/**
 * 获取指定日期所在月份的起始时间
 * 月度重置规则：每月 1 号 00:00:00（Requirement 14.8）
 */
function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

/**
 * 获取下个月的重置日期
 */
function getNextMonthResetDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0)
}

/**
 * 判断一条记录的日期是否在指定月份的窗口内
 */
function isInCurrentMonth(recordDate: Date, referenceDate: Date): boolean {
  const monthStart = getMonthStart(referenceDate)
  return recordDate >= monthStart
}

/**
 * 模拟视频生成额度检查逻辑
 *
 * @param tier 订阅等级
 * @param allGenerationDates 所有历史生成记录的日期
 * @param currentDate 当前日期（用于计算月度窗口）
 * @returns 额度检查结果
 */
function simulateQuotaCheck(
  tier: MerchantTier,
  allGenerationDates: Date[],
  currentDate: Date
): { allowed: boolean; current: number; limit: number; resetDate?: Date } {
  const tierConfig = SUBSCRIPTION_TIERS[tier]
  const maxGenerations = tierConfig.maxGenerations
  const isLifetime = tierConfig.isLifetime

  let current: number

  if (isLifetime) {
    // FREE: 终身计数，统计所有历史记录
    current = allGenerationDates.length
  } else {
    // BASIC/GROWTH/AGENCY: 仅统计当月记录
    const monthStart = getMonthStart(currentDate)
    current = allGenerationDates.filter(d => d >= monthStart).length
  }

  const allowed = current < maxGenerations
  const result: { allowed: boolean; current: number; limit: number; resetDate?: Date } = {
    allowed,
    current,
    limit: maxGenerations,
  }

  if (!isLifetime) {
    result.resetDate = getNextMonthResetDate(currentDate)
  }

  return result
}

// ========================
// 生成器
// ========================

/** 生成非 FREE 的月度等级 */
const monthlyTierArb = fc.constantFrom<MerchantTier>('BASIC', 'GROWTH', 'AGENCY')

/** 生成所有等级 */
const allTierArb = fc.constantFrom<MerchantTier>('FREE', 'BASIC', 'GROWTH', 'AGENCY')

/** 生成合理范围的日期（2024-2026 年） */
const dateArb = fc.date({
  min: new Date(2024, 0, 1),
  max: new Date(2026, 11, 31),
})

/** 生成一组历史记录日期 */
const generationDatesArb = fc.array(dateArb, { minLength: 0, maxLength: 50 })

// ========================
// 属性测试
// ========================

describe('Property 11: 订阅额度月度重置', () => {
  it('BASIC/GROWTH/AGENCY: 月初时计数器仅统计当月记录', () => {
    fc.assert(
      fc.property(
        monthlyTierArb,
        generationDatesArb,
        dateArb,
        (tier, allDates, currentDate) => {
          const result = simulateQuotaCheck(tier, allDates, currentDate)
          const monthStart = getMonthStart(currentDate)

          // 当月记录数
          const currentMonthCount = allDates.filter(d => d >= monthStart).length
          expect(result.current).toBe(currentMonthCount)

          // 上月记录不计入当月
          const lastMonthDates = allDates.filter(d => d < monthStart)
          if (lastMonthDates.length > 0 && currentMonthCount === 0) {
            // 有上月记录但当月为空 → current 应为 0
            expect(result.current).toBe(0)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('FREE: 终身计数，所有历史记录都算', () => {
    fc.assert(
      fc.property(generationDatesArb, dateArb, (allDates, currentDate) => {
        const result = simulateQuotaCheck('FREE', allDates, currentDate)

        // FREE 等级统计所有记录，不区分月份
        expect(result.current).toBe(allDates.length)
        // FREE 等级不提供重置日期
        expect(result.resetDate).toBeUndefined()
      }),
      { numRuns: 100 }
    )
  })

  it('月度等级在月份切换后计数器归零', () => {
    fc.assert(
      fc.property(
        monthlyTierArb,
        fc.integer({ min: 1, max: 30 }),
        (tier, generationsInOldMonth) => {
          // 模拟场景：上个月有若干生成记录
          const lastMonth = new Date(2025, 4, 15) // 2025 年 5 月
          const thisMonth = new Date(2025, 5, 1)  // 2025 年 6 月 1 日（月初）

          // 生成上个月的记录
          const oldDates: Date[] = []
          for (let i = 0; i < generationsInOldMonth; i++) {
            oldDates.push(new Date(2025, 4, Math.min(i + 1, 28)))
          }

          // 在新月份检查额度
          const result = simulateQuotaCheck(tier, oldDates, thisMonth)

          // 所有上月记录不计入 → 当月计数为 0
          expect(result.current).toBe(0)
          expect(result.allowed).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('月度等级有 resetDate，FREE 没有', () => {
    fc.assert(
      fc.property(allTierArb, dateArb, (tier, currentDate) => {
        const result = simulateQuotaCheck(tier, [], currentDate)
        const tierConfig = SUBSCRIPTION_TIERS[tier]

        if (tierConfig.isLifetime) {
          expect(result.resetDate).toBeUndefined()
        } else {
          expect(result.resetDate).toBeDefined()
          // resetDate 应为下月 1 号
          const expectedReset = getNextMonthResetDate(currentDate)
          expect(result.resetDate!.getTime()).toBe(expectedReset.getTime())
        }
      }),
      { numRuns: 100 }
    )
  })

  it('额度用完时 allowed = false', () => {
    fc.assert(
      fc.property(allTierArb, (tier) => {
        const tierConfig = SUBSCRIPTION_TIERS[tier]
        const maxGenerations = tierConfig.maxGenerations
        const currentDate = new Date(2025, 5, 15)

        // 生成恰好达到上限数量的当月记录
        const dates: Date[] = []
        for (let i = 0; i < maxGenerations; i++) {
          dates.push(new Date(2025, 5, Math.min(i + 1, 28)))
        }

        const result = simulateQuotaCheck(tier, dates, currentDate)
        expect(result.allowed).toBe(false)
        expect(result.current).toBe(maxGenerations)
      }),
      { numRuns: 100 }
    )
  })

  it('额度未用完时 allowed = true', () => {
    fc.assert(
      fc.property(allTierArb, (tier) => {
        const tierConfig = SUBSCRIPTION_TIERS[tier]
        const maxGenerations = tierConfig.maxGenerations
        const currentDate = new Date(2025, 5, 15)

        // 生成低于上限的当月记录（至少留 1 个余量）
        const count = Math.max(0, maxGenerations - 1)
        const dates: Date[] = []
        for (let i = 0; i < count; i++) {
          dates.push(new Date(2025, 5, Math.min(i + 1, 28)))
        }

        const result = simulateQuotaCheck(tier, dates, currentDate)
        expect(result.allowed).toBe(true)
      }),
      { numRuns: 100 }
    )
  })
})
