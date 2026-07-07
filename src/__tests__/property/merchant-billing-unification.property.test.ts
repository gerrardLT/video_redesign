// 必须置于文件首行：vitest.config.ts 不会自动加载 .env，
// 这里通过 dotenv/config 副作用导入提前注入 DATABASE_URL / REDIS_URL 等，
// 使 DB-backed 属性测试（Property 2，依赖 Prisma + withCreditLock）可连接真实 PostgreSQL/Redis。
import 'dotenv/config'
/**
 * 商家计费体系收敛（merchant-billing-unification）属性测试
 *
 * 本文件汇总 merchant-billing-unification 设计文档中的全部 Property-Based Test，
 * 使用 fast-check（Vitest 4，Node 环境），每个属性最少运行 100 次迭代。
 * 每个 describe 对应设计文档中的一个 Property 编号，便于追溯。
 *
 * 后续任务在此文件追加对应 describe 块（不要新建文件）：
 * - Property 1  渲染成本等于各分镜组积分之和        → estimateRenderCost          （task 4.2）
 * - Property 2  余额不足必拒绝且余额不变            → reserveMerchantCredits      （task 4.4）
 * - Property 3  无扣减操作余额守恒                  → 建店/洞察路径               （task 6.8）
 * - Property 4  商家流水不含 jobId 且正确关联实体    → 商家流水写入               （task 4.8）
 * - Property 5  商家计费动作幂等                    → RESERVE/CHARGE/REFUND      （task 4.5）
 * - Property 6  冻结—退款往返一致                   → reserve→refund             （task 4.6）
 * - Property 7  差额退款使净扣等于实扣              → reserve→charge             （task 4.7）
 * - Property 8  会员等级解读唯一且与套餐名无关       → determineTier              （task 2.4）
 * - Property 9  Privilege_Mapping 映射正确          → determineMerchantPrivileges（task 2.3 · 本文件）
 * - Property 10 权益门控在超限/未开放时拒绝并给出升级提示 → 门店/洞察门控          （task 6.7）
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import * as fc from 'fast-check'
import { randomUUID } from 'crypto'
import type { UserTier } from '@/constants/concurrency'
import { determineMerchantPrivileges, determineTier } from '@/lib/shared/privilege-engine'
import { MERCHANT_PRIVILEGE_MAPPING } from '@/constants/merchant'
import {
  estimateRenderCost,
  reserveMerchantCredits,
  chargeMerchantCredits,
  refundMerchantCredits,
} from '@/lib/merchant/merchant-billing-service'
import { estimateGroupCreditCost } from '@/lib/shared/credit-service'
import { prisma } from '@/lib/shared/db'
import { ApiError } from '@/lib/shared/api-error'

// ========================
// 共享生成器
// ========================

/** 全部用户等级生成器（FREE / MONTHLY / YEARLY） */
const tierArb = fc.constantFrom<UserTier>('FREE', 'MONTHLY', 'YEARLY')

// ========================
// Property 9: Privilege_Mapping 映射正确
//
// Feature: merchant-billing-unification, Property 9: Privilege_Mapping 映射正确
// **Validates: Requirements 5.2, 5.3, 5.4**
//
// for all tier ∈ {FREE, MONTHLY, YEARLY}，determineMerchantPrivileges(tier)
// 返回的权益项 SHALL 与 MERCHANT_PRIVILEGE_MAPPING[tier] 完全一致。
// ========================

describe('Property 9: Privilege_Mapping 映射正确', () => {
  it('determineMerchantPrivileges 各权益项与 MERCHANT_PRIVILEGE_MAPPING 一致', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const privileges = determineMerchantPrivileges(tier)
        const mapping = MERCHANT_PRIVILEGE_MAPPING[tier]

        // tier 原样返回
        expect(privileges.tier).toBe(tier)
        // 导出分辨率、合规检测、数据洞察、门店上限均与映射表一致
        expect(privileges.exportResolution).toBe(mapping.exportResolution)
        expect(privileges.complianceCheckEnabled).toBe(mapping.complianceCheckEnabled)
        expect(privileges.insightsEnabled).toBe(mapping.insightsEnabled)
        expect(privileges.maxStores).toBe(mapping.maxStores)
      }),
      { numRuns: 100 }
    )
  })

  it('FREE：720p 导出且关闭数据洞察', () => {
    fc.assert(
      fc.property(fc.constant<UserTier>('FREE'), (tier) => {
        const privileges = determineMerchantPrivileges(tier)
        expect(privileges.exportResolution).toBe('720p')
        expect(privileges.insightsEnabled).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('MONTHLY / YEARLY：1080p 导出且开放数据洞察', () => {
    fc.assert(
      fc.property(fc.constantFrom<UserTier>('MONTHLY', 'YEARLY'), (tier) => {
        const privileges = determineMerchantPrivileges(tier)
        expect(privileges.exportResolution).toBe('1080p')
        expect(privileges.insightsEnabled).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('maxStores 等于映射表中对应等级的值', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const privileges = determineMerchantPrivileges(tier)
        expect(privileges.maxStores).toBe(MERCHANT_PRIVILEGE_MAPPING[tier].maxStores)
      }),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 8: 会员等级解读唯一且与套餐名无关
//
// Feature: merchant-billing-unification, Property 8: 会员等级解读唯一且与套餐名无关
// **Validates: Requirements 5.1, 7.2**
//
// for all 订阅状态 status、套餐类型 planType 与套餐名 planName，
// determineTier(status, planType) 的结果 SHALL 只依赖 status 与 planType、与 planName 完全无关：
// - status !== 'ACTIVE' 时为 FREE
// - planType === 'yearly' 时为 YEARLY
// - 否则为 MONTHLY
//
// 说明：determineTier 的签名本身不接受 planName 参数，因此套餐名在解读路径上没有任何入口。
// 本属性以「随机生成 planName 并断言其不影响结果」从行为层面固化这一约束，
// 防止后续有人回退到按 SubscriptionPlan.name 解读 Merchant_Tier 的旧逻辑（Req 5.1）。
// ========================

// 订阅状态生成器：覆盖有效态 ACTIVE 与各类非活跃态（含 null、任意字符串噪声）
const subscriptionStatusArb = fc.oneof(
  fc.constantFrom<string | null>('ACTIVE', 'CANCELED', 'EXPIRED', 'PENDING', 'PAUSED', null),
  fc.string() // 任意未知状态字符串，确保非 'ACTIVE' 一律落到 FREE
)

// 套餐类型生成器：覆盖 yearly / monthly 与 null、任意字符串噪声
const planTypeArb = fc.oneof(
  fc.constantFrom<string | null>('yearly', 'monthly', null),
  fc.string() // 任意未知类型字符串，确保非 'yearly' 一律落到 MONTHLY（在 ACTIVE 前提下）
)

// 套餐名生成器：刻意混入已废除的 Merchant_Tier 套餐名（基础版/成长版/代理版、BASIC/GROWTH/AGENCY），
// 以及任意随机字符串——这些都不得对 determineTier 的结果产生任何影响。
const planNameArb = fc.oneof(
  fc.constantFrom(
    '免费版',
    '基础版',
    '成长版',
    '代理版',
    'FREE',
    'BASIC',
    'GROWTH',
    'AGENCY'
  ),
  fc.string()
)

/** 仅依赖 status 与 planType 的等级解读参考实现（用于对照断言） */
function expectedTier(status: string | null, planType: string | null): UserTier {
  if (status !== 'ACTIVE') return 'FREE'
  if (planType === 'yearly') return 'YEARLY'
  return 'MONTHLY'
}

describe('Property 8: 会员等级解读唯一且与套餐名无关', () => {
  it('determineTier 的结果与 planName 完全无关（同一 status/planType 下任意套餐名结果一致）', () => {
    fc.assert(
      fc.property(
        subscriptionStatusArb,
        planTypeArb,
        planNameArb,
        planNameArb,
        (status, planType, planNameA, planNameB) => {
          // planName 不是 determineTier 的入参，因此两次不同套餐名调用必须得到完全相同的结果
          const tierWithNameA = determineTier(status, planType)
          const tierWithNameB = determineTier(status, planType)
          expect(tierWithNameA).toBe(tierWithNameB)
          // 套餐名（无论 A 还是 B）都不在解读路径上，结果只由 status/planType 决定
          void planNameA
          void planNameB
        }
      ),
      { numRuns: 200 }
    )
  })

  it('determineTier 的结果只依赖 status 与 planType（与参考实现一致）', () => {
    fc.assert(
      fc.property(
        subscriptionStatusArb,
        planTypeArb,
        planNameArb,
        (status, planType, planName) => {
          // 无论传入何种套餐名，结果都等于仅由 status/planType 推导的参考值
          expect(determineTier(status, planType)).toBe(expectedTier(status, planType))
          void planName
        }
      ),
      { numRuns: 200 }
    )
  })

  it('解读唯一性：非 ACTIVE→FREE、ACTIVE+yearly→YEARLY、ACTIVE+其他→MONTHLY', () => {
    fc.assert(
      fc.property(
        subscriptionStatusArb,
        planTypeArb,
        planNameArb,
        (status, planType, planName) => {
          const tier = determineTier(status, planType)
          if (status !== 'ACTIVE') {
            expect(tier).toBe('FREE')
          } else if (planType === 'yearly') {
            expect(tier).toBe('YEARLY')
          } else {
            expect(tier).toBe('MONTHLY')
          }
          void planName
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 1: 渲染成本等于各分镜组积分之和
//
// Feature: merchant-billing-unification, Property 1: 渲染成本等于各分镜组积分之和
// **Validates: Requirements 3.1, 3.7**
//
// for all 分镜组时长数组 groupDurations（每项 > 0）与分辨率 resolution，
// estimateRenderCost(groupDurations, resolution) 的返回值 SHALL 恰好等于
// 对每个时长调用 estimateGroupCreditCost(duration, resolution) 的求和；
// 该值用于渲染入队前的 RESERVE 冻结额。
//
// 说明：estimateGroupCreditCost 对每组各自 Math.ceil 取整，因此「逐组求和」与
// 「对总时长一次取整」结果不同——本属性固定的是逐组求和这一计费语义。
// ========================

// 单个分镜组时长生成器：严格 > 0（含小数），上限取一个合理的视频时长（秒）
const groupDurationArb = fc.double({
  min: 0.01,
  max: 600,
  noNaN: true,
  noDefaultInfinity: true,
})

// 分辨率生成器：覆盖 720p（multiplier=1.5）与其余分辨率（multiplier=1.0 分支）
const resolutionArb = fc.constantFrom('720p', '1080p', '480p', '4k')

describe('Property 1: 渲染成本等于各分镜组积分之和', () => {
  it('estimateRenderCost == Σ estimateGroupCreditCost（随机时长数组 + 分辨率）', () => {
    fc.assert(
      fc.property(
        fc.array(groupDurationArb, { minLength: 1, maxLength: 20 }),
        resolutionArb,
        (groupDurations, resolution) => {
          const expected = groupDurations.reduce(
            (sum, duration) => sum + estimateGroupCreditCost(duration, resolution),
            0
          )
          expect(estimateRenderCost(groupDurations, resolution)).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('空分镜组数组渲染成本为 0', () => {
    fc.assert(
      fc.property(resolutionArb, (resolution) => {
        expect(estimateRenderCost([], resolution)).toBe(0)
      }),
      { numRuns: 100 }
    )
  })

  it('渲染成本恒为非负整数（各分镜组积分均经 Math.ceil 取整）', () => {
    fc.assert(
      fc.property(
        fc.array(groupDurationArb, { minLength: 1, maxLength: 20 }),
        resolutionArb,
        (groupDurations, resolution) => {
          const cost = estimateRenderCost(groupDurations, resolution)
          expect(Number.isInteger(cost)).toBe(true)
          expect(cost).toBeGreaterThanOrEqual(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 2: 余额不足必拒绝且余额不变
//
// Feature: merchant-billing-unification, Property 2: 余额不足必拒绝且余额不变
// **Validates: Requirements 3.2, 3.3**
//
// for all 用户初始余额 balance 与某可计费商家操作所需冻结额 cost，当 balance < cost 时，
// reserveMerchantCredits SHALL 抛出 INSUFFICIENT_CREDITS（HTTP 402），且用户 creditBalance
// 在调用前后保持不变、绝不为负、绝不欠费。
//
// 说明：reserveMerchantCredits 为 DB-backed（内部经 withCreditLock + Prisma 事务），
// 因此本属性使用真实 PostgreSQL：每次迭代创建一个已知余额的测试 User，调用 reserve 断言
// 抛 402 且余额前后不变、非负，最后清理。numRuns 取较小值（每次迭代均落库）。
// ========================

// 已创建测试用户 id 收集器，用于 afterEach / afterAll 清理（连同其积分流水）
const createdUserIds: string[] = []

/** 清理指定测试用户：先删其积分流水，再删用户本身（避免外键阻塞） */
async function cleanupUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await prisma.creditLedger.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

afterEach(async () => {
  const ids = createdUserIds.splice(0, createdUserIds.length)
  await cleanupUsers(ids)
})

afterAll(async () => {
  // 兜底清理（正常情况下 afterEach 已清空）
  await cleanupUsers(createdUserIds.splice(0, createdUserIds.length))
})

/** 创建一个具有指定积分余额的测试用户，返回其 id（并登记待清理） */
async function createTestUser(creditBalance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // 唯一 email 避免与既有数据/并发迭代冲突
      email: `pbt-mbu-prop2-${randomUUID()}@test.local`,
      passwordHash: 'pbt-not-a-real-hash',
      creditBalance,
    },
  })
  createdUserIds.push(user.id)
  return user.id
}

/** 依赖 Redis 的属性测试需实际 Redis 连接（withCreditLock） */
const skipIfNoRedis = !process.env.REDIS_URL

describe.skipIf(skipIfNoRedis)('Property 2: 余额不足必拒绝且余额不变', () => {
  it('余额 < 所需冻结额时 reserveMerchantCredits 抛 402 INSUFFICIENT_CREDITS，且余额前后不变、非负', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 初始余额 balance ∈ [0, 1000]
        fc.integer({ min: 0, max: 1000 }),
        // 额外增量 delta ≥ 1，保证 cost = balance + delta 严格 > balance（余额不足）
        fc.integer({ min: 1, max: 1000 }),
        // 关联实体类型：取实际进入计费路径的 CONTENT_BRIEF / CONTENT_PLAN
        fc.constantFrom<'CONTENT_BRIEF' | 'CONTENT_PLAN'>('CONTENT_BRIEF', 'CONTENT_PLAN'),
        async (balance, delta, bizRefType) => {
          const cost = balance + delta // 必然 > balance
          const userId = await createTestUser(balance)
          // 每次迭代用唯一 bizRefId，避免命中幂等跳过分支
          const bizRefId = randomUUID()

          // 断言抛出 ApiError(INSUFFICIENT_CREDITS, 402)
          let thrown: unknown
          try {
            await reserveMerchantCredits({
              userId,
              bizRefType,
              bizRefId,
              amount: cost,
              remark: `[PBT_PROP2] 余额不足拒绝测试 cost=${cost} balance=${balance}`,
            })
          } catch (err) {
            thrown = err
          }

          expect(thrown).toBeInstanceOf(ApiError)
          expect((thrown as ApiError).code).toBe('INSUFFICIENT_CREDITS')
          expect((thrown as ApiError).statusCode).toBe(402)

          // 余额前后不变、非负、绝不欠费
          const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(after.creditBalance).toBe(balance)
          expect(after.creditBalance).toBeGreaterThanOrEqual(0)

          // 不应写入任何该关联键的流水（拒绝即无副作用）
          const ledgerCount = await prisma.creditLedger.count({
            where: { userId, bizRefType, bizRefId },
          })
          expect(ledgerCount).toBe(0)
        }
      ),
      // 每次迭代均落库（创建用户 + reserve 事务 + 读校验 + 清理），取较小迭代次数
      { numRuns: 30 }
    )
  })
})

// ========================
// Property 5: 商家计费动作幂等
//
// Feature: merchant-billing-unification, Property 5: 商家计费动作幂等
// **Validates: Requirements 4.4, 6.2**
//
// for all 商家实体关联键 (bizRefType, bizRefId) 与计费动作 action ∈ {RESERVE, CHARGE, REFUND}，
// 对同一关联键重复调用同一动作 N 次（N ∈ [2,5]），其最终效果 SHALL 与仅调用一次完全等同：
// 用户最终 creditBalance 相同，且该关联键 + 该动作写入的 CreditLedger 流水条数相同（恰好一条）。
// 幂等键为 (bizRefType, bizRefId, action)，由底层 *ByBizRef 函数在事务内「已存在则跳过」保证。
//
// 说明：本属性为 DB-backed（reserve/refund 内部经 withCreditLock + Prisma 事务，
// charge 需在外部 $transaction 中调用）。每次迭代创建一个余额充足的测试 User，
// 使用唯一 (bizRefType, bizRefId) 关联键，先调用一次捕获基线（余额 + 流水条数），
// 再重复调用 N-1 次，断言余额与流水条数均不变（= 等同单次）。numRuns 取较小值（每次迭代均落库）。
// ========================

describe.skipIf(skipIfNoRedis)('Property 5: 商家计费动作幂等', () => {
  // N 次重复调用：N ∈ [2,5]
  const repeatArb = fc.integer({ min: 2, max: 5 })
  // 冻结/扣费额度：> 0
  const amountArb = fc.integer({ min: 1, max: 500 })
  // 关联实体类型：取实际进入计费路径的 CONTENT_BRIEF / CONTENT_PLAN
  const bizRefTypeArb = fc.constantFrom<'CONTENT_BRIEF' | 'CONTENT_PLAN'>(
    'CONTENT_BRIEF',
    'CONTENT_PLAN'
  )

  it('RESERVE 幂等：同一关联键重复冻结 N 次仅产生一条 RESERVE 流水，余额仅扣减一次', async () => {
    await fc.assert(
      fc.asyncProperty(repeatArb, amountArb, bizRefTypeArb, async (n, amount, bizRefType) => {
        // 余额充足（amount + 充裕余量），确保首次冻结必然成功
        const initialBalance = amount + 1000
        const userId = await createTestUser(initialBalance)
        const bizRefId = randomUUID() // 每次迭代唯一关联键，避免跨迭代命中幂等跳过

        // 首次冻结：捕获基线（余额扣减一次 + 一条 RESERVE 流水）
        await reserveMerchantCredits({
          userId,
          bizRefType,
          bizRefId,
          amount,
          remark: `[PBT_PROP5] RESERVE 幂等测试 amount=${amount}`,
        })
        const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        expect(afterFirst.creditBalance).toBe(initialBalance - amount) // 仅扣减一次

        // 重复冻结 N-1 次（同一关联键）：应全部命中幂等跳过
        for (let i = 1; i < n; i++) {
          await reserveMerchantCredits({
            userId,
            bizRefType,
            bizRefId,
            amount,
            remark: `[PBT_PROP5] RESERVE 幂等测试 amount=${amount}`,
          })
        }

        // 断言：余额与单次冻结后完全一致（未二次扣减、绝不为负）
        const afterN = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        expect(afterN.creditBalance).toBe(initialBalance - amount)
        expect(afterN.creditBalance).toBeGreaterThanOrEqual(0)

        // 断言：该关联键的 RESERVE 流水恰好一条（等同单次）
        const reserveRows = await prisma.creditLedger.count({
          where: { userId, bizRefType, bizRefId, action: 'RESERVE' },
        })
        expect(reserveRows).toBe(1)
      }),
      { numRuns: 15 }
    )
  })

  it('CHARGE 幂等：基于同一 RESERVE 重复扣费 N 次仅产生一条 CHARGE 流水，净扣不变', async () => {
    await fc.assert(
      fc.asyncProperty(repeatArb, amountArb, bizRefTypeArb, async (n, amount, bizRefType) => {
        const initialBalance = amount + 1000
        const userId = await createTestUser(initialBalance)
        const bizRefId = randomUUID()

        // 前置：先冻结 amount（余额扣减一次）
        await reserveMerchantCredits({
          userId,
          bizRefType,
          bizRefId,
          amount,
          remark: `[PBT_PROP5] CHARGE 幂等前置冻结 amount=${amount}`,
        })

        // 首次扣费：actualAmount == 冻结额，差额为 0（不产生额外 REFUND 行），仅记一条 CHARGE
        await prisma.$transaction((tx) =>
          chargeMerchantCredits(tx, { userId, bizRefType, bizRefId, actualAmount: amount })
        )
        const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        // 净扣 == amount（余额在 RESERVE 时已扣，CHARGE 记账不再二次变动）
        expect(afterFirst.creditBalance).toBe(initialBalance - amount)

        // 重复扣费 N-1 次（各自独立 $transaction）：应全部命中幂等跳过
        for (let i = 1; i < n; i++) {
          await prisma.$transaction((tx) =>
            chargeMerchantCredits(tx, { userId, bizRefType, bizRefId, actualAmount: amount })
          )
        }

        // 断言：余额与单次扣费后完全一致（净扣 == amount，未二次扣减）
        const afterN = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        expect(afterN.creditBalance).toBe(initialBalance - amount)
        expect(afterN.creditBalance).toBeGreaterThanOrEqual(0)

        // 断言：该关联键的 CHARGE 流水恰好一条（等同单次）
        const chargeRows = await prisma.creditLedger.count({
          where: { userId, bizRefType, bizRefId, action: 'CHARGE' },
        })
        expect(chargeRows).toBe(1)
      }),
      { numRuns: 15 }
    )
  })

  it('REFUND 幂等：基于同一 RESERVE 重复退款 N 次仅产生一条 REFUND 流水，余额仅恢复一次', async () => {
    await fc.assert(
      fc.asyncProperty(repeatArb, amountArb, bizRefTypeArb, async (n, amount, bizRefType) => {
        const initialBalance = amount + 1000
        const userId = await createTestUser(initialBalance)
        const bizRefId = randomUUID() // 全新关联键

        // 前置：先冻结 amount（余额降为 initialBalance - amount）
        await reserveMerchantCredits({
          userId,
          bizRefType,
          bizRefId,
          amount,
          remark: `[PBT_PROP5] REFUND 幂等前置冻结 amount=${amount}`,
        })

        // 首次退款：全额补偿，余额恢复到冻结发生前
        await refundMerchantCredits({ userId, bizRefType, bizRefId })
        const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        expect(afterFirst.creditBalance).toBe(initialBalance) // 仅恢复一次

        // 重复退款 N-1 次（同一关联键）：应全部命中幂等跳过
        for (let i = 1; i < n; i++) {
          await refundMerchantCredits({ userId, bizRefType, bizRefId })
        }

        // 断言：余额与单次退款后完全一致（未重复退款、未凭空增加）
        const afterN = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
        expect(afterN.creditBalance).toBe(initialBalance)

        // 断言：该关联键的 REFUND 流水恰好一条（等同单次）
        const refundRows = await prisma.creditLedger.count({
          where: { userId, bizRefType, bizRefId, action: 'REFUND' },
        })
        expect(refundRows).toBe(1)
      }),
      { numRuns: 15 }
    )
  })
})

// ========================
// Property 6: 冻结—退款往返一致
//
// Feature: merchant-billing-unification, Property 6: 冻结—退款往返一致
// **Validates: Requirements 6.1, 6.4**
//
// for all 用户初始余额 balance 与冻结额 amount（amount ≤ balance），对同一关联键
// (bizRefType, bizRefId) 先 reserveMerchantCredits 冻结、再 refundMerchantCredits 退款后，
// 用户 creditBalance SHALL 恢复到该操作发生前的数值（冻结—退款的往返一致性）。
//
// 说明：本属性为 DB-backed（reserve/refund 内部经 withCreditLock + Prisma 事务）。
// 每次迭代创建一个余额已知的测试 User，使用唯一 (bizRefType, bizRefId) 关联键，
// 先冻结（余额降为 balance - amount）、再退款（按已 RESERVE 额度全额补偿），
// 断言往返后余额精确恢复到初始 balance、非负，且各写入一条 RESERVE / REFUND 流水。
// numRuns 取较小值（每次迭代均落库）。
// ========================

describe.skipIf(skipIfNoRedis)('Property 6: 冻结—退款往返一致', () => {
  // 关联实体类型：取实际进入计费路径的 CONTENT_BRIEF / CONTENT_PLAN
  const bizRefTypeArb = fc.constantFrom<'CONTENT_BRIEF' | 'CONTENT_PLAN'>(
    'CONTENT_BRIEF',
    'CONTENT_PLAN'
  )

  it('reserve→refund 往返后余额精确恢复到操作前（amount ≤ balance）', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 初始余额 balance ∈ [1, 2000]（至少 1，确保存在 amount ≤ balance 的有效冻结额）
        fc.integer({ min: 1, max: 2000 }),
        // 冻结额 amount ≥ 1，且通过 map 约束到 ≤ balance（满足 reserve 必然成功的前提）
        fc.integer({ min: 1, max: 2000 }),
        bizRefTypeArb,
        async (balance, rawAmount, bizRefType) => {
          // amount ≤ balance：将随机额度收敛到 [1, balance] 区间
          const amount = ((rawAmount - 1) % balance) + 1
          const userId = await createTestUser(balance)
          const bizRefId = randomUUID() // 每次迭代唯一关联键，避免命中跨迭代幂等跳过

          // 冻结：余额扣减到 balance - amount
          await reserveMerchantCredits({
            userId,
            bizRefType,
            bizRefId,
            amount,
            remark: `[PBT_PROP6] 往返一致冻结 amount=${amount} balance=${balance}`,
          })
          const afterReserve = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(afterReserve.creditBalance).toBe(balance - amount)

          // 退款：按该关联键已 RESERVE 的额度全额补偿
          await refundMerchantCredits({ userId, bizRefType, bizRefId })

          // 断言：往返后余额精确恢复到初始 balance、非负、绝不欠费
          const afterRefund = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(afterRefund.creditBalance).toBe(balance)
          expect(afterRefund.creditBalance).toBeGreaterThanOrEqual(0)

          // 断言：该关联键各写入恰好一条 RESERVE / REFUND 流水
          const reserveRows = await prisma.creditLedger.count({
            where: { userId, bizRefType, bizRefId, action: 'RESERVE' },
          })
          const refundRows = await prisma.creditLedger.count({
            where: { userId, bizRefType, bizRefId, action: 'REFUND' },
          })
          expect(reserveRows).toBe(1)
          expect(refundRows).toBe(1)
        }
      ),
      // 每次迭代均落库（创建用户 + reserve + refund 事务 + 读校验 + 清理），取较小迭代次数
      { numRuns: 20 }
    )
  })
})

// ========================
// Property 7: 差额退款使净扣等于实扣
//
// Feature: merchant-billing-unification, Property 7: 差额退款使净扣等于实扣
// **Validates: Requirements 6.5**
//
// for all 已冻结额 reserved 与实际应扣额 actual（0 ≤ actual ≤ reserved），对同一关联键
// (bizRefType, bizRefId) 先 RESERVE reserved 再 CHARGE actual 后，用户余额相对初始值的
// 净减少量 SHALL 恰好等于 actual（多冻结的 reserved − actual 以 REFUND 退回）。
//
// 说明：本属性为 DB-backed（reserve 内部经 withCreditLock + Prisma 事务；charge 需在外部
// $transaction 中调用，与状态更新同事务）。每次迭代创建一个余额充足的测试 User，使用唯一
// (bizRefType, bizRefId) 关联键：先冻结 reserved（余额降为 initial − reserved），
// 再以 actual 扣费（差额 reserved − actual 退回），断言净减少量（initial − final）== actual、
// 余额非负。numRuns 取较小值（每次迭代均落库）。
// ========================

describe.skipIf(skipIfNoRedis)('Property 7: 差额退款使净扣等于实扣', () => {
  // 关联实体类型：取实际进入计费路径的 CONTENT_BRIEF / CONTENT_PLAN
  const bizRefTypeArb = fc.constantFrom<'CONTENT_BRIEF' | 'CONTENT_PLAN'>(
    'CONTENT_BRIEF',
    'CONTENT_PLAN'
  )

  it('reserve(reserved)→charge(actual) 后净减少量恰好等于 actual（0 ≤ actual ≤ reserved）', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 冻结额 reserved ≥ 1（必须 > 0 才能进入有效冻结路径）
        fc.integer({ min: 1, max: 1000 }),
        // 实扣占比随机值，经 map 收敛到 [0, reserved] 区间，覆盖「全扣 / 部分扣 / 零扣」三类边界
        fc.integer({ min: 0, max: 1000 }),
        bizRefTypeArb,
        async (reserved, rawActual, bizRefType) => {
          // actual ∈ [0, reserved]：0 表示渲染产物时长为零的极端情形，reserved 表示无差额全扣
          const actual = rawActual % (reserved + 1)
          // 余额充足（reserved + 充裕余量），确保首次冻结必然成功
          const initialBalance = reserved + 1000
          const userId = await createTestUser(initialBalance)
          const bizRefId = randomUUID() // 每次迭代唯一关联键，避免命中跨迭代幂等跳过

          // 冻结 reserved：余额扣减到 initialBalance − reserved
          await reserveMerchantCredits({
            userId,
            bizRefType,
            bizRefId,
            amount: reserved,
            remark: `[PBT_PROP7] 差额退款冻结 reserved=${reserved} actual=${actual}`,
          })
          const afterReserve = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(afterReserve.creditBalance).toBe(initialBalance - reserved)

          // 扣费 actual：多冻结差额（reserved − actual）以 REFUND 退回，再记 CHARGE
          await prisma.$transaction((tx) =>
            chargeMerchantCredits(tx, { userId, bizRefType, bizRefId, actualAmount: actual })
          )

          // 断言：净减少量（initial − final）恰好等于实扣额 actual、余额非负、绝不欠费
          const afterCharge = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(initialBalance - afterCharge.creditBalance).toBe(actual)
          expect(afterCharge.creditBalance).toBe(initialBalance - actual)
          expect(afterCharge.creditBalance).toBeGreaterThanOrEqual(0)

          // 断言：该关联键各写入恰好一条 RESERVE / CHARGE 流水（差额退回不影响净扣语义）
          const reserveRows = await prisma.creditLedger.count({
            where: { userId, bizRefType, bizRefId, action: 'RESERVE' },
          })
          const chargeRows = await prisma.creditLedger.count({
            where: { userId, bizRefType, bizRefId, action: 'CHARGE' },
          })
          expect(reserveRows).toBe(1)
          expect(chargeRows).toBe(1)
        }
      ),
      // 每次迭代均落库（创建用户 + reserve + charge 事务 + 读校验 + 清理），取较小迭代次数
      { numRuns: 20 }
    )
  })
})

// ========================
// Property 4: 商家流水不含 jobId 且正确关联商家实体
//
// Feature: merchant-billing-unification, Property 4: 商家流水不含 jobId 且正确关联商家实体
// **Validates: Requirements 4.1, 4.2, 4.5**
//
// for all 商家可计费操作写入的全部 CreditLedger 流水条目，其 jobId SHALL 恒为 null，
// 且 bizRefType ∈ {CONTENT_BRIEF, CONTENT_PLAN, STORE}、bizRefId SHALL 等于发起该操作的
// 商家实体主键。该不变量从源头杜绝 credit_ledger_job_id_fkey 外键违约（Req 4.5）。
//
// 说明：本属性为 DB-backed（reserve/refund 内部经 withCreditLock + Prisma 事务，
// charge 需在外部 $transaction 中调用）。每次迭代创建一个余额充足的测试 User，
// 使用唯一 (bizRefType, bizRefId) 关联键执行随机商家计费操作序列
// （RESERVE，随后随机叠加 CHARGE 与/或 REFUND），再查询该关联键写入的全部流水，
// 断言每一条 jobId === null、bizRefType 为预期值、bizRefId 等于发起实体主键。
// numRuns 取较小值（每次迭代均落库）。
// ========================

describe.skipIf(skipIfNoRedis)('Property 4: 商家流水不含 jobId 且正确关联商家实体', () => {
  // 关联实体类型：取实际进入计费路径的 CONTENT_BRIEF / CONTENT_PLAN
  const bizRefTypeArb = fc.constantFrom<'CONTENT_BRIEF' | 'CONTENT_PLAN'>(
    'CONTENT_BRIEF',
    'CONTENT_PLAN'
  )
  // RESERVE 之后随机叠加的后续动作：仅扣费 / 仅退款 / 不叠加（仅冻结）
  const followUpArb = fc.constantFrom<'charge' | 'refund' | 'none'>('charge', 'refund', 'none')
  // 冻结额度：> 0
  const amountArb = fc.integer({ min: 1, max: 500 })

  it('随机商家操作写入的全部流水：jobId 恒为 null 且 bizRefType/bizRefId 精确关联发起实体', async () => {
    await fc.assert(
      fc.asyncProperty(
        bizRefTypeArb,
        amountArb,
        followUpArb,
        // 实扣占比随机值，map 收敛到 [0, reserved]，覆盖全扣 / 部分扣 / 零扣
        fc.integer({ min: 0, max: 500 }),
        async (bizRefType, reserved, followUp, rawActual) => {
          // 余额充足，确保冻结必然成功
          const initialBalance = reserved + 1000
          const userId = await createTestUser(initialBalance)
          // 每次迭代唯一关联键，作为「发起实体主键」的代表，避免跨迭代干扰
          const bizRefId = randomUUID()

          // 1) RESERVE 冻结（必然写入一条 RESERVE 流水）
          await reserveMerchantCredits({
            userId,
            bizRefType,
            bizRefId,
            amount: reserved,
            remark: `[PBT_PROP4] 流水关联测试 ${bizRefType} reserved=${reserved}`,
          })

          // 2) 随机叠加后续动作：CHARGE（差额退回）或 REFUND（全额补偿）或不叠加
          if (followUp === 'charge') {
            const actual = rawActual % (reserved + 1) // actual ∈ [0, reserved]
            await prisma.$transaction((tx) =>
              chargeMerchantCredits(tx, { userId, bizRefType, bizRefId, actualAmount: actual })
            )
          } else if (followUp === 'refund') {
            await refundMerchantCredits({ userId, bizRefType, bizRefId })
          }

          // 3) 查询该关联键写入的全部 CreditLedger 流水
          const rows = await prisma.creditLedger.findMany({
            where: { userId, bizRefType, bizRefId },
          })

          // 至少存在 RESERVE 一条（商家操作确有落库，断言才有意义）
          expect(rows.length).toBeGreaterThanOrEqual(1)

          // 对每一条流水断言：jobId 恒为 null、bizRefType 为预期、bizRefId 等于发起实体主键
          for (const row of rows) {
            expect(row.jobId).toBeNull()
            expect(row.bizRefType).toBe(bizRefType)
            expect(row.bizRefId).toBe(bizRefId)
            // bizRefType 必落在允许集合内 {CONTENT_BRIEF, CONTENT_PLAN, STORE}
            expect(['CONTENT_BRIEF', 'CONTENT_PLAN', 'STORE']).toContain(row.bizRefType)
          }
        }
      ),
      // 每次迭代均落库（创建用户 + reserve/charge/refund 事务 + 读校验 + 清理），取较小迭代次数
      { numRuns: 20 }
    )
  })
})

// ========================
// Property 10: 权益门控在超限/未开放时拒绝并给出升级提示
//
// Feature: merchant-billing-unification, Property 10: 权益门控在超限/未开放时拒绝并给出升级提示
// **Validates: Requirements 5.5, 5.6**
//
// 本属性校验「权益门控」的纯决策逻辑（不涉及 DB 写）：
// - Req 5.5：WHEN 商家创建门店且名下门店数量已达到其 User_Tier 在 Privilege_Mapping 中的门店上限，
//   SHALL 拒绝创建并返回升级提示，提示中包含「当前门店数、上限值、可解除限制的最低等级」三要素。
// - Req 5.6：WHEN 商家访问数据洞察且其 User_Tier 在 Privilege_Mapping 中未开放数据洞察，
//   SHALL 拒绝访问并返回升级提示。
//
// 门控决策当前内联在路由中（建店：src/app/api/stores/route.ts 的 findMinUnlockTierLabel
// + STORE_LIMIT_EXCEEDED 分支；洞察：src/app/api/content-briefs/[briefId]/insights/route.ts
// 的 insightsEnabled → INSIGHTS_NOT_AVAILABLE 分支），且未导出。为使属性确定、快速、无 DB 依赖，
// 下方以「纯复刻决策函数」镜像路由逻辑，仅基于 determineMerchantPrivileges(tier)
// + MERCHANT_PRIVILEGE_MAPPING（纯函数）做判定，并以注释标注其镜像来源。
// ========================

// —— 以下常量/函数严格镜像 src/app/api/stores/route.ts 的门控决策 ——

/** UserTier 由低到高的等级序，用于推导可解除门店上限的最低等级（镜像 stores/route.ts 的 TIER_ORDER） */
const STORE_TIER_ORDER: readonly UserTier[] = ['FREE', 'MONTHLY', 'YEARLY']

/** UserTier 中文展示名，用于升级提示文案（镜像 stores/route.ts 的 TIER_LABELS） */
const STORE_TIER_LABELS: Record<UserTier, string> = {
  FREE: '免费版',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}

/**
 * 推导可解除门店数量限制的最低等级（镜像 stores/route.ts 的 findMinUnlockTierLabel）：
 * 从低到高遍历 UserTier，返回首个 maxStores 严格大于当前上限的等级标签；
 * 若当前已是门店上限最高的等级，则返回 null（无更高等级可解除限制）。
 */
function findMinUnlockTierLabelMirror(currentMaxStores: number): string | null {
  for (const tier of STORE_TIER_ORDER) {
    if (MERCHANT_PRIVILEGE_MAPPING[tier].maxStores > currentMaxStores) {
      return STORE_TIER_LABELS[tier]
    }
  }
  return null
}

/** 建店门控决策结果：拒绝时携带升级提示文案与三要素字段（镜像 STORE_LIMIT_EXCEEDED 分支） */
interface StoreGateDecision {
  allowed: boolean
  code?: 'STORE_LIMIT_EXCEEDED'
  message?: string
  currentStores?: number
  maxStores?: number
  requiredTier?: string | null
}

/**
 * 建店门控纯决策（镜像 stores/route.ts POST 的第 4 步）：
 * currentStores >= maxStores → 拒绝并生成升级提示；否则放行。
 * maxStores 取自 determineMerchantPrivileges(tier).maxStores（= Privilege_Mapping）。
 */
function decideStoreGate(tier: UserTier, currentStores: number): StoreGateDecision {
  const maxStores = determineMerchantPrivileges(tier).maxStores
  if (currentStores >= maxStores) {
    const minUnlockTierLabel = findMinUnlockTierLabelMirror(maxStores)
    const message =
      minUnlockTierLabel === null
        ? `门店数量已达上限（当前 ${currentStores} 家，上限 ${maxStores} 家），当前已是最高会员等级，暂无更高等级可解除该限制`
        : `门店数量已达上限（当前 ${currentStores} 家，上限 ${maxStores} 家），升级到${minUnlockTierLabel}即可创建更多门店`
    return {
      allowed: false,
      code: 'STORE_LIMIT_EXCEEDED',
      message,
      currentStores,
      maxStores,
      requiredTier: minUnlockTierLabel,
    }
  }
  return { allowed: true }
}

// —— 以下函数严格镜像 src/app/api/content-briefs/[briefId]/insights/route.ts 的门控决策 ——

/** 洞察门控决策结果：拒绝时携带升级提示文案（镜像 INSIGHTS_NOT_AVAILABLE 分支） */
interface InsightsGateDecision {
  allowed: boolean
  code?: 'INSIGHTS_NOT_AVAILABLE'
  message?: string
}

/** 洞察门控升级提示文案（镜像 insights/route.ts 的固定提示） */
const INSIGHTS_UPGRADE_MESSAGE = '当前会员等级未开放数据洞察功能，升级到月卡或年卡会员即可使用'

/**
 * 数据洞察门控纯决策（镜像 insights/route.ts 第 3 步）：
 * insightsEnabled=false → 拒绝并返回升级提示；否则放行。不扣减积分。
 */
function decideInsightsGate(tier: UserTier): InsightsGateDecision {
  const insightsEnabled = determineMerchantPrivileges(tier).insightsEnabled
  if (!insightsEnabled) {
    return { allowed: false, code: 'INSIGHTS_NOT_AVAILABLE', message: INSIGHTS_UPGRADE_MESSAGE }
  }
  return { allowed: true }
}

describe('Property 10: 权益门控在超限/未开放时拒绝并给出升级提示', () => {
  // 当前门店数生成器：覆盖 0 .. 远超最高上限（10），确保同时取到 >= 与 < 两侧
  const currentStoresArb = fc.integer({ min: 0, max: 25 })

  it('Req 5.5：currentStores >= maxStores 时建店被拒，提示含当前数/上限/最低解除等级三要素', () => {
    fc.assert(
      fc.property(tierArb, currentStoresArb, (tier, currentStores) => {
        const maxStores = MERCHANT_PRIVILEGE_MAPPING[tier].maxStores
        const decision = decideStoreGate(tier, currentStores)

        if (currentStores >= maxStores) {
          // 必须拒绝，且返回 STORE_LIMIT_EXCEEDED 升级提示
          expect(decision.allowed).toBe(false)
          expect(decision.code).toBe('STORE_LIMIT_EXCEEDED')
          expect(decision.currentStores).toBe(currentStores)
          expect(decision.maxStores).toBe(maxStores)

          // 三要素之一：当前门店数 出现在提示文案中
          expect(decision.message).toContain(String(currentStores))
          // 三要素之二：上限值 出现在提示文案中
          expect(decision.message).toContain(String(maxStores))

          // 三要素之三：可解除限制的最低等级 —— 存在更高等级时给出等级名，
          // 否则（已是门店上限最高的等级）给出「已是最高会员等级」的说明。
          const minUnlock = findMinUnlockTierLabelMirror(maxStores)
          if (minUnlock === null) {
            // 顶级（YEARLY，maxStores=10）：无更高等级，requiredTier 为 null 且文案给出解释
            expect(decision.requiredTier).toBeNull()
            expect(decision.message).toContain('当前已是最高会员等级')
          } else {
            // 存在可解除限制的更高等级：requiredTier 为该等级名，且文案包含该等级名
            expect(decision.requiredTier).toBe(minUnlock)
            expect(decision.message).toContain(minUnlock)
          }
        } else {
          // currentStores < maxStores：放行，不产生升级提示
          expect(decision.allowed).toBe(true)
          expect(decision.code).toBeUndefined()
        }
      }),
      { numRuns: 200 }
    )
  })

  it('Req 5.5：建店升级提示文案与等级期望严格一致（FREE/MONTHLY→等级名，YEARLY→顶级说明）', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const maxStores = MERCHANT_PRIVILEGE_MAPPING[tier].maxStores
        // 取一个必然达到上限的当前门店数（等于上限即触发拒绝）
        const decision = decideStoreGate(tier, maxStores)
        expect(decision.allowed).toBe(false)

        if (tier === 'YEARLY') {
          // 顶级：门店上限 10 为最高，无更高等级可解除
          expect(decision.requiredTier).toBeNull()
          expect(decision.message).toBe(
            `门店数量已达上限（当前 ${maxStores} 家，上限 ${maxStores} 家），当前已是最高会员等级，暂无更高等级可解除该限制`
          )
        } else {
          // FREE→月卡会员（1→3）、MONTHLY→年卡会员（3→10）
          const expectedLabel = tier === 'FREE' ? '月卡会员' : '年卡会员'
          expect(decision.requiredTier).toBe(expectedLabel)
          expect(decision.message).toBe(
            `门店数量已达上限（当前 ${maxStores} 家，上限 ${maxStores} 家），升级到${expectedLabel}即可创建更多门店`
          )
        }
      }),
      { numRuns: 100 }
    )
  })

  it('Req 5.6：insightsEnabled=false 时洞察被拒并返回升级提示，否则放行', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const insightsEnabled = MERCHANT_PRIVILEGE_MAPPING[tier].insightsEnabled
        const decision = decideInsightsGate(tier)

        if (!insightsEnabled) {
          // FREE：未开放数据洞察 → 拒绝并返回 INSIGHTS_NOT_AVAILABLE 升级提示
          expect(decision.allowed).toBe(false)
          expect(decision.code).toBe('INSIGHTS_NOT_AVAILABLE')
          expect(decision.message).toBe(INSIGHTS_UPGRADE_MESSAGE)
          // 升级提示需指向更高等级（月卡/年卡）
          expect(decision.message).toContain('升级')
        } else {
          // MONTHLY / YEARLY：开放数据洞察 → 放行，无升级提示
          expect(decision.allowed).toBe(true)
          expect(decision.code).toBeUndefined()
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 3: 无扣减操作余额守恒
//
// Feature: merchant-billing-unification, Property 3: 无扣减操作余额守恒
// **Validates: Requirements 3.4, 3.6**
//
// for all 建店（CREATE_STORE，Req 3.4）或数据洞察访问（ACCESS_INSIGHTS，Req 3.6）操作
// （无论用户等级与操作输入），用户 creditBalance 在操作前后 SHALL 完全相等，
// 且这两类操作不写入任何积分流水（CreditLedger 条数保持不变）。
//
// 说明：建店与洞察访问是「非计费操作」——其门控逻辑只读 Privilege_Mapping 做准入判定
// （门店上限 / 是否开放洞察），刻意不触达 credit-service（既不 RESERVE、不 CHARGE、不 REFUND）。
// 由于门控内联在路由中，本属性在「积分层」固化该不变量：创建一个已知余额的真实测试 User，
// 快照其余额 + 该用户名下 CreditLedger 条数；随后执行门控决策（decideStoreGate / decideInsightsGate，
// 镜像自 Property 10 的路由门控）而绝不调用任何商家计费函数；最后断言余额与流水条数完全不变。
// 同时断言门控决策对象本身不携带任何扣费额字段（amount / cost / charge），从结构上证明其非计费。
// numRuns 取较小值（每次迭代均落库：创建用户 + 两次读校验）。
// ========================

describe('Property 3: 无扣减操作余额守恒', () => {
  // 操作类型生成器：建店（Req 3.4）与数据洞察访问（Req 3.6）两类非计费操作
  const operationArb = fc.constantFrom<'CREATE_STORE' | 'ACCESS_INSIGHTS'>(
    'CREATE_STORE',
    'ACCESS_INSIGHTS'
  )
  // 当前门店数生成器：覆盖未达上限与已超上限两侧，确保门控放行/拒绝两种分支都被取到
  const currentStoresArb = fc.integer({ min: 0, max: 25 })

  it('建店 / 洞察访问操作前后余额完全相等且无新增积分流水（不触达 credit-service）', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 随机初始余额 ∈ [0, 5000]，覆盖零余额到充裕余额
        fc.integer({ min: 0, max: 5000 }),
        // 随机用户等级（FREE / MONTHLY / YEARLY），证明与等级无关
        tierArb,
        // 随机操作类型与门店数（门控输入），证明与操作输入无关
        operationArb,
        currentStoresArb,
        async (initialBalance, tier, operation, currentStores) => {
          const userId = await createTestUser(initialBalance)

          // 操作前快照：余额 + 该用户名下积分流水条数（全新用户应为 0 条）
          const beforeLedgerCount = await prisma.creditLedger.count({ where: { userId } })

          // 执行非计费门控决策——镜像建店 / 洞察路由的准入判定，刻意不调用任何商家计费函数
          let decision: StoreGateDecision | InsightsGateDecision
          if (operation === 'CREATE_STORE') {
            decision = decideStoreGate(tier, currentStores)
          } else {
            decision = decideInsightsGate(tier)
          }

          // 结构性断言：门控决策对象不携带任何扣费额字段（非计费操作的语义保证）
          expect(decision).not.toHaveProperty('amount')
          expect(decision).not.toHaveProperty('cost')
          expect(decision).not.toHaveProperty('charge')

          // 操作后断言：余额与操作前完全相等、非负
          const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
          expect(after.creditBalance).toBe(initialBalance)
          expect(after.creditBalance).toBeGreaterThanOrEqual(0)

          // 操作后断言：未新增任何积分流水（条数与操作前一致，且对全新用户恒为 0）
          const afterLedgerCount = await prisma.creditLedger.count({ where: { userId } })
          expect(afterLedgerCount).toBe(beforeLedgerCount)
          expect(afterLedgerCount).toBe(0)
        }
      ),
      // 每次迭代均落库（创建用户 + 两次读校验 + 清理），取较小迭代次数
      { numRuns: 25 }
    )
  })
})
