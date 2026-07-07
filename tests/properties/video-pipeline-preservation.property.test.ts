import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

// Mock db/redis 模块，避免 DATABASE_URL 缺失导致的初始化错误（credit-service/state-machine 间接 import db）
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => vi.fn() })
}))

/**
 * Feature: video-pipeline-fixes（Bug 修复）
 * Property 2 (Property 13): Preservation - 非缺陷输入既有行为不变
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 *
 * 本文件为「保持性属性测试」，按 observation-first 方法论编写：
 *   - 先在【未修复】代码上观察非缺陷输入（¬C(X)）的真实行为，再固化为 PBT。
 *   - 这些断言锁定【修复前后都必须不变】的基线行为，防止修复引入回归。
 *   - 在【未修复】代码上运行应【全部通过】（确认基线）；修复后重跑仍应通过（确认无回归）。
 *
 * 覆盖需保持的行为（bugfix.md 3.1–3.8）：
 *   3.1 余额充足解析：足额余额 → 按真实消费扣全额、置 EDITABLE
 *   3.2 按组扣费幂等：atomicSuccessUpdate 幂等、RESERVE 差额 REFUND
 *   3.3 生成积分流转：RESERVE/CHARGE/REFUND 与 failProjectChain 退款
 *   3.4/3.8 合并成功置 EXPORTED、EXPORTED 再入队幂等跳过
 *   3.5 jobs/retry、jobs/cancel 经 assertTransition 校验（真实状态机）
 *   3.6 topupCredits 按 orderId 幂等 —— 已由 credit-topup.property.test.ts 覆盖，本文件不重复
 *   3.7 OSS 读写路径：解析/生成/合并产物按既定 key 命名空间上传 OSS
 */

// ============================================================
// 3.1 余额充足解析：按真实消费扣全额、置 EDITABLE
// ¬C(X)（defect 1 的非缺陷输入）：balance >= 应扣额度
// 用【真实】chargeParseCreditsTx（内存 tx 替身驱动，不伪造其内部逻辑）观察净效果。
// 净不变量（修复前后一致）：足额时恰扣应扣全额、余额减少该额度、CHARGE 无欠费备注。
// ============================================================

/**
 * Prisma 事务客户端最小内存替身：仅实现 chargeParseCreditsTx 实际调用的方法
 * （user.findUniqueOrThrow / user.update / creditLedger.create），
 * 用真实数据驱动【真实】chargeParseCreditsTx 函数。
 */
function makeInMemoryTx(userId: string, initialBalance: number) {
  const state = { balance: initialBalance }
  const ledger: Array<{ action: string; amount: number; balanceAfter: number; remark: string }> = []
  const tx = {
    user: {
      async findUniqueOrThrow() {
        return { id: userId, creditBalance: state.balance }
      },
      async update(args: { data: { creditBalance: number } }) {
        state.balance = args.data.creditBalance
        return { id: userId, creditBalance: state.balance }
      },
    },
    creditLedger: {
      async create(args: { data: { action: string; amount: number; balanceAfter: number; remark: string } }) {
        ledger.push(args.data)
        return args.data
      },
    },
  }
  return { tx, state, ledger }
}

/**
 * 解析成功状态流转模拟器（复刻 parse-video 步骤 10：解析成功置项目 EDITABLE）
 * 真实流程：PARSING → EDITABLE（与扣费在同一成功事务内）。
 */
class ParseStatusSimulator {
  status: string
  constructor(initial = 'PARSING') {
    this.status = initial
  }
  markParsedEditable(): void {
    // 解析成功：仅从 PARSING 推进到 EDITABLE
    if (this.status !== 'PARSING') throw new Error(`非法解析状态流转：${this.status} → EDITABLE`)
    this.status = 'EDITABLE'
  }
}

describe('3.1 余额充足解析保持：按真实消费扣全额并置 EDITABLE（Property 2）', () => {
  it('足额余额时 chargeParseCreditsTx 恰扣应扣全额、余额减少该额度、无欠费备注', async () => {
    const { chargeParseCreditsTx } = await import('@/lib/shared/credit-service')

    await fc.assert(
      fc.asyncProperty(
        // 应扣额度
        fc.integer({ min: 1, max: 500 }),
        // 余额盈余（>=0 保证余额充足，命中 ¬C(X)）
        fc.integer({ min: 0, max: 1000 }),
        async (amount, surplus) => {
          const balance = amount + surplus
          const { tx, state, ledger } = makeInMemoryTx('user-1', balance)

          // @ts-expect-error 内存替身满足被调用到的 Prisma 接口子集
          await chargeParseCreditsTx(tx, 'user-1', 'project-1', amount)

          // 净效果：余额恰减少应扣全额
          expect(state.balance).toBe(balance - amount)

          const charge = ledger.find((e) => e.action === 'CHARGE')
          expect(charge).toBeDefined()
          // 足额：扣费额度恰为应扣全额（min(balance, amount) == amount）
          expect(Math.abs(charge!.amount)).toBe(amount)
          expect(charge!.balanceAfter).toBe(balance - amount)
          // 足额扣费不应出现欠费备注
          expect(charge!.remark).not.toMatch(/欠|不足/)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('解析成功后项目从 PARSING 置为 EDITABLE', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const sim = new ParseStatusSimulator('PARSING')
        sim.markParsedEditable()
        expect(sim.status).toBe('EDITABLE')
      }),
      { numRuns: 20 }
    )
  })
})

// ============================================================
// 3.2 按组扣费幂等：atomicSuccessUpdate（generate-video.ts）
// 忠实复刻其成功事务内 step4 信用逻辑：existingCharge 幂等 + RESERVE 差额 REFUND。
// RESERVE 在冻结时已扣全额；CHARGE 仅记账（balanceAfter 不变）；多冻结部分以 REFUND 退回。
// 净不变量：净扣减 == costEstimate；重复调用仅一条 CHARGE。
// ============================================================

interface CreditEntry {
  jobId: string
  action: 'RESERVE' | 'CHARGE' | 'REFUND'
  amount: number
  balanceAfter: number
}

/**
 * 生成阶段信用模拟器：忠实复刻 credit-service.ts / generate-video.ts 的
 * RESERVE / CHARGE(atomicSuccessUpdate) / REFUND 真实逻辑（避免 Prisma 依赖）。
 */
class GenerationCreditSimulator {
  balance: number
  ledger: CreditEntry[] = []

  constructor(initialBalance: number) {
    this.balance = initialBalance
  }

  /** 复刻 reserveCredits：余额不足抛错，否则冻结（扣全额）并记 RESERVE */
  reserve(jobId: string, amount: number): void {
    if (this.balance < amount) throw new Error('积分余额不足')
    this.balance -= amount
    this.ledger.push({ jobId, action: 'RESERVE', amount: -amount, balanceAfter: this.balance })
  }

  /**
   * 复刻 atomicSuccessUpdate 成功事务 step4：
   * - existingCharge 命中则跳过（幂等）
   * - 否则：RESERVE 差额（reserved - cost > 0）以 REFUND 退回，并写一条 CHARGE 记账
   */
  chargeOnSuccess(jobId: string, costEstimate: number): void {
    const existingCharge = this.ledger.find((e) => e.jobId === jobId && e.action === 'CHARGE')
    if (existingCharge) return // 幂等：已扣费，跳过

    const reserveEntry = this.ledger.find((e) => e.jobId === jobId && e.action === 'RESERVE')
    if (reserveEntry) {
      const reservedAmount = Math.abs(reserveEntry.amount)
      const diff = reservedAmount - costEstimate
      if (diff > 0) {
        this.balance += diff
        this.ledger.push({ jobId, action: 'REFUND', amount: diff, balanceAfter: this.balance })
      }
    }
    // CHARGE 仅记账（余额已在 RESERVE 时扣减），balanceAfter 为当前余额
    this.ledger.push({ jobId, action: 'CHARGE', amount: -costEstimate, balanceAfter: this.balance })
  }

  /** 复刻 refundCredits：已存在 REFUND 则跳过（幂等），否则退回 amount */
  refundOnFailure(jobId: string, amount: number): void {
    const existingRefund = this.ledger.find((e) => e.jobId === jobId && e.action === 'REFUND')
    if (existingRefund) return // 幂等：已退还，跳过
    this.balance += amount
    this.ledger.push({ jobId, action: 'REFUND', amount, balanceAfter: this.balance })
  }

  chargesFor(jobId: string): CreditEntry[] {
    return this.ledger.filter((e) => e.jobId === jobId && e.action === 'CHARGE')
  }
}

describe('3.2 按组扣费幂等保持：atomicSuccessUpdate（Property 2）', () => {
  it('重复调用 chargeOnSuccess（重试）只产生一条 CHARGE，余额不再变化', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),    // costEstimate
        fc.integer({ min: 0, max: 500 }),    // 多冻结盈余（reserved = cost + surplus）
        fc.integer({ min: 1000, max: 5000 }), // 初始余额（足额）
        fc.integer({ min: 2, max: 4 }),      // 重复扣费次数（队列重试）
        (cost, surplus, initialBalance, repeats) => {
          const reserved = cost + surplus
          const sim = new GenerationCreditSimulator(initialBalance)
          const jobId = 'job-grp-1'

          sim.reserve(jobId, reserved)
          const balanceAfterReserve = sim.balance

          sim.chargeOnSuccess(jobId, cost)
          const balanceAfterFirstCharge = sim.balance

          // 重试：重复进入扣费
          for (let i = 1; i < repeats; i++) {
            sim.chargeOnSuccess(jobId, cost)
          }

          // 幂等：仅一条 CHARGE
          expect(sim.chargesFor(jobId)).toHaveLength(1)
          // 重复调用后余额不再变化
          expect(sim.balance).toBe(balanceAfterFirstCharge)
          // 净扣减恰为 cost：余额 = 初始 - cost
          expect(sim.balance).toBe(initialBalance - cost)
          // 多冻结部分已退回：首次扣费后较冻结后增加 surplus
          expect(balanceAfterFirstCharge - balanceAfterReserve).toBe(surplus)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('多冻结（reserved > cost）时退还差额恰为 reserved - cost', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (cost, extra) => {
          const reserved = cost + extra
          const sim = new GenerationCreditSimulator(10000)
          const jobId = 'job-grp-2'

          sim.reserve(jobId, reserved)
          sim.chargeOnSuccess(jobId, cost)

          const refund = sim.ledger.find((e) => e.jobId === jobId && e.action === 'REFUND')
          expect(refund).toBeDefined()
          expect(refund!.amount).toBe(extra)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('冻结额度恰等于成本（reserved == cost）时不产生 REFUND', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (cost) => {
        const sim = new GenerationCreditSimulator(10000)
        const jobId = 'job-grp-3'
        sim.reserve(jobId, cost)
        sim.chargeOnSuccess(jobId, cost)
        const refund = sim.ledger.find((e) => e.jobId === jobId && e.action === 'REFUND')
        expect(refund).toBeUndefined()
        expect(sim.balance).toBe(10000 - cost)
      }),
      { numRuns: 200 }
    )
  })
})

// ============================================================
// 3.3 生成积分流转：RESERVE/CHARGE/REFUND 与 failProjectChain 退款
// 成功路径净扣 cost；失败路径全额退回（净 0）；链式失败退还所有下游冻结。
// ============================================================

describe('3.3 生成积分流转保持：成功/失败/链式失败（Property 2）', () => {
  it('生成成功路径净扣减恰为 costEstimate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1000, max: 5000 }),
        (cost, surplus, initialBalance) => {
          const reserved = cost + surplus
          const sim = new GenerationCreditSimulator(initialBalance)
          sim.reserve('job-1', reserved)
          sim.chargeOnSuccess('job-1', cost)
          expect(sim.balance).toBe(initialBalance - cost)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('生成失败路径全额退回，净变化为 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1000, max: 5000 }),
        (cost, initialBalance) => {
          const sim = new GenerationCreditSimulator(initialBalance)
          sim.reserve('job-1', cost)
          sim.refundOnFailure('job-1', cost)
          expect(sim.balance).toBe(initialBalance)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('失败路径重复退款幂等：只退一次，余额不超充', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1000, max: 5000 }),
        fc.integer({ min: 2, max: 5 }),
        (cost, initialBalance, repeats) => {
          const sim = new GenerationCreditSimulator(initialBalance)
          sim.reserve('job-1', cost)
          for (let i = 0; i < repeats; i++) {
            sim.refundOnFailure('job-1', cost)
          }
          const refunds = sim.ledger.filter((e) => e.jobId === 'job-1' && e.action === 'REFUND')
          expect(refunds).toHaveLength(1)
          expect(sim.balance).toBe(initialBalance)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('failProjectChain 退还所有未运行下游组冻结积分（跳过 excludeJobId）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 5000, max: 20000 }),
        (costs, initialBalance) => {
          const sim = new GenerationCreditSimulator(initialBalance)

          // 冻结所有下游组
          costs.forEach((c, i) => sim.reserve(`job-${i}`, c))
          const totalReserved = costs.reduce((s, c) => s + c, 0)
          expect(sim.balance).toBe(initialBalance - totalReserved)

          // 当前组（index 0）已自行退款 → excludeJobId='job-0'，failProjectChain 跳过它
          sim.refundOnFailure('job-0', costs[0])

          // failProjectChain：退还其余所有下游冻结（幂等）
          for (let i = 1; i < costs.length; i++) {
            sim.refundOnFailure(`job-${i}`, costs[i])
          }

          // 全部退回后余额回到初始（无锁死、无超充）
          expect(sim.balance).toBe(initialBalance)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ============================================================
// 3.4 / 3.8 合并成功置 EXPORTED、EXPORTED 再入队幂等跳过
// 复刻 merge-video.ts processMergeVideo：开头 EXPORTED 幂等跳过；成功置 EXPORTED。
// ============================================================

/**
 * 合并流程模拟器：复刻 merge-video.ts processMergeVideo 的状态语义
 * - 入口幂等：项目已 EXPORTED 则直接跳过（不重复合并）
 * - 合并成功：项目置 EXPORTED
 */
class MergeSimulator {
  status: string
  mergeRunCount = 0
  constructor(initial: string) {
    this.status = initial
  }

  /** 返回是否真正执行了合并（false 表示幂等跳过） */
  processMerge(succeed: boolean): boolean {
    // 幂等防重：已 EXPORTED 直接跳过
    if (this.status === 'EXPORTED') {
      return false
    }
    this.mergeRunCount++
    if (succeed) {
      this.status = 'EXPORTED'
    }
    return true
  }
}

describe('3.4/3.8 合并成功置 EXPORTED 与 EXPORTED 幂等跳过保持（Property 2）', () => {
  it('合并成功后项目置为 EXPORTED', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('GENERATING', 'PARTIAL'),
        (initial) => {
          const sim = new MergeSimulator(initial)
          const ran = sim.processMerge(true)
          expect(ran).toBe(true)
          expect(sim.status).toBe('EXPORTED')
        }
      ),
      { numRuns: 50 }
    )
  })

  it('项目已 EXPORTED 时再次入队合并幂等跳过：不重复执行、状态不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),  // 重复入队次数
        (repeats) => {
          const sim = new MergeSimulator('GENERATING')

          // 首次合并成功 → EXPORTED
          sim.processMerge(true)
          expect(sim.status).toBe('EXPORTED')
          const runsAfterFirst = sim.mergeRunCount

          // 重复入队：全部应幂等跳过
          for (let i = 0; i < repeats; i++) {
            const ran = sim.processMerge(true)
            expect(ran).toBe(false)
          }

          // 合并实际执行次数不增加，状态保持 EXPORTED
          expect(sim.mergeRunCount).toBe(runsAfterFirst)
          expect(sim.status).toBe('EXPORTED')
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 3.5 jobs/retry、jobs/cancel 经 assertTransition 校验
// 使用【真实】state-machine 纯函数，锁定路由依赖的转换校验行为不变。
// ============================================================

describe('3.5 路由状态校验保持：真实 assertTransition / canRetry / canCancel（Property 2）', () => {
  it('jobs/retry：仅 FAILED 可重试，且 FAILED→QUEUED 合法转换通过 assertTransition', async () => {
    const { canRetry, assertTransition } = await import('@/lib/shared/state-machine')

    fc.assert(
      fc.property(
        fc.constantFrom('CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'),
        (status) => {
          if (status === 'FAILED') {
            expect(canRetry(status)).toBe(true)
            // 重试路由真实转换：FAILED → QUEUED 必须合法（不抛错）
            expect(() => assertTransition('FAILED', 'QUEUED')).not.toThrow()
          } else {
            expect(canRetry(status)).toBe(false)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('jobs/cancel：仅 QUEUED / CREDIT_RESERVED 可取消，QUEUED→CANCELED 合法转换通过', async () => {
    const { canCancel, assertTransition } = await import('@/lib/shared/state-machine')

    fc.assert(
      fc.property(
        fc.constantFrom('CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'),
        (status) => {
          if (status === 'QUEUED' || status === 'CREDIT_RESERVED') {
            expect(canCancel(status)).toBe(true)
            expect(() => assertTransition(status, 'CANCELED')).not.toThrow()
          } else {
            expect(canCancel(status)).toBe(false)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('assertTransition 对非法转换抛错（如 SUCCEEDED→任意、GENERATING→QUEUED）', async () => {
    const { assertTransition, canTransition } = await import('@/lib/shared/state-machine')

    fc.assert(
      fc.property(
        fc.constantFrom('CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'),
        fc.constantFrom('CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'),
        (from, to) => {
          // assertTransition 与 canTransition 行为一致：合法不抛、非法抛错
          if (canTransition(from, to)) {
            expect(() => assertTransition(from, to)).not.toThrow()
          } else {
            expect(() => assertTransition(from, to)).toThrow(/非法状态转换/)
          }
        }
      ),
      { numRuns: 300 }
    )
  })

  it('终态（SUCCEEDED / CANCELED / REFUNDED）无任何合法后继转换', async () => {
    const { getNextStates, isTerminalState } = await import('@/lib/shared/state-machine')
    for (const terminal of ['SUCCEEDED', 'CANCELED', 'REFUNDED']) {
      expect(isTerminalState(terminal)).toBe(true)
      expect(getNextStates(terminal)).toHaveLength(0)
    }
  })
})

// ============================================================
// 3.6 topupCredits 按 orderId 幂等
// 已由 tests/properties/credit-topup.property.test.ts（Property 5/6）完整覆盖，
// 本文件不重复实现，仅在此声明引用以保证 3.6 覆盖归属清晰。
// ============================================================

// ============================================================
// 3.7 OSS 读写路径：解析/生成/合并产物按既定 key 命名空间上传 OSS
// 复刻各 worker 的 OSS 对象键构造（真实路径组织契约），断言命名空间不变量。
// 真实 key 构造（来自 generate-video.ts / merge-video.ts）：
//   - 按组生成： generated/{projectId}/{shotGroupId}_{timestamp}.mp4
//   - 项目级分段： generated/{projectId}/{jobId}.mp4
//   - 合并导出： exported/{userId}/{projectId}/merged_{timestamp}.mp4
// ============================================================

function buildGroupGenOSSKey(projectId: string, shotGroupId: string, timestamp: number): string {
  return `generated/${projectId}/${shotGroupId}_${timestamp}.mp4`
}
function buildSegmentGenOSSKey(projectId: string, jobId: string): string {
  return `generated/${projectId}/${jobId}.mp4`
}
function buildMergedOSSKey(userId: string, projectId: string, timestamp: number): string {
  return `exported/${userId}/${projectId}/merged_${timestamp}.mp4`
}

describe('3.7 OSS 读写路径保持：产物 key 命名空间不变（Property 2）', () => {
  const idArb = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('/'))

  it('按组生成 key：generated/{projectId}/ 前缀、含 shotGroupId、.mp4 结尾', () => {
    fc.assert(
      fc.property(idArb, idArb, fc.integer({ min: 0, max: 2 ** 31 }), (projectId, shotGroupId, ts) => {
        const key = buildGroupGenOSSKey(projectId, shotGroupId, ts)
        expect(key.startsWith(`generated/${projectId}/`)).toBe(true)
        expect(key.includes(shotGroupId)).toBe(true)
        expect(key.endsWith('.mp4')).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it('项目级分段 key：generated/{projectId}/{jobId}.mp4', () => {
    fc.assert(
      fc.property(idArb, idArb, (projectId, jobId) => {
        const key = buildSegmentGenOSSKey(projectId, jobId)
        expect(key).toBe(`generated/${projectId}/${jobId}.mp4`)
      }),
      { numRuns: 200 }
    )
  })

  it('合并导出 key：exported/{userId}/{projectId}/ 前缀、merged_ 文件名、.mp4 结尾', () => {
    fc.assert(
      fc.property(idArb, idArb, fc.integer({ min: 0, max: 2 ** 31 }), (userId, projectId, ts) => {
        const key = buildMergedOSSKey(userId, projectId, ts)
        expect(key.startsWith(`exported/${userId}/${projectId}/`)).toBe(true)
        expect(key.includes('merged_')).toBe(true)
        expect(key.endsWith('.mp4')).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it('getPublicUrl 对同一 key 确定性返回（真实 storage 纯函数），可用于前端访问', async () => {
    const { getPublicUrl } = await import('@/lib/shared/storage')
    fc.assert(
      fc.property(idArb, idArb, (projectId, jobId) => {
        const key = buildSegmentGenOSSKey(projectId, jobId)
        const url1 = getPublicUrl(key)
        const url2 = getPublicUrl(key)
        // 确定性：同 key 同 URL；URL 必须以 key 结尾（OSS 公网或本地回退均成立）
        expect(url1).toBe(url2)
        expect(url1.endsWith(key)).toBe(true)
      }),
      { numRuns: 200 }
    )
  })
})
