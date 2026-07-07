/**
 * 积分服务 RESERVE/CHARGE/REFUND 完整流程属性测试
 *
 * 覆盖属性：
 * 1. RESERVE 属性：余额充足时 balanceAfter = B - N
 * 2. RESERVE 余额不足：余额 B < N 时抛错，余额不变
 * 3. CHARGE 属性：有 RESERVE 时 CHARGE 成功，记录流水
 * 4. CHARGE 超额：无 RESERVE 且余额不足时拒绝
 * 5. REFUND 属性：REFUND 后余额 = 原余额 + REFUND 金额
 * 6. RESERVE + CHARGE + REFUND 原子性：完整流程后余额一致性
 * 7. 幂等性：相同 jobId 的 RESERVE 不应重复扣费
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ========================
// Mock 层：模拟 Prisma + Redis 分布式锁
// ========================

/**
 * 内存数据库模拟器
 * 模拟 Prisma 的 user 和 creditLedger 表行为
 */
interface MockUser {
  id: string
  creditBalance: number
}

interface MockLedgerEntry {
  id: string
  userId: string
  jobId: string | null
  projectId: string | null
  orderId: string | null
  bizRefType: string | null
  bizRefId: string | null
  action: string
  amount: number
  balanceAfter: number
  remark: string
}

let mockUsers: Map<string, MockUser> = new Map()
let mockLedger: MockLedgerEntry[] = []
let ledgerIdCounter = 0

function resetMockDb() {
  mockUsers = new Map()
  mockLedger = []
  ledgerIdCounter = 0
}

function createMockUser(id: string, balance: number) {
  mockUsers.set(id, { id, creditBalance: balance })
}

/**
 * 构造 Prisma 事务客户端 mock
 * 共享全局 mockUsers / mockLedger 状态
 */
function createMockTx() {
  return {
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = mockUsers.get(where.id)
        if (!user) throw new Error(`User ${where.id} not found`)
        return { ...user }
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MockUser> }) => {
        const user = mockUsers.get(where.id)
        if (!user) throw new Error(`User ${where.id} not found`)
        if (data.creditBalance !== undefined) {
          user.creditBalance = data.creditBalance
        }
        return { ...user }
      },
    },
    creditLedger: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return mockLedger.find((entry) => {
          // 匹配所有 where 中非 undefined 的字段
          if (where.jobId !== undefined && entry.jobId !== where.jobId) return false
          if (where.projectId !== undefined && entry.projectId !== where.projectId) return false
          if (where.bizRefType !== undefined && entry.bizRefType !== where.bizRefType) return false
          if (where.bizRefId !== undefined && entry.bizRefId !== where.bizRefId) return false
          if (where.action !== undefined && entry.action !== where.action) return false
          if (where.orderId !== undefined && entry.orderId !== where.orderId) return false
          return true
        }) || null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry: MockLedgerEntry = {
          id: `ledger-${++ledgerIdCounter}`,
          userId: data.userId as string,
          jobId: (data.jobId as string) || null,
          projectId: (data.projectId as string) || null,
          orderId: (data.orderId as string) || null,
          bizRefType: (data.bizRefType as string) || null,
          bizRefId: (data.bizRefId as string) || null,
          action: data.action as string,
          amount: data.amount as number,
          balanceAfter: data.balanceAfter as number,
          remark: (data.remark as string) || '',
        }
        mockLedger.push(entry)
        return entry
      },
    },
  }
}

// Mock @/lib/shared/db - prisma.$transaction 调用回调并传入 mock tx
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    $transaction: async (fn: (tx: ReturnType<typeof createMockTx>) => Promise<unknown>) => {
      const tx = createMockTx()
      return fn(tx)
    },
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = mockUsers.get(where.id)
        if (!user) throw new Error(`User ${where.id} not found`)
        return { ...user }
      },
    },
  },
}))

// Mock @/lib/shared/distributed-lock：withCreditLock 直接执行 fn（绕过 Redis）
vi.mock('@/lib/shared/distributed-lock', () => ({
  withCreditLock: async (fn: () => Promise<unknown>, _label?: string) => fn(),
}))

// Mock @/lib/shared/api-error
vi.mock('@/lib/shared/api-error', () => ({
  ApiError: class ApiError extends Error {
    code: string
    statusCode: number
    constructor(code: string, message: string, statusCode = 400) {
      super(message)
      this.code = code
      this.statusCode = statusCode
      this.name = 'ApiError'
    }
  },
}))

// Mock redis（避免真实连接）
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => () => Promise.resolve(null) }),
}))

// 延迟导入（mock 生效后）
import { reserveCredits, chargeCredits, refundCredits } from '@/lib/shared/credit-service'

// ========================
// 属性测试
// ========================

describe('credit-service RESERVE/CHARGE/REFUND 流程属性测试', () => {
  beforeEach(() => {
    resetMockDb()
  })

  // ========================
  // Property 1: RESERVE 属性
  // ========================
  describe('Property 1: RESERVE 属性 - 余额充足时 balanceAfter = B - N', () => {
    /**
     * **Validates: Requirements 11.1**
     * 对任意正整数金额 N 和余额 B >= N，冻结后 balanceAfter = B - N
     */
    it('冻结后用户余额正确扣减', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10000 }),  // 冻结金额 N
          fc.integer({ min: 0, max: 10000 }),  // 额外余额 surplus
          async (amount, surplus) => {
            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-reserve-${amount}-${surplus}`
            const balance = amount + surplus  // 确保 B >= N
            createMockUser(userId, balance)

            await reserveCredits(userId, jobId, amount)

            const user = mockUsers.get(userId)!
            expect(user.creditBalance).toBe(balance - amount)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('冻结后写入 RESERVE 流水，balanceAfter 与实际余额一致', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 0, max: 5000 }),
          async (amount, surplus) => {
            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-ledger-${amount}-${surplus}`
            const balance = amount + surplus
            createMockUser(userId, balance)

            await reserveCredits(userId, jobId, amount)

            const reserveEntry = mockLedger.find(
              (e) => e.jobId === jobId && e.action === 'RESERVE'
            )
            expect(reserveEntry).toBeDefined()
            expect(reserveEntry!.amount).toBe(-amount)
            expect(reserveEntry!.balanceAfter).toBe(balance - amount)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 2: RESERVE 余额不足
  // ========================
  describe('Property 2: RESERVE 余额不足 - 应抛出错误，余额不变', () => {
    /**
     * **Validates: Requirements 11.2**
     * 余额 B < N 时，应抛出错误，余额不变
     */
    it('余额不足时 RESERVE 抛出错误', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 999 }),    // 余额 B
          fc.integer({ min: 1, max: 1000 }),   // 额外超出 offset
          async (balance, offset) => {
            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-insuf-${balance}-${offset}`
            const amount = balance + offset  // 确保 amount > balance
            createMockUser(userId, balance)

            await expect(
              reserveCredits(userId, jobId, amount)
            ).rejects.toThrow('积分余额不足')

            // 余额不变
            const user = mockUsers.get(userId)!
            expect(user.creditBalance).toBe(balance)
            // 无流水写入
            const entries = mockLedger.filter((e) => e.jobId === jobId)
            expect(entries.length).toBe(0)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 3: CHARGE 属性
  // ========================
  describe('Property 3: CHARGE 属性 - CHARGE 金额 <= RESERVE 金额时成功', () => {
    /**
     * **Validates: Requirements 11.3**
     * CHARGE 在有 RESERVE 的情况下：成功记录流水，多冻结差额退还
     */
    it('CHARGE <= RESERVE 时成功，差额退还后余额 = 初始余额 - actualAmount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 5000 }),  // 初始余额
          fc.integer({ min: 1, max: 100 }),    // RESERVE 金额
          fc.integer({ min: 1, max: 100 }),    // CHARGE 因子
          async (initialBalance, reserveAmount, chargeFactor) => {
            // 约束：RESERVE 不超余额，CHARGE <= RESERVE
            if (reserveAmount > initialBalance) return
            const chargeAmount = Math.min(chargeFactor, reserveAmount)

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-charge-${initialBalance}-${reserveAmount}-${chargeFactor}`
            createMockUser(userId, initialBalance)

            // 步骤1: RESERVE
            await reserveCredits(userId, jobId, reserveAmount)
            expect(mockUsers.get(userId)!.creditBalance).toBe(initialBalance - reserveAmount)

            // 步骤2: CHARGE
            await chargeCredits(userId, jobId, chargeAmount)

            // 验证最终余额 = 初始余额 - chargeAmount（差额已退还）
            const finalBalance = mockUsers.get(userId)!.creditBalance
            expect(finalBalance).toBe(initialBalance - chargeAmount)

            // 验证有 CHARGE 流水记录
            const chargeEntry = mockLedger.find(
              (e) => e.jobId === jobId && e.action === 'CHARGE'
            )
            expect(chargeEntry).toBeDefined()
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 4: CHARGE 超额（无 RESERVE 且余额不足）
  // ========================
  describe('Property 4: CHARGE 超额 - 无 RESERVE 且余额不足时拒绝', () => {
    /**
     * **Validates: Requirements 11.4**
     * 无 RESERVE 直接 CHARGE 时，余额不足应抛出 INSUFFICIENT_CREDITS
     */
    it('无 RESERVE 且余额不足时 CHARGE 抛出错误', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 499 }),    // 余额
          fc.integer({ min: 1, max: 500 }),    // 额外超出
          async (balance, offset) => {
            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-exceed-${balance}-${offset}`
            const chargeAmount = balance + offset  // 确保 chargeAmount > balance
            createMockUser(userId, balance)

            // 直接 CHARGE（无 RESERVE）
            await expect(
              chargeCredits(userId, jobId, chargeAmount)
            ).rejects.toThrow(/积分不足/)

            // 余额不变
            expect(mockUsers.get(userId)!.creditBalance).toBe(balance)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 5: REFUND 属性
  // ========================
  describe('Property 5: REFUND 属性 - REFUND 后余额 = 原余额 + REFUND 金额', () => {
    /**
     * **Validates: Requirements 11.5**
     * REFUND 后余额正确恢复
     */
    it('REFUND 后余额 = RESERVE 后余额 + REFUND 金额', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 5000 }),   // 初始余额
          fc.integer({ min: 1, max: 50 }),      // RESERVE 金额
          async (initialBalance, reserveAmount) => {
            if (reserveAmount > initialBalance) return

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-refund-${initialBalance}-${reserveAmount}`
            createMockUser(userId, initialBalance)

            // RESERVE
            await reserveCredits(userId, jobId, reserveAmount)
            const balanceAfterReserve = mockUsers.get(userId)!.creditBalance
            expect(balanceAfterReserve).toBe(initialBalance - reserveAmount)

            // REFUND
            await refundCredits(userId, jobId, reserveAmount)
            const balanceAfterRefund = mockUsers.get(userId)!.creditBalance

            // 验证: refund后余额 = reserve后余额 + refund金额
            expect(balanceAfterRefund).toBe(balanceAfterReserve + reserveAmount)
            // 等同于恢复到初始余额
            expect(balanceAfterRefund).toBe(initialBalance)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('REFUND 流水记录金额和余额正确', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 5000 }),
          fc.integer({ min: 1, max: 50 }),
          async (initialBalance, refundAmount) => {
            if (refundAmount > initialBalance) return

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-refund-record-${initialBalance}-${refundAmount}`
            createMockUser(userId, initialBalance)

            // 先 RESERVE 再 REFUND
            await reserveCredits(userId, jobId, refundAmount)
            await refundCredits(userId, jobId, refundAmount)

            const refundEntry = mockLedger.find(
              (e) => e.jobId === jobId && e.action === 'REFUND'
            )
            expect(refundEntry).toBeDefined()
            expect(refundEntry!.amount).toBe(refundAmount)
            expect(refundEntry!.balanceAfter).toBe(initialBalance)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 6: RESERVE + CHARGE + REFUND 原子性
  // ========================
  describe('Property 6: 完整流程余额一致性 - B - chargeAmount = finalBalance', () => {
    /**
     * **Validates: Requirements 11.1, 11.3, 11.5**
     * RESERVE → CHARGE 完整流程后余额一致
     * 最终余额 = 初始余额 - chargeAmount（因为 RESERVE 多冻结的部分会被 CHARGE 退还）
     */
    it('RESERVE → CHARGE 完整流程后 finalBalance = initialBalance - chargeAmount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 5000 }),  // 初始余额
          fc.integer({ min: 10, max: 100 }),    // RESERVE 金额
          fc.integer({ min: 1, max: 100 }),     // CHARGE 因子
          async (initialBalance, reserveAmount, chargeFactor) => {
            if (reserveAmount > initialBalance) return
            const chargeAmount = Math.min(chargeFactor, reserveAmount)

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-full-${initialBalance}-${reserveAmount}-${chargeFactor}`
            createMockUser(userId, initialBalance)

            // 完整流程: RESERVE → CHARGE
            await reserveCredits(userId, jobId, reserveAmount)
            await chargeCredits(userId, jobId, chargeAmount)

            const finalBalance = mockUsers.get(userId)!.creditBalance
            // 核心不变量: 最终余额 = 初始余额 - 实际消费
            expect(finalBalance).toBe(initialBalance - chargeAmount)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('RESERVE → REFUND 完整流程后余额恢复', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 5000 }),
          fc.integer({ min: 1, max: 100 }),
          async (initialBalance, reserveAmount) => {
            if (reserveAmount > initialBalance) return

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-restore-${initialBalance}-${reserveAmount}`
            createMockUser(userId, initialBalance)

            // 完整流程: RESERVE → REFUND（失败路径）
            await reserveCredits(userId, jobId, reserveAmount)
            await refundCredits(userId, jobId, reserveAmount)

            const finalBalance = mockUsers.get(userId)!.creditBalance
            // 核心不变量: 失败退还后余额完全恢复
            expect(finalBalance).toBe(initialBalance)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ========================
  // Property 7: 幂等性
  // ========================
  describe('Property 7: 幂等性 - 相同 jobId 的操作不应重复执行', () => {
    /**
     * **Validates: Requirements 11.1**
     * 相同 jobId 重复调用 REFUND / CHARGE 不应重复执行
     */
    it('重复 REFUND 同一 jobId 不会多次增加余额', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 5000 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 2, max: 5 }),     // 重复次数
          async (initialBalance, amount, repeatCount) => {
            if (amount > initialBalance) return

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-idempotent-refund-${initialBalance}-${amount}`
            createMockUser(userId, initialBalance)

            // 先 RESERVE 扣减余额
            await reserveCredits(userId, jobId, amount)
            expect(mockUsers.get(userId)!.creditBalance).toBe(initialBalance - amount)

            // 重复 REFUND 多次
            for (let i = 0; i < repeatCount; i++) {
              await refundCredits(userId, jobId, amount)
            }

            // 幂等保证：余额只恢复一次
            expect(mockUsers.get(userId)!.creditBalance).toBe(initialBalance)

            // 只有一条 REFUND 流水
            const refundEntries = mockLedger.filter(
              (e) => e.jobId === jobId && e.action === 'REFUND'
            )
            expect(refundEntries.length).toBe(1)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('重复 CHARGE 同一 jobId 不会多次记账', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 5000 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 2, max: 5 }),
          async (initialBalance, reserveAmount, repeatCount) => {
            if (reserveAmount > initialBalance) return

            resetMockDb()
            const userId = 'user-1'
            const jobId = `job-idempotent-charge-${initialBalance}-${reserveAmount}`
            createMockUser(userId, initialBalance)

            // RESERVE
            await reserveCredits(userId, jobId, reserveAmount)

            // 重复 CHARGE 多次
            for (let i = 0; i < repeatCount; i++) {
              await chargeCredits(userId, jobId, reserveAmount)
            }

            // 幂等保证：只记录一条 CHARGE
            const chargeEntries = mockLedger.filter(
              (e) => e.jobId === jobId && e.action === 'CHARGE'
            )
            expect(chargeEntries.length).toBe(1)
          }
        ),
        { numRuns: 200 }
      )
    })
  })
})
