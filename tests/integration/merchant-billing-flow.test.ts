import 'dotenv/config'

/**
 * 集成测试：商家计费渲染补偿流程（merchant-billing-flow）
 *
 * 验证 spec「merchant-billing-unification」的失败补偿与差额退款语义（Req 6.1 / 6.5），
 * 走真实 PostgreSQL（Prisma）+ 真实 Redis 全局积分写锁（withCreditLock），
 * 不 mock 业务规则，断言被测的是真实的 credit-service byBizRef 计费逻辑。
 *
 * 被测路径（均以 (bizRefType, bizRefId) 为关联键，恒不写 jobId）：
 * - reserveCreditsByBizRef：渲染入队前按估算时长冻结积分（RESERVE）。
 * - chargeCreditsByBizRef：渲染成功后按实际时长扣费（CHARGE），多冻结差额以 REFUND 退回（Req 6.5）。
 * - refundCreditsByBizRef：渲染失败的全额补偿退款（REFUND），余额恢复至操作前（Req 6.1）。
 *
 * 运行前置：本机可达 localhost PostgreSQL（DATABASE_URL）与 localhost Redis（REDIS_URL）。
 *
 * 说明：本文件由 task 7.2 创建，task 12.1 将在此基础上「追加」更多用例（如外键违约校验、
 * Route 走积分/权益、会话导航、既有实体读写）——请按清晰的 describe 块分组追加，勿覆盖既有用例。
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { prisma } from '@/lib/shared/db'
import { redis } from '@/lib/shared/redis'
import {
  reserveCreditsByBizRef,
  chargeCreditsByBizRef,
  refundCreditsByBizRef,
} from '@/lib/shared/credit-service'

// PostgreSQL 连接检测：CI 环境无数据库时自动跳过整个测试文件
let pgAvailable = false
try {
  await prisma.$queryRaw`SELECT 1`
  pgAvailable = true
} catch {
  pgAvailable = false
  console.warn('⚠️ PostgreSQL 不可用，跳过集成测试文件: merchant-billing-flow.test.ts')
}

/** 仓库根目录（vitest 运行时 cwd 即仓库根），用于读取生产源码做结构断言 */
const REPO_ROOT = process.cwd()

/** 测试用商家实体关联类型：商家渲染挂账到 ContentBrief */
const BIZ_REF_TYPE = 'CONTENT_BRIEF'

/** 每个用例初始积分余额（足够覆盖冻结额，便于精确断言净扣减） */
const INITIAL_BALANCE = 1000

/** 当前用例的测试用户 ID（beforeEach 创建、afterEach 清理） */
let testUserId: string

/** 创建一个干净的测试用户，余额固定为 INITIAL_BALANCE */
async function createTestUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // 唯一邮箱，避免与既有数据/并发用例冲突
      email: `merchant-billing-test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: 'integration-test-placeholder-hash',
      creditBalance: INITIAL_BALANCE,
    },
  })
  return user.id
}

/** 读取用户当前余额 */
async function getBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  return user.creditBalance
}

beforeEach(async () => {
  testUserId = await createTestUser()
})

afterEach(async () => {
  // 先删流水（无外键阻塞），再删用户，保证测试隔离与可重复运行
  await prisma.creditLedger.deleteMany({ where: { userId: testUserId } })
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {
    // 用户可能已在用例内删除，忽略
  })
})

afterAll(async () => {
  // 释放外部连接，避免测试进程挂起
  await prisma.$disconnect()
  await redis.quit()
})

/** 缺少基础设施时跳过整组集成测试（环境变量缺失或 PostgreSQL 连接失败） */
const skipIfNoInfra = !process.env.DATABASE_URL || !process.env.REDIS_URL || !pgAvailable

describe.skipIf(skipIfNoInfra)('商家计费渲染补偿集成测试（真实 PostgreSQL + Redis 锁）', () => {
  describe('渲染成功路径：reserve → charge（差额退回，Req 6.5）', () => {
    it('实扣额小于冻结额时，多冻结差额自动退回，净扣减恰好等于实扣额', async () => {
      const bizRefId = `content-brief-success-${Date.now()}`
      const reserveAmount = 100 // 入队前按估算时长冻结
      const actualAmount = 60 // 渲染成功后按实际时长扣费（< 冻结额）

      // 1) RESERVE：入队前冻结，余额扣减冻结额
      await reserveCreditsByBizRef({
        userId: testUserId,
        bizRefType: BIZ_REF_TYPE,
        bizRefId,
        amount: reserveAmount,
        remark: '[MERCHANT_RENDER] 渲染冻结 100 积分',
      })
      expect(await getBalance(testUserId)).toBe(INITIAL_BALANCE - reserveAmount)

      // 2) CHARGE：渲染成功，在事务内按实际时长扣费，多冻结差额（100-60=40）以 REFUND 退回
      await prisma.$transaction(async (tx) => {
        await chargeCreditsByBizRef(tx, {
          userId: testUserId,
          bizRefType: BIZ_REF_TYPE,
          bizRefId,
          actualAmount,
        })
      })

      // 断言：净扣减恰好 == 实扣额，余额 == 初始 - 实扣额（Req 6.5）
      const finalBalance = await getBalance(testUserId)
      expect(finalBalance).toBe(INITIAL_BALANCE - actualAmount)
      expect(INITIAL_BALANCE - finalBalance).toBe(actualAmount)

      // 流水校验：存在 RESERVE / CHARGE，且差额触发一条 REFUND；商家流水恒不含 jobId
      const ledger = await prisma.creditLedger.findMany({
        where: { bizRefType: BIZ_REF_TYPE, bizRefId },
      })
      const actions = ledger.map((e) => e.action)
      expect(actions).toContain('RESERVE')
      expect(actions).toContain('CHARGE')
      expect(actions).toContain('REFUND') // 多冻结差额退回
      expect(ledger.every((e) => e.jobId === null)).toBe(true)
    })

    it('实扣额等于冻结额时，无差额退回，净扣减等于冻结额', async () => {
      const bizRefId = `content-brief-exact-${Date.now()}`
      const reserveAmount = 80
      const actualAmount = 80 // 实扣 == 冻结，无差额

      await reserveCreditsByBizRef({
        userId: testUserId,
        bizRefType: BIZ_REF_TYPE,
        bizRefId,
        amount: reserveAmount,
        remark: '[MERCHANT_RENDER] 渲染冻结 80 积分',
      })

      await prisma.$transaction(async (tx) => {
        await chargeCreditsByBizRef(tx, {
          userId: testUserId,
          bizRefType: BIZ_REF_TYPE,
          bizRefId,
          actualAmount,
        })
      })

      expect(await getBalance(testUserId)).toBe(INITIAL_BALANCE - actualAmount)

      // 无差额时不应产生 REFUND 流水
      const refundCount = await prisma.creditLedger.count({
        where: { bizRefType: BIZ_REF_TYPE, bizRefId, action: 'REFUND' },
      })
      expect(refundCount).toBe(0)
    })
  })

  describe('渲染失败路径：reserve → refund（余额完全恢复，Req 6.1）', () => {
    it('渲染失败时按关联键全额退款，余额恢复至操作发生前', async () => {
      const bizRefId = `content-brief-failure-${Date.now()}`
      const reserveAmount = 120

      // 1) RESERVE：入队前冻结
      await reserveCreditsByBizRef({
        userId: testUserId,
        bizRefType: BIZ_REF_TYPE,
        bizRefId,
        amount: reserveAmount,
        remark: '[MERCHANT_RENDER] 渲染冻结 120 积分',
      })
      expect(await getBalance(testUserId)).toBe(INITIAL_BALANCE - reserveAmount)

      // 2) REFUND：渲染失败，全额补偿退款
      await refundCreditsByBizRef({
        userId: testUserId,
        bizRefType: BIZ_REF_TYPE,
        bizRefId,
      })

      // 断言：余额恢复至初始值（冻结—退款往返一致，Req 6.1）
      expect(await getBalance(testUserId)).toBe(INITIAL_BALANCE)

      // 流水校验：存在 RESERVE 与 REFUND，且恒不含 jobId
      const ledger = await prisma.creditLedger.findMany({
        where: { bizRefType: BIZ_REF_TYPE, bizRefId },
      })
      const actions = ledger.map((e) => e.action)
      expect(actions).toContain('RESERVE')
      expect(actions).toContain('REFUND')
      expect(ledger.every((e) => e.jobId === null)).toBe(true)
    })

    it('退款幂等：重复 refund 不重复增加余额', async () => {
      const bizRefId = `content-brief-failure-idem-${Date.now()}`
      const reserveAmount = 50

      await reserveCreditsByBizRef({
        userId: testUserId,
        bizRefType: BIZ_REF_TYPE,
        bizRefId,
        amount: reserveAmount,
        remark: '[MERCHANT_RENDER] 渲染冻结 50 积分',
      })

      // 连续两次退款，第二次应被幂等跳过
      await refundCreditsByBizRef({ userId: testUserId, bizRefType: BIZ_REF_TYPE, bizRefId })
      await refundCreditsByBizRef({ userId: testUserId, bizRefType: BIZ_REF_TYPE, bizRefId })

      // 余额仍只恢复一次，不重复增加
      expect(await getBalance(testUserId)).toBe(INITIAL_BALANCE)

      const refundCount = await prisma.creditLedger.count({
        where: { bizRefType: BIZ_REF_TYPE, bizRefId, action: 'REFUND' },
      })
      expect(refundCount).toBe(1)
    })
  })
})

// ============================================================================
// task 12.1 追加用例（在 7.2 渲染补偿用例基础上扩充，覆盖 Req 4.5 / 2.3 / 8.2 / 7.1）
// ============================================================================

describe.skipIf(skipIfNoInfra)('商家流水写入不触发 jobId 外键违约（Req 4.5，真实 PostgreSQL）', () => {
  // 商家操作无对应 GenerationJob：写 CreditLedger 时 jobId 恒为 null，关联恒走 bizRefType/bizRefId，
  // 从源头杜绝 credit_ledger_job_id_fkey 外键违约。此处对三种商家实体类型各写一笔并提交，
  // 断言提交不抛任何外键错误，且落库行 jobId 为 null、bizRefType/bizRefId 正确。
  const bizRefTypes = ['CONTENT_BRIEF', 'CONTENT_PLAN', 'STORE'] as const

  for (const bizRefType of bizRefTypes) {
    it(`bizRefType=${bizRefType} 写入商家流水提交成功且不触发 credit_ledger_job_id_fkey`, async () => {
      const bizRefId = `${bizRefType.toLowerCase()}-fk-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const amount = 30

      // reserveCreditsByBizRef 内部经 withCreditLock + 事务提交，若误写 jobId 会在提交时触发外键违约。
      // 用 resolves 断言整个提交过程不抛错（即不出现 credit_ledger_job_id_fkey 违约）。
      await expect(
        reserveCreditsByBizRef({
          userId: testUserId,
          bizRefType,
          bizRefId,
          amount,
          remark: `[MERCHANT_BILLING] ${bizRefType} 流水外键校验`,
        })
      ).resolves.toBeUndefined()

      // 查询落库行：jobId 必须为 null，bizRefType/bizRefId 必须正确填充（Req 4.1 / 4.2 / 4.5）
      const row = await prisma.creditLedger.findFirstOrThrow({
        where: { bizRefType, bizRefId, action: 'RESERVE' },
      })
      expect(row.jobId).toBeNull()
      expect(row.bizRefType).toBe(bizRefType)
      expect(row.bizRefId).toBe(bizRefId)
      expect(row.userId).toBe(testUserId)
    })
  }
})

describe.skipIf(skipIfNoInfra)('各 Route 改造后走积分/权益，不再引用额度逻辑（Req 2.3，结构断言）', () => {
  // 废除额度体系后：merchant-quota-service 整文件应已删除，且改造后的各 Route 不得再 import 该模块。
  // 用确定性的源码静态断言验证（不依赖运行中的服务），避免误判注释中提及的历史 checkMerchantQuota 字样。
  const QUOTA_IMPORT_RE = /from\s+['"]@\/lib\/merchant-quota-service['"]/

  it('merchant-quota-service.ts 整文件已删除（Req 2.1）', () => {
    expect(existsSync(resolve(REPO_ROOT, 'src/lib/merchant-quota-service.ts'))).toBe(false)
  })

  // 改造后的本地生活计费/权益相关 Route，逐个断言不再 import 额度服务
  const billingRoutes = [
    'src/app/api/content-briefs/[briefId]/render/route.ts',
    'src/app/api/stores/[storeId]/content-plan/generate/route.ts',
    'src/app/api/video-variants/[variantId]/export/route.ts',
    'src/app/api/content-briefs/[briefId]/insights/route.ts',
    'src/app/api/stores/route.ts',
    'src/app/api/merchant/subscription/route.ts',
  ]

  for (const routePath of billingRoutes) {
    it(`${routePath} 不再 import merchant-quota-service`, () => {
      const abs = resolve(REPO_ROOT, routePath)
      expect(existsSync(abs)).toBe(true)
      const src = readFileSync(abs, 'utf-8')
      // 断言不存在对额度服务的 import 语句（注释中提及历史字样不会命中此正则）
      expect(QUOTA_IMPORT_RE.test(src)).toBe(false)
    })
  }

  it('计费 Route 改为引用统一积分/权益服务（merchant-billing-service / privilege-engine）', () => {
    const renderSrc = readFileSync(
      resolve(REPO_ROOT, 'src/app/api/content-briefs/[briefId]/render/route.ts'),
      'utf-8'
    )
    // 渲染路由走统一积分计费封装（路径含 merchant/ 子目录或 shared/ 子目录）
    expect(/from\s+['"]@\/lib\/(merchant\/)?merchant-billing-service['"]/.test(renderSrc)).toBe(true)

    const insightsSrc = readFileSync(
      resolve(REPO_ROOT, 'src/app/api/content-briefs/[briefId]/insights/route.ts'),
      'utf-8'
    )
    // 洞察路由走统一权益引擎（路径含 shared/ 子目录）
    expect(/from\s+['"]@\/lib\/(shared\/)?privilege-engine['"]/.test(insightsSrc)).toBe(true)
  })
})

describe.skipIf(skipIfNoInfra)('同一 JWT 会话访问 /merchant 与 /dashboard 均放行（Req 8.2，中间件配置断言）', () => {
  // Req 8.2：已登录会话在本地生活主框架（/merchant）与视频重塑模块（/dashboard）间导航无需重新认证。
  // middleware.ts 对两类受保护页面走同一条注入分支（PROTECTED_PAGE_PREFIXES + 同一 x-user-id/x-user-role 注入），
  // 用源码结构断言验证两前缀都被同一保护路径覆盖（不要求启动真实服务）。
  const middlewareSrc = readFileSync(resolve(REPO_ROOT, 'src/middleware.ts'), 'utf-8')

  it('PROTECTED_PAGE_PREFIXES 同时覆盖 /dashboard 与 /merchant', () => {
    const m = middlewareSrc.match(/PROTECTED_PAGE_PREFIXES\s*=\s*\[([^\]]*)\]/)
    expect(m).not.toBeNull()
    const prefixes = m![1]
    expect(prefixes).toContain("'/dashboard'")
    expect(prefixes).toContain("'/merchant'")
  })

  it('matcher 配置同时匹配 /dashboard 与 /merchant', () => {
    const m = middlewareSrc.match(/matcher:\s*\[([^\]]*)\]/)
    expect(m).not.toBeNull()
    const matcher = m![1]
    expect(matcher).toContain('/dashboard/:path*')
    expect(matcher).toContain('/merchant')
  })

  it('两类受保护页面共用同一套 x-user-id / x-user-role 注入逻辑', () => {
    // 注入语句在中间件内对 API 与页面分支各出现一次，两者注入的请求头键完全一致，
    // 说明 /merchant 与 /dashboard（同属页面分支）经同一 JWT 校验+注入路径放行。
    const userIdInjections = middlewareSrc.match(/requestHeaders\.set\('x-user-id'/g) ?? []
    const userRoleInjections = middlewareSrc.match(/requestHeaders\.set\('x-user-role'/g) ?? []
    expect(userIdInjections.length).toBeGreaterThanOrEqual(1)
    expect(userRoleInjections.length).toBe(userIdInjections.length)
  })
})

describe.skipIf(skipIfNoInfra)('既有 Merchant/Store/ContentBrief/VideoVariant 读写正常（Req 7.1，真实 PostgreSQL）', () => {
  // 体系收敛（废除额度）后，业务实体模型保持不变，既有记录仍可正常创建/读取/更新/删除。
  // 本用例端到端创建 Merchant → Store → ContentBrief → VideoVariant，断言读写正常，最后全部清理。
  it('创建并读写整条商家业务实体链路，且收敛后无 schema 破坏', async () => {
    // 1) Merchant（与测试用户一对一关联）
    const merchant = await prisma.merchant.create({
      data: {
        userId: testUserId,
        name: '集成测试商家',
        industry: 'RESTAURANT',
      },
    })

    // 2) Store（归属 Merchant）
    const store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        name: '集成测试门店',
        industry: 'RESTAURANT',
        city: '上海',
        mainProducts: ['招牌牛肉面', '小笼包'],
        mainSellingPoints: ['现做现卖', '汤底熬制8小时'],
      },
    })

    // 3) ContentBrief（归属 Store）
    const brief = await prisma.contentBrief.create({
      data: {
        storeId: store.id,
        title: '工作日午市引流短视频',
        goal: 'TRAFFIC',
        scheduledDate: new Date(),
        status: 'DRAFT',
      },
    })

    // 4) VideoVariant（归属 ContentBrief）
    const variant = await prisma.videoVariant.create({
      data: {
        contentBriefId: brief.id,
        type: 'PROMOTION',
        title: '促销版-15秒',
        durationSec: 15,
      },
    })

    try {
      // 读取校验：四类实体均可正常读出，关联关系正确
      const readBack = await prisma.merchant.findUniqueOrThrow({
        where: { id: merchant.id },
        include: { stores: { include: { contentBriefs: { include: { videoVariants: true } } } } },
      })
      expect(readBack.userId).toBe(testUserId)
      expect(readBack.stores).toHaveLength(1)
      expect(readBack.stores[0].id).toBe(store.id)
      expect(readBack.stores[0].contentBriefs).toHaveLength(1)
      expect(readBack.stores[0].contentBriefs[0].id).toBe(brief.id)
      expect(readBack.stores[0].contentBriefs[0].videoVariants).toHaveLength(1)
      expect(readBack.stores[0].contentBriefs[0].videoVariants[0].id).toBe(variant.id)

      // 写入校验：更新 ContentBrief 状态（模拟渲染流转），读回确认持久化
      const updated = await prisma.contentBrief.update({
        where: { id: brief.id },
        data: { status: 'GENERATED' },
      })
      expect(updated.status).toBe('GENERATED')

      // JSON 字段读写正常（mainProducts 为 string[]）
      const storeReadBack = await prisma.store.findUniqueOrThrow({ where: { id: store.id } })
      expect(storeReadBack.mainProducts).toEqual(['招牌牛肉面', '小笼包'])
    } finally {
      // 清理：删除 Merchant 级联清除 Store → ContentBrief → VideoVariant，避免污染
      await prisma.merchant.delete({ where: { id: merchant.id } }).catch(() => {
        // 已被其他清理删除则忽略
      })
    }
  })
})
