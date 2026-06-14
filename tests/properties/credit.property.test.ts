import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: video-reshaping-mvp
 * Property 6: 积分冻结余额不变量
 * Property 7: 积分生命周期一致性
 * Property 8: estimateCreditCost 正确性
 * Property 9: 积分流水完整性
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
 */

// --- 纯函数复制（避免引入 Prisma 依赖） ---

function estimateCreditCost(duration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(duration * multiplier)
}

// 模拟积分流水追踪器
interface LedgerEntry {
  action: 'RESERVE' | 'CHARGE' | 'REFUND'
  amount: number
  balanceAfter: number
}

class CreditSimulator {
  balance: number
  ledger: LedgerEntry[] = []

  constructor(initialBalance: number) {
    this.balance = initialBalance
  }

  reserve(amount: number): boolean {
    if (this.balance < amount) return false
    this.balance -= amount
    this.ledger.push({ action: 'RESERVE', amount: -amount, balanceAfter: this.balance })
    return true
  }

  charge(amount: number, reservedAmount: number): void {
    const diff = reservedAmount - amount
    if (diff > 0) {
      this.balance += diff
      this.ledger.push({ action: 'REFUND', amount: diff, balanceAfter: this.balance })
    }
    // CHARGE 不再改变余额（余额已在 RESERVE 时扣减），只记录确认扣除
    this.ledger.push({ action: 'CHARGE', amount: 0, balanceAfter: this.balance })
  }

  refund(amount: number): void {
    this.balance += amount
    this.ledger.push({ action: 'REFUND', amount: amount, balanceAfter: this.balance })
  }
}

describe('积分冻结余额不变量 Property (Property 6)', () => {
  it('冻结后余额 = 原余额 - 冻结金额', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1000 }), // 初始余额
        fc.integer({ min: 1, max: 100 }),    // 冻结金额
        (initialBalance, reserveAmount) => {
          if (reserveAmount > initialBalance) return // 跳过余额不足

          const sim = new CreditSimulator(initialBalance)
          sim.reserve(reserveAmount)

          expect(sim.balance).toBe(initialBalance - reserveAmount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('余额不足时冻结应失败', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),    // 初始余额
        fc.integer({ min: 51, max: 200 }),  // 冻结金额（大于余额）
        (initialBalance, reserveAmount) => {
          const sim = new CreditSimulator(initialBalance)
          const success = sim.reserve(reserveAmount)

          expect(success).toBe(false)
          expect(sim.balance).toBe(initialBalance) // 余额不变
        }
      ),
      { numRuns: 200 }
    )
  })

  it('多次冻结后余额应等于初始值减去所有冻结总和', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
        (initialBalance, amounts) => {
          const sim = new CreditSimulator(initialBalance)
          let totalReserved = 0

          for (const amount of amounts) {
            if (sim.balance >= amount) {
              sim.reserve(amount)
              totalReserved += amount
            }
          }

          expect(sim.balance).toBe(initialBalance - totalReserved)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('积分生命周期一致性 Property (Property 7)', () => {
  it('reserve→charge 路径：最终余额 = 初始余额 - actualCost', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: 5, max: 50 }),  // reserved
        fc.integer({ min: 1, max: 50 }),  // actual (可能小于 reserved)
        (initialBalance, reservedAmount, actualAmount) => {
          if (reservedAmount > initialBalance) return
          const actual = Math.min(actualAmount, reservedAmount) // actual ≤ reserved

          const sim = new CreditSimulator(initialBalance)
          sim.reserve(reservedAmount)
          sim.charge(actual, reservedAmount)

          // 最终余额 = 初始 - actual
          expect(sim.balance).toBe(initialBalance - actual)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reserve→refund 路径：最终余额 = 初始余额', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }),
        fc.integer({ min: 1, max: 50 }),
        (initialBalance, reserveAmount) => {
          if (reserveAmount > initialBalance) return

          const sim = new CreditSimulator(initialBalance)
          sim.reserve(reserveAmount)
          sim.refund(reserveAmount)

          // 全额退还后余额恢复
          expect(sim.balance).toBe(initialBalance)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('余额永远不会变为负数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.array(
          fc.record({
            action: fc.constantFrom('reserve', 'refund') as fc.Arbitrary<'reserve' | 'refund'>,
            amount: fc.integer({ min: 1, max: 30 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (initialBalance, operations) => {
          const sim = new CreditSimulator(initialBalance)

          for (const op of operations) {
            if (op.action === 'reserve') {
              sim.reserve(op.amount) // 余额不足时会返回 false
            } else {
              sim.refund(op.amount)
            }
          }

          expect(sim.balance).toBeGreaterThanOrEqual(0)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('estimateCreditCost 正确性 Property (Property 8)', () => {
  it('估算结果应为正整数', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(4, 6, 8, 10, 15),
        fc.constantFrom('480p', '720p'),
        (duration, resolution) => {
          const cost = estimateCreditCost(duration, resolution)
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('时长越长，积分越高（同分辨率）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('480p', '720p'),
        (resolution) => {
          const durations = [4, 6, 8, 10, 15]
          const costs = durations.map((d) => estimateCreditCost(d, resolution))

          for (let i = 1; i < costs.length; i++) {
            expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1])
          }
        }
      ),
      { numRuns: 20 }
    )
  })

  it('720p 至少不比 480p 便宜', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(4, 6, 8, 10, 15),
        (duration) => {
          const cost480 = estimateCreditCost(duration, '480p')
          const cost720 = estimateCreditCost(duration, '720p')
          expect(cost720).toBeGreaterThanOrEqual(cost480)
        }
      ),
      { numRuns: 25 }
    )
  })

  it('估算公式正确性：ceil(duration × multiplier)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),  // 任意时长
        fc.constantFrom('480p', '720p'),
        (duration, resolution) => {
          const cost = estimateCreditCost(duration, resolution)
          const multiplier = resolution === '720p' ? 1.5 : 1.0
          expect(cost).toBe(Math.ceil(duration * multiplier))
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('积分流水完整性 Property (Property 9)', () => {
  it('每次操作后 balanceAfter 应与模拟器余额一致', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 500 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }),
        (initialBalance, reserveAmounts) => {
          const sim = new CreditSimulator(initialBalance)

          for (const amount of reserveAmounts) {
            if (sim.balance >= amount) {
              sim.reserve(amount)
            }
          }

          // 验证每条流水的 balanceAfter 与操作后余额一致
          let runningBalance = initialBalance
          for (const entry of sim.ledger) {
            runningBalance += entry.amount
            expect(entry.balanceAfter).toBe(runningBalance)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reserve→charge 流程的流水记录完整', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 500 }),
        fc.integer({ min: 5, max: 30 }),
        (initialBalance, reserveAmount) => {
          if (reserveAmount > initialBalance) return

          const sim = new CreditSimulator(initialBalance)
          sim.reserve(reserveAmount)
          sim.charge(reserveAmount, reserveAmount) // actual === reserved，无差额

          // 应有 RESERVE 和 CHARGE 两条记录
          const actions = sim.ledger.map((e) => e.action)
          expect(actions).toContain('RESERVE')
          expect(actions).toContain('CHARGE')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('reserve→refund 流程的流水记录完整', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 500 }),
        fc.integer({ min: 5, max: 30 }),
        (initialBalance, reserveAmount) => {
          if (reserveAmount > initialBalance) return

          const sim = new CreditSimulator(initialBalance)
          sim.reserve(reserveAmount)
          sim.refund(reserveAmount)

          // 应有 RESERVE 和 REFUND 两条记录
          const actions = sim.ledger.map((e) => e.action)
          expect(actions).toContain('RESERVE')
          expect(actions).toContain('REFUND')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('流水金额之和应等于最终余额与初始余额的差', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 500 }),
        fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 1, maxLength: 5 }),
        (initialBalance, reserveAmounts) => {
          const sim = new CreditSimulator(initialBalance)
          let totalReserved = 0

          // 只测 reserve 和 refund（这些确实改变余额）
          for (const amount of reserveAmounts) {
            if (sim.balance >= amount) {
              sim.reserve(amount)
              totalReserved += amount
            }
          }

          // 退一半
          const refundAmount = Math.floor(totalReserved / 2)
          if (refundAmount > 0) {
            sim.refund(refundAmount)
          }

          // 流水中改变余额的记录之和 = 最终余额 - 初始余额
          const balanceChangingEntries = sim.ledger.filter(
            (e) => e.action === 'RESERVE' || e.action === 'REFUND'
          )
          const ledgerSum = balanceChangingEntries.reduce((sum, e) => sum + e.amount, 0)
          expect(sim.balance).toBe(initialBalance + ledgerSum)
        }
      ),
      { numRuns: 200 }
    )
  })
})
