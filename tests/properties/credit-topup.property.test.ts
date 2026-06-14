import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 5: 充值事务完整性
 * Property 6: 支付回调幂等性
 *
 * **Validates: Requirements 3.2, 3.3, 3.4**
 */

// --- 充值事务模拟器（复刻 credit-service.ts topupCredits 逻辑，避免 Prisma 依赖） ---

interface TopupLedgerEntry {
  userId: string
  orderId: string
  action: 'TOPUP'
  amount: number
  balanceAfter: number
  remark: string
}

interface UserState {
  id: string
  creditBalance: number
}

/**
 * 模拟 topupCredits 事务逻辑：
 * 1. 幂等检查：同一 orderId 只能充值一次
 * 2. 增加用户余额
 * 3. 创建 TOPUP 流水记录
 */
class TopupSimulator {
  users: Map<string, UserState> = new Map()
  ledger: TopupLedgerEntry[] = []

  constructor(userId: string, initialBalance: number) {
    this.users.set(userId, { id: userId, creditBalance: initialBalance })
  }

  getBalance(userId: string): number {
    const user = this.users.get(userId)
    if (!user) throw new Error('用户不存在')
    return user.creditBalance
  }

  /**
   * 模拟 topupCredits 方法
   * 返回充值后的新余额；幂等跳过时返回当前余额
   */
  topupCredits(userId: string, credits: number, orderId: string): number {
    // 参数校验
    if (!userId || userId.length === 0) throw new Error('用户ID不能为空')
    if (!Number.isInteger(credits) || credits <= 0) throw new Error('充值积分数必须为正整数')
    if (!orderId || orderId.length === 0) throw new Error('订单ID不能为空')

    // 幂等检查：同一 orderId 的 TOPUP 已存在则跳过
    const existingTopup = this.ledger.find(
      (entry) => entry.orderId === orderId && entry.action === 'TOPUP'
    )
    if (existingTopup) {
      // 已充值，返回当前余额
      return this.getBalance(userId)
    }

    const user = this.users.get(userId)
    if (!user) throw new Error('用户不存在')

    const newBalance = user.creditBalance + credits

    // 更新余额
    user.creditBalance = newBalance

    // 创建 TOPUP 流水记录
    this.ledger.push({
      userId,
      orderId,
      action: 'TOPUP',
      amount: credits,
      balanceAfter: newBalance,
      remark: `充值 ${credits} 积分`,
    })

    return newBalance
  }
}

// --- 支付回调模拟器（复刻 order-service.ts handlePaymentCallback 的幂等逻辑） ---

interface OrderState {
  id: string
  userId: string
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'REQUIRES_MANUAL_REVIEW'
  credits: number
  amount: number
  transactionId?: string
}

class PaymentCallbackSimulator {
  orders: Map<string, OrderState> = new Map()
  topupSim: TopupSimulator

  constructor(userId: string, initialBalance: number) {
    this.topupSim = new TopupSimulator(userId, initialBalance)
  }

  addOrder(order: OrderState) {
    this.orders.set(order.id, { ...order })
  }

  /**
   * 模拟 handlePaymentCallback 方法
   * 关键幂等逻辑：
   * - 已 PAID 的订单直接返回（不重复充值）
   * - 非 PENDING 状态无法处理
   * - PENDING 状态：更新为 PAID + 充值积分
   */
  handlePaymentCallback(orderId: string, transactionId: string, amount: number): void {
    const order = this.orders.get(orderId)
    if (!order) throw new Error('订单不存在')

    // 幂等检查：已支付则直接返回
    if (order.status === 'PAID') {
      return
    }

    // 非 PENDING 状态无法处理
    if (order.status !== 'PENDING') {
      return
    }

    // 验证金额一致性
    if (amount !== order.amount) {
      order.status = 'REQUIRES_MANUAL_REVIEW'
      order.transactionId = transactionId
      return
    }

    // 事务：更新订单状态 + 充值积分
    order.status = 'PAID'
    order.transactionId = transactionId
    this.topupSim.topupCredits(order.userId, order.credits, orderId)
  }
}

// ========================
// Property 5: 充值事务完整性
// ========================

describe('充值事务完整性 Property (Property 5)', () => {
  it('充值后用户余额增加恰好 N 积分', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),    // 初始余额
        fc.integer({ min: 1, max: 10000 }),    // 充值积分数
        fc.string({ minLength: 1, maxLength: 20 }), // orderId
        (initialBalance, credits, orderId) => {
          const sim = new TopupSimulator('user-1', initialBalance)

          sim.topupCredits('user-1', credits, `order-${orderId}`)

          expect(sim.getBalance('user-1')).toBe(initialBalance + credits)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('充值后生成 TOPUP 流水记录，amount 等于充值积分数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (initialBalance, credits, orderId) => {
          const sim = new TopupSimulator('user-1', initialBalance)
          const fullOrderId = `order-${orderId}`

          sim.topupCredits('user-1', credits, fullOrderId)

          // 应存在一条 TOPUP 流水
          const topupEntries = sim.ledger.filter(
            (e) => e.orderId === fullOrderId && e.action === 'TOPUP'
          )
          expect(topupEntries).toHaveLength(1)
          expect(topupEntries[0].amount).toBe(credits)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('充值后流水记录的 balanceAfter 等于 oldBalance + credits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (initialBalance, credits, orderId) => {
          const sim = new TopupSimulator('user-1', initialBalance)
          const fullOrderId = `order-${orderId}`

          sim.topupCredits('user-1', credits, fullOrderId)

          const topupEntry = sim.ledger.find(
            (e) => e.orderId === fullOrderId && e.action === 'TOPUP'
          )
          expect(topupEntry).toBeDefined()
          expect(topupEntry!.balanceAfter).toBe(initialBalance + credits)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('多次充值不同订单，余额等于初始余额加所有充值之和', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
        (initialBalance, creditsList) => {
          const sim = new TopupSimulator('user-1', initialBalance)

          for (let i = 0; i < creditsList.length; i++) {
            sim.topupCredits('user-1', creditsList[i], `order-${i}`)
          }

          const totalCredits = creditsList.reduce((sum, c) => sum + c, 0)
          expect(sim.getBalance('user-1')).toBe(initialBalance + totalCredits)

          // 流水记录数量应等于充值次数
          expect(sim.ledger).toHaveLength(creditsList.length)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('充值返回值等于新余额', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (initialBalance, credits, orderId) => {
          const sim = new TopupSimulator('user-1', initialBalance)

          const result = sim.topupCredits('user-1', credits, `order-${orderId}`)

          expect(result).toBe(initialBalance + credits)
          expect(result).toBe(sim.getBalance('user-1'))
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 6: 支付回调幂等性
// ========================

describe('支付回调幂等性 Property (Property 6)', () => {
  it('对同一 transactionId 重复调用 handlePaymentCallback，只充值一次', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),     // 初始余额
        fc.integer({ min: 1, max: 10000 }),     // 订单积分数
        fc.integer({ min: 100, max: 99900 }),   // 订单金额（分）
        fc.integer({ min: 2, max: 5 }),         // 重复回调次数
        (initialBalance, credits, amount, repeatCount) => {
          const sim = new PaymentCallbackSimulator('user-1', initialBalance)

          sim.addOrder({
            id: 'order-1',
            userId: 'user-1',
            status: 'PENDING',
            credits,
            amount,
          })

          // 第一次回调
          sim.handlePaymentCallback('order-1', 'txn-001', amount)

          // 记录第一次回调后的状态
          const balanceAfterFirst = sim.topupSim.getBalance('user-1')
          const ledgerCountAfterFirst = sim.topupSim.ledger.length

          // 重复回调 N 次
          for (let i = 1; i < repeatCount; i++) {
            sim.handlePaymentCallback('order-1', 'txn-001', amount)
          }

          // 余额不变
          expect(sim.topupSim.getBalance('user-1')).toBe(balanceAfterFirst)
          // 流水记录不增加
          expect(sim.topupSim.ledger.length).toBe(ledgerCountAfterFirst)
          // 订单状态仍为 PAID
          expect(sim.orders.get('order-1')!.status).toBe('PAID')
        }
      ),
      { numRuns: 200 }
    )
  })

  it('第一次回调后余额恰好增加 order.credits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 100, max: 99900 }),
        (initialBalance, credits, amount) => {
          const sim = new PaymentCallbackSimulator('user-1', initialBalance)

          sim.addOrder({
            id: 'order-1',
            userId: 'user-1',
            status: 'PENDING',
            credits,
            amount,
          })

          sim.handlePaymentCallback('order-1', 'txn-001', amount)

          expect(sim.topupSim.getBalance('user-1')).toBe(initialBalance + credits)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('重复回调不产生新的 TOPUP 流水记录', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 100, max: 99900 }),
        fc.integer({ min: 2, max: 10 }),
        (initialBalance, credits, amount, repeatCount) => {
          const sim = new PaymentCallbackSimulator('user-1', initialBalance)

          sim.addOrder({
            id: 'order-1',
            userId: 'user-1',
            status: 'PENDING',
            credits,
            amount,
          })

          // 调用 repeatCount 次
          for (let i = 0; i < repeatCount; i++) {
            sim.handlePaymentCallback('order-1', 'txn-001', amount)
          }

          // 只应有 1 条 TOPUP 记录
          const topupEntries = sim.topupSim.ledger.filter(
            (e) => e.orderId === 'order-1' && e.action === 'TOPUP'
          )
          expect(topupEntries).toHaveLength(1)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('多个不同订单各自独立充值，互不影响', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.array(
          fc.record({
            credits: fc.integer({ min: 1, max: 1000 }),
            amount: fc.integer({ min: 100, max: 99900 }),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        (initialBalance, orderSpecs) => {
          const sim = new PaymentCallbackSimulator('user-1', initialBalance)

          // 创建多个订单
          orderSpecs.forEach((spec, i) => {
            sim.addOrder({
              id: `order-${i}`,
              userId: 'user-1',
              status: 'PENDING',
              credits: spec.credits,
              amount: spec.amount,
            })
          })

          // 依次回调每个订单
          orderSpecs.forEach((spec, i) => {
            sim.handlePaymentCallback(`order-${i}`, `txn-${i}`, spec.amount)
          })

          // 总余额 = 初始 + 所有订单积分之和
          const totalCredits = orderSpecs.reduce((sum, spec) => sum + spec.credits, 0)
          expect(sim.topupSim.getBalance('user-1')).toBe(initialBalance + totalCredits)

          // 流水记录数 = 订单数
          expect(sim.topupSim.ledger).toHaveLength(orderSpecs.length)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('对已 PAID 订单的重复回调不改变任何状态', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 100, max: 99900 }),
        (initialBalance, credits, amount) => {
          const sim = new PaymentCallbackSimulator('user-1', initialBalance)

          // 创建一个已经是 PAID 的订单（模拟已处理过的订单）
          sim.addOrder({
            id: 'order-paid',
            userId: 'user-1',
            status: 'PAID',
            credits,
            amount,
            transactionId: 'txn-existing',
          })

          const balanceBefore = sim.topupSim.getBalance('user-1')
          const ledgerCountBefore = sim.topupSim.ledger.length

          // 对已 PAID 订单发送回调
          sim.handlePaymentCallback('order-paid', 'txn-existing', amount)

          // 余额不变
          expect(sim.topupSim.getBalance('user-1')).toBe(balanceBefore)
          // 无新流水
          expect(sim.topupSim.ledger.length).toBe(ledgerCountBefore)
          // 状态不变
          expect(sim.orders.get('order-paid')!.status).toBe('PAID')
        }
      ),
      { numRuns: 200 }
    )
  })
})
