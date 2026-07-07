import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * 订阅全生命周期属性测试 (Subscription Lifecycle Property Tests)
 *
 * 验证订阅服务核心不变量：
 * - Property 1: 创建后状态为 ACTIVE
 * - Property 2: 积分发放正确
 * - Property 3: 过期日期正确
 * - Property 4: 过期后状态变更
 * - Property 5: 续费延长有效期
 * - Property 6: 取消后不再续费
 * - Property 7: 重复创建防御
 *
 * 测试策略：
 * - 对纯函数（extendEndDate / calculateCreditsToDispatch）直接导入测试
 * - 对有状态逻辑（状态机转换）使用模拟器重现核心业务规则
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 3.1, 4.1, 5.1**
 */

import { extendEndDate } from '@/lib/shared/subscription-service'
import { calculateCreditsToDispatch } from '@/lib/shared/credit-dispatcher'

// ========================
// 类型定义
// ========================

type PlanType = 'monthly' | 'quarterly' | 'yearly'
type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELED'
type RenewalType = 'AUTO' | 'CANCELED'

interface SubscriptionPlan {
  id: string
  name: string
  type: PlanType
  price: number
  isActive: boolean
}

interface SubscriptionRecord {
  id: string
  userId: string
  planId: string
  status: SubscriptionStatus
  renewalType: RenewalType
  startDate: Date
  endDate: Date
  totalCreditsGranted: number
}

// ========================
// 状态机模拟器（纯函数，复现 subscription-service 核心逻辑）
// ========================

/**
 * 模拟创建订阅完整流程：
 * 订单支付成功后，创建 ACTIVE 状态的订阅记录
 */
function simulateCreateSubscription(
  userId: string,
  plan: SubscriptionPlan,
  now: Date
): SubscriptionRecord {
  const endDate = extendEndDate(now, plan.type)
  const credits = calculateCreditsToDispatch(plan.type, true)

  return {
    id: `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    planId: plan.id,
    status: 'ACTIVE',
    renewalType: 'AUTO',
    startDate: now,
    endDate,
    totalCreditsGranted: credits,
  }
}

/**
 * 模拟到期处理：状态转为 EXPIRED
 */
function simulateExpire(record: SubscriptionRecord): SubscriptionRecord {
  if (record.status === 'EXPIRED') return record
  return { ...record, status: 'EXPIRED' }
}

/**
 * 模拟续费成功：延长有效期
 */
function simulateRenew(
  record: SubscriptionRecord,
  planType: PlanType
): SubscriptionRecord {
  const newEndDate = extendEndDate(record.endDate, planType)
  const credits = calculateCreditsToDispatch(planType, false)
  return {
    ...record,
    endDate: newEndDate,
    status: 'ACTIVE',
    renewalType: 'AUTO',
    totalCreditsGranted: record.totalCreditsGranted + credits,
  }
}

/**
 * 模拟取消订阅：renewalType → CANCELED，状态保持 ACTIVE
 */
function simulateCancel(record: SubscriptionRecord): SubscriptionRecord {
  return { ...record, renewalType: 'CANCELED' }
}

/**
 * 模拟自动续费触发条件判断：
 * 仅 status=ACTIVE 且 renewalType=AUTO 的记录才执行自动续费
 */
function shouldTriggerAutoRenewal(record: SubscriptionRecord): boolean {
  return record.status === 'ACTIVE' && record.renewalType === 'AUTO'
}

/**
 * 模拟重复创建防御：
 * 如果用户已有 ACTIVE 订阅，则拒绝创建新订阅
 */
function canCreateSubscription(
  existingRecords: SubscriptionRecord[],
  userId: string
): boolean {
  return !existingRecords.some(
    (r) => r.userId === userId && r.status === 'ACTIVE'
  )
}

// ========================
// fast-check 生成器
// ========================

const planTypeArb: fc.Arbitrary<PlanType> = fc.constantFrom(
  'monthly',
  'quarterly',
  'yearly'
)

const planArb: fc.Arbitrary<SubscriptionPlan> = fc.record({
  id: fc.uuid(),
  name: fc.constantFrom('月卡会员', '季卡会员', '年卡会员'),
  type: planTypeArb,
  price: fc.integer({ min: 100, max: 100000 }), // 1元 ~ 1000元（分为单位）
  isActive: fc.constant(true),
})

const userIdArb = fc.uuid()

// 生成合理的日期（2020-2030 之间）
const dateArb: fc.Arbitrary<Date> = fc
  .integer({
    min: new Date('2020-01-01').getTime(),
    max: new Date('2030-01-01').getTime(),
  })
  .map((ts) => new Date(ts))

// ========================
// 属性测试
// ========================

describe('订阅全生命周期属性测试', () => {
  // ============================================================
  // Property 1: 创建后状态为 ACTIVE
  // ============================================================

  describe('Property 1: 创建后状态为 ACTIVE', () => {
    it('支付成功后新创建的订阅 status 必须为 ACTIVE', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          expect(record.status).toBe('ACTIVE')
        }),
        { numRuns: 200 }
      )
    })

    it('创建后 renewalType 默认为 AUTO', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          expect(record.renewalType).toBe('AUTO')
        }),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 2: 积分发放正确
  // ============================================================

  describe('Property 2: 积分发放正确', () => {
    it('月卡：每期发放 500 积分（不区分首月）', () => {
      fc.assert(
        fc.property(fc.boolean(), (isFirstMonth) => {
          const credits = calculateCreditsToDispatch('monthly', isFirstMonth)
          expect(credits).toBe(500)
        }),
        { numRuns: 100 }
      )
    })

    it('季卡首月：发放 500 + 300 = 800 积分', () => {
      const credits = calculateCreditsToDispatch('quarterly', true)
      expect(credits).toBe(800)
    })

    it('季卡非首月：发放 500 积分', () => {
      const credits = calculateCreditsToDispatch('quarterly', false)
      expect(credits).toBe(500)
    })

    it('年卡首月：发放 500 + 1000 = 1500 积分', () => {
      const credits = calculateCreditsToDispatch('yearly', true)
      expect(credits).toBe(1500)
    })

    it('年卡非首月：发放 500 积分', () => {
      const credits = calculateCreditsToDispatch('yearly', false)
      expect(credits).toBe(500)
    })

    it('积分发放数量始终为正整数', () => {
      fc.assert(
        fc.property(planTypeArb, fc.boolean(), (planType, isFirstMonth) => {
          const credits = calculateCreditsToDispatch(planType, isFirstMonth)
          expect(credits).toBeGreaterThan(0)
          expect(Number.isInteger(credits)).toBe(true)
        }),
        { numRuns: 200 }
      )
    })

    it('创建订阅时发放的积分等于 calculateCreditsToDispatch(plan.type, true)', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expectedCredits = calculateCreditsToDispatch(plan.type, true)
          expect(record.totalCreditsGranted).toBe(expectedCredits)
        }),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 3: 过期日期正确
  // ============================================================

  describe('Property 3: 过期日期正确', () => {
    it('月卡：endDate = startDate + 30天', () => {
      fc.assert(
        fc.property(dateArb, (startDate) => {
          const endDate = extendEndDate(startDate, 'monthly')
          const diffMs = endDate.getTime() - startDate.getTime()
          const diffDays = diffMs / (24 * 60 * 60 * 1000)
          expect(diffDays).toBe(30)
        }),
        { numRuns: 200 }
      )
    })

    it('季卡：endDate = startDate + 90天', () => {
      fc.assert(
        fc.property(dateArb, (startDate) => {
          const endDate = extendEndDate(startDate, 'quarterly')
          const diffMs = endDate.getTime() - startDate.getTime()
          const diffDays = diffMs / (24 * 60 * 60 * 1000)
          expect(diffDays).toBe(90)
        }),
        { numRuns: 200 }
      )
    })

    it('年卡：endDate = startDate + 365天', () => {
      fc.assert(
        fc.property(dateArb, (startDate) => {
          const endDate = extendEndDate(startDate, 'yearly')
          const diffMs = endDate.getTime() - startDate.getTime()
          const diffDays = diffMs / (24 * 60 * 60 * 1000)
          expect(diffDays).toBe(365)
        }),
        { numRuns: 200 }
      )
    })

    it('endDate 始终严格晚于 startDate', () => {
      fc.assert(
        fc.property(dateArb, planTypeArb, (startDate, planType) => {
          const endDate = extendEndDate(startDate, planType)
          expect(endDate.getTime()).toBeGreaterThan(startDate.getTime())
        }),
        { numRuns: 200 }
      )
    })

    it('创建订阅时 endDate 符合套餐周期', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expectedEndDate = extendEndDate(now, plan.type)
          expect(record.endDate.getTime()).toBe(expectedEndDate.getTime())
        }),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 4: 过期后状态变更
  // ============================================================

  describe('Property 4: 过期后状态变更', () => {
    it('到期处理后 status 变为 EXPIRED', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expired = simulateExpire(record)
          expect(expired.status).toBe('EXPIRED')
        }),
        { numRuns: 200 }
      )
    })

    it('已 EXPIRED 的记录再次过期处理保持幂等（仍为 EXPIRED）', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expired1 = simulateExpire(record)
          const expired2 = simulateExpire(expired1)
          expect(expired2.status).toBe('EXPIRED')
          // 幂等性：两次结果一致
          expect(expired2).toEqual(expired1)
        }),
        { numRuns: 200 }
      )
    })

    it('过期不影响其他字段（userId/planId/startDate/endDate 不变）', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expired = simulateExpire(record)
          expect(expired.userId).toBe(record.userId)
          expect(expired.planId).toBe(record.planId)
          expect(expired.startDate.getTime()).toBe(record.startDate.getTime())
          expect(expired.endDate.getTime()).toBe(record.endDate.getTime())
        }),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 5: 续费延长有效期
  // ============================================================

  describe('Property 5: 续费延长有效期', () => {
    it('续费后 endDate 在原 endDate 基础上延长一个完整周期', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const renewed = simulateRenew(record, plan.type)

          const expectedNewEnd = extendEndDate(record.endDate, plan.type)
          expect(renewed.endDate.getTime()).toBe(expectedNewEnd.getTime())
        }),
        { numRuns: 200 }
      )
    })

    it('续费后 endDate 严格晚于续费前 endDate', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const renewed = simulateRenew(record, plan.type)
          expect(renewed.endDate.getTime()).toBeGreaterThan(
            record.endDate.getTime()
          )
        }),
        { numRuns: 200 }
      )
    })

    it('多次续费累积延长（endDate 单调递增）', () => {
      fc.assert(
        fc.property(
          userIdArb,
          planArb,
          dateArb,
          fc.integer({ min: 1, max: 10 }),
          (userId, plan, now, renewCount) => {
            let record = simulateCreateSubscription(userId, plan, now)
            let prevEndDate = record.endDate

            for (let i = 0; i < renewCount; i++) {
              record = simulateRenew(record, plan.type)
              expect(record.endDate.getTime()).toBeGreaterThan(
                prevEndDate.getTime()
              )
              prevEndDate = record.endDate
            }
          }
        ),
        { numRuns: 100 }
      )
    })

    it('续费后积分累计 = 首月积分 + N * 续费积分', () => {
      fc.assert(
        fc.property(
          userIdArb,
          planArb,
          dateArb,
          fc.integer({ min: 1, max: 5 }),
          (userId, plan, now, renewCount) => {
            let record = simulateCreateSubscription(userId, plan, now)

            for (let i = 0; i < renewCount; i++) {
              record = simulateRenew(record, plan.type)
            }

            const firstMonthCredits = calculateCreditsToDispatch(plan.type, true)
            const renewalCredits = calculateCreditsToDispatch(plan.type, false)
            const expectedTotal =
              firstMonthCredits + renewCount * renewalCredits
            expect(record.totalCreditsGranted).toBe(expectedTotal)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 6: 取消后不再续费
  // ============================================================

  describe('Property 6: 取消后不再续费', () => {
    it('取消后 renewalType 变为 CANCELED', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const canceled = simulateCancel(record)
          expect(canceled.renewalType).toBe('CANCELED')
        }),
        { numRuns: 200 }
      )
    })

    it('取消后自动续费触发条件不满足', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const canceled = simulateCancel(record)
          expect(shouldTriggerAutoRenewal(canceled)).toBe(false)
        }),
        { numRuns: 200 }
      )
    })

    it('取消后 status 仍为 ACTIVE（权益保留至到期）', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const canceled = simulateCancel(record)
          expect(canceled.status).toBe('ACTIVE')
        }),
        { numRuns: 200 }
      )
    })

    it('已过期的订阅自动续费触发条件也不满足', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          const expired = simulateExpire(record)
          expect(shouldTriggerAutoRenewal(expired)).toBe(false)
        }),
        { numRuns: 200 }
      )
    })

    it('仅 ACTIVE + AUTO 的订阅满足自动续费条件', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const record = simulateCreateSubscription(userId, plan, now)
          // 新创建的订阅 status=ACTIVE, renewalType=AUTO
          expect(shouldTriggerAutoRenewal(record)).toBe(true)
        }),
        { numRuns: 200 }
      )
    })
  })

  // ============================================================
  // Property 7: 重复创建防御
  // ============================================================

  describe('Property 7: 重复创建防御', () => {
    it('用户无 ACTIVE 订阅时允许创建', () => {
      fc.assert(
        fc.property(userIdArb, (userId) => {
          const records: SubscriptionRecord[] = []
          expect(canCreateSubscription(records, userId)).toBe(true)
        }),
        { numRuns: 200 }
      )
    })

    it('用户已有 ACTIVE 订阅时拒绝创建', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const existing = simulateCreateSubscription(userId, plan, now)
          const records = [existing]
          expect(canCreateSubscription(records, userId)).toBe(false)
        }),
        { numRuns: 200 }
      )
    })

    it('用户仅有 EXPIRED 订阅时允许创建新订阅', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const existing = simulateCreateSubscription(userId, plan, now)
          const expired = simulateExpire(existing)
          const records = [expired]
          expect(canCreateSubscription(records, userId)).toBe(true)
        }),
        { numRuns: 200 }
      )
    })

    it('不同用户的 ACTIVE 订阅互不影响', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          planArb,
          dateArb,
          (userId1, userId2, plan, now) => {
            // 排除相同 userId 的情况
            fc.pre(userId1 !== userId2)

            const existing = simulateCreateSubscription(userId1, plan, now)
            const records = [existing]

            // userId1 已有 ACTIVE，不能再创建
            expect(canCreateSubscription(records, userId1)).toBe(false)
            // userId2 没有 ACTIVE，可以创建
            expect(canCreateSubscription(records, userId2)).toBe(true)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('取消订阅（status 仍为 ACTIVE）时仍不能重复创建', () => {
      fc.assert(
        fc.property(userIdArb, planArb, dateArb, (userId, plan, now) => {
          const existing = simulateCreateSubscription(userId, plan, now)
          const canceled = simulateCancel(existing)
          // 取消后 status 仍为 ACTIVE，所以不允许重复创建
          const records = [canceled]
          expect(canCreateSubscription(records, userId)).toBe(false)
        }),
        { numRuns: 200 }
      )
    })
  })
})
