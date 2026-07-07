import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'fs'
import path from 'path'

// Mock db/redis 模块，避免 DATABASE_URL 缺失导致的初始化错误（credit-service 间接 import db）
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => vi.fn() })
}))

/**
 * Feature: video-pipeline-fixes（Bug 修复）
 * Property 1: Bug Condition - 视频流水线计费与状态缺陷复现（修复前探索性测试）
 *
 * **Validates: Requirements 2.1, 2.2, 2.4, 2.6, 2.7, 2.9**
 *
 * ⚠️ 本文件为「Bug 条件探索性测试」，按 Bug 修复方法论编写：
 *   - 这些断言编码的是【修复后】的期望行为（对应 design.md 的 Property 1/2/3/5/6/8）。
 *   - 在【未修复】代码上运行【必然失败】——失败即证明缺陷真实存在。
 *   - 失败时不得去改测试或改代码（本阶段只复现、不修复）。
 *   - 修复完成后重跑本测试应转为通过，即验证修复成功。
 *
 * 覆盖缺陷：1（解析白嫖/兜底扣至 0）、2（废弃首帧 +10 多扣）、
 *          4（项目级分段 CHARGE 缺幂等）、6（合并失败写错状态）、
 *          7（PARTIAL/COMPLETED 死状态）、9（.env.example 与代码脱节）。
 */

const REPO_ROOT = process.cwd()

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8')
}

// ============================================================
// 缺陷 1（PBT/scoped）：解析阶段无余额预检、可被零余额白嫖
// design isBugCondition_1：余额不足却仍兜底扣至 0（actualCharge = min(balance, amount)）
// 期望行为（Property 1）：余额不足时绝不兜底扣至 0、绝不产生欠费——必须拒绝（抛错）
// ============================================================

/**
 * Prisma 事务客户端最小内存替身：只实现 chargeParseCreditsTx 真正调用的方法
 * （user.findUniqueOrThrow / user.update / creditLedger.create），
 * 用真实数据驱动【真实】的 chargeParseCreditsTx 函数，不伪造其内部逻辑。
 */
function makeInMemoryTx(userId: string, initialBalance: number) {
  const state = { balance: initialBalance }
  const ledger: Array<{ action: string; amount: number; balanceAfter: number; remark: string }> = []
  const tx = {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async findUniqueOrThrow(_args: unknown) {
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

describe('缺陷 1：解析阶段余额预检 / 禁止兜底扣至 0（Property 1）', () => {
  it('余额不足时 chargeParseCreditsTx 必须拒绝，绝不兜底扣至 0、绝不产生欠费', async () => {
    // 动态 import 真实 credit-service（真实接口、真实流程）
    const { chargeParseCreditsTx } = await import('@/lib/shared/credit-service')

    await fc.assert(
      fc.asyncProperty(
        // 余额 0..(cost-1)，即恒小于预估成本，命中 isBugCondition_1
        fc.integer({ min: 0, max: 39 }),
        fc.integer({ min: 40, max: 200 }),
        async (balance, cost) => {
          const { tx, ledger } = makeInMemoryTx('user-1', balance)

          let rejected = false
          try {
            // @ts-expect-error 内存替身满足被调用到的 Prisma 接口子集
            await chargeParseCreditsTx(tx, 'user-1', 'project-1', cost)
          } catch {
            rejected = true
          }

          if (rejected) return // 期望：余额不足直接拒绝

          // 若未拒绝（当前未修复行为），则绝不允许出现「兜底扣不足额」的 CHARGE：
          // 期望修复后扣费额度恰为应扣全额（无 min 兜底）、且无欠费备注
          const charge = ledger.find((e) => e.action === 'CHARGE')
          expect(charge, '余额不足却未拒绝又无 CHARGE 记录').toBeDefined()
          expect(Math.abs(charge!.amount), '兜底扣至不足额=白嫖（缺陷）').toBe(cost)
          expect(charge!.remark, '出现欠费备注=兜底扣至 0（缺陷）').not.toMatch(/欠|不足/)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 缺陷 2（scoped）：废弃首帧固定 +10 仍计费
// design isBugCondition_2：estimateParseCreditCost(d) == ceil(d*0.5) + 10
// 期望行为（Property 2）：== ceil(d*0.5)
// ============================================================

describe('缺陷 2：解析计费仅含真实消费、移除废弃首帧 +10（Property 2）', () => {
  it('estimateParseCreditCost(60) 必须等于 30（修复后；未修复返回 40）', async () => {
    const { estimateParseCreditCost } = await import('@/lib/shared/credit-service')
    expect(estimateParseCreditCost(60)).toBe(30)
  })

  it('对任意时长 estimateParseCreditCost(d) 必须等于 ceil(d*0.5)', async () => {
    const { estimateParseCreditCost } = await import('@/lib/shared/credit-service')
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), (duration) => {
        expect(estimateParseCreditCost(duration)).toBe(Math.ceil(duration * 0.5))
      }),
      { numRuns: 200 }
    )
  })
})

// ============================================================
// 缺陷 4（scoped）：项目级分段生成 CHARGE 缺幂等
// design isBugCondition_4：同一 jobId 重试时无 existingCharge 检查、无条件 create
// 期望行为（Property 3）：重复 jobId 仅一条 CHARGE
//
// 说明：processProjectSegmentGenerate 内联 CHARGE 深度耦合 Seedance/OSS/锁，
// 无法在单测中整体运行；此处用最小内存 tx 替身驱动【真实】的统一扣费函数
// chargeCreditsTx（修复后两条生成路径均收敛调用它），不伪造其内部逻辑。
// 预置 RESERVE 模拟项目级分段任务创建时的冻结，重复调用模拟队列重试。
// 未修复（无 existingCharge 幂等的内联实现）会重复写 CHARGE；修复后应仅一条。
// ============================================================

interface SegLedgerEntry {
  jobId?: string
  projectId?: string
  action: string
  amount: number
  balanceAfter: number
  remark: string
}

/**
 * Prisma 事务客户端最小内存替身：实现 chargeCreditsTx 真正调用的方法
 * （creditLedger.findFirst / creditLedger.create / user.findUniqueOrThrow / user.update），
 * 按 jobId|projectId + action 过滤流水，用真实数据驱动【真实】chargeCreditsTx。
 */
function makeChargeTx(userId: string, initialBalance: number) {
  const state = { balance: initialBalance }
  const ledger: SegLedgerEntry[] = []
  const matches = (e: SegLedgerEntry, where: Record<string, unknown>) =>
    (where.jobId === undefined || e.jobId === where.jobId) &&
    (where.projectId === undefined || e.projectId === where.projectId) &&
    (where.action === undefined || e.action === where.action)
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
      async findFirst(args: { where: Record<string, unknown> }) {
        return ledger.find((e) => matches(e, args.where)) ?? null
      },
      async create(args: { data: SegLedgerEntry }) {
        ledger.push(args.data)
        return args.data
      },
    },
  }
  return { tx, state, ledger }
}

describe('缺陷 4：项目级分段扣费幂等（Property 3）', () => {
  it('同一 jobId 再次进入扣费事务（重试）时不得新增 CHARGE，仅保留一条', async () => {
    const { chargeCreditsTx } = await import('@/lib/shared/credit-service')

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 2, max: 3 }), // attempts=3：模拟队列重试次数
        async (rawJobId, cost, attempts) => {
          const jobId = `job-${rawJobId}`
          const { tx, ledger } = makeChargeTx('user-1', 100000)

          // 预置 RESERVE：项目级分段任务创建时已冻结该 jobId 的积分（reserved == cost，无差额）
          ledger.push({ jobId, action: 'RESERVE', amount: -cost, balanceAfter: 100000 - cost, remark: 'reserve' })

          // 模拟队列重试：同一 jobId 多次进入成功事务扣费
          for (let i = 0; i < attempts; i++) {
            // @ts-expect-error 内存替身满足被调用到的 Prisma 接口子集
            await chargeCreditsTx(tx, { userId: 'user-1', jobId, actualAmount: cost })
          }

          const charges = ledger.filter((e) => e.jobId === jobId && e.action === 'CHARGE')
          expect(charges, '重试导致重复写入 CHARGE（缺陷）').toHaveLength(1)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 缺陷 6（scoped）：合并失败写错状态
// design isBugCondition_6：合并失败写 'FAILED'，注释却称 MERGE_FAILED，且枚举无 MERGE_FAILED
// 期望行为（Property 5）：合并失败写 MERGE_FAILED，且枚举含 MERGE_FAILED
// ============================================================

describe('缺陷 6：合并失败状态可区分 MERGE_FAILED（Property 5）', () => {
  it('merge-video.ts 失败分支必须写 status MERGE_FAILED（未修复写 FAILED）', () => {
    const src = readRepoFile('src/workers/merge-video.ts')
    // 真实写入点（非注释）：catch 分支 prisma.project.update 的 data.status
    const writesMergeFailed = /status:\s*['"]MERGE_FAILED['"]/.test(src)
    expect(writesMergeFailed, '合并失败分支未写 MERGE_FAILED（缺陷）').toBe(true)
  })

  it('ProjectStatus 枚举必须包含 MERGE_FAILED（schema + enums.ts）', () => {
    const schema = readRepoFile('prisma/schema.prisma')
    const enums = readRepoFile('src/types/enums.ts')
    expect(schema.includes('MERGE_FAILED'), 'schema.prisma 缺少 MERGE_FAILED（缺陷）').toBe(true)
    expect(enums.includes('MERGE_FAILED'), 'enums.ts ProjectStatusSchema 缺少 MERGE_FAILED（缺陷）').toBe(true)
  })
})

// ============================================================
// 缺陷 7（边界扫描）：PARTIAL / COMPLETED 死状态
// design isBugCondition_7：枚举中存在但无任何 worker 写入点
// 期望行为（Property 6）：要么有真实 Project 写入点，要么从枚举清理移除
// ============================================================

describe('缺陷 7：PARTIAL/COMPLETED 死状态归属明确（Property 6）', () => {
  // 仅扫描真正会更新 Project.status 的流水线文件（download-video 写的是 DownloadTask，不计入）
  const projectStatusWriters = [
    'src/workers/parse-video.ts',
    'src/workers/generate-video.ts',
    'src/workers/merge-video.ts',
  ]

  for (const deadState of ['PARTIAL', 'COMPLETED'] as const) {
    it(`${deadState} 必须有真实 Project 写入点，或已从 ProjectStatusSchema 清理移除`, () => {
      const enums = readRepoFile('src/types/enums.ts')
      // 定位 ProjectStatusSchema 的枚举定义片段
      const schemaMatch = enums.match(/ProjectStatusSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/)
      expect(schemaMatch, '未找到 ProjectStatusSchema 定义').not.toBeNull()
      const inEnum = new RegExp(`['"]${deadState}['"]`).test(schemaMatch![1])

      const writeRe = new RegExp(`status:\\s*['"]${deadState}['"]`)
      const hasProjectWriteSite = projectStatusWriters.some((f) => writeRe.test(readRepoFile(f)))

      // 死状态：仍在枚举内却无任何 Project 写入点 → 缺陷
      expect(
        !inEnum || hasProjectWriteSite,
        `${deadState} 仍在 ProjectStatusSchema 内但无真实 Project 写入点（死状态缺陷）`
      ).toBe(true)
    })
  }
})

// ============================================================
// 缺陷 9（scoped）：.env.example 与真实代码脱节
// design isBugCondition_9：缺 VISION_*；含 GEMINI Mock 误导；残留 FLUX/Seedream
// 期望行为（Property 8）：含 VISION_*，无 Mock 误导，无 FLUX/Seedream 残留
// ============================================================

describe('缺陷 9：.env.example 与真实代码一致（Property 8）', () => {
  it('必须包含 VISION_API_URL / VISION_API_KEY / VISION_MODEL', () => {
    const env = readRepoFile('.env.example')
    expect(env.includes('VISION_API_URL'), '.env.example 缺少 VISION_API_URL（缺陷）').toBe(true)
    expect(env.includes('VISION_API_KEY'), '.env.example 缺少 VISION_API_KEY（缺陷）').toBe(true)
    expect(env.includes('VISION_MODEL'), '.env.example 缺少 VISION_MODEL（缺陷）').toBe(true)
  })

  it('不得保留 GEMINI_API_KEY 的「Mock 模式」误导说明', () => {
    const env = readRepoFile('.env.example')
    expect(/Mock\s*模式|模拟分镜|GEMINI_API_KEY/.test(env), '.env.example 残留 GEMINI Mock 误导（缺陷）').toBe(false)
  })

  it('不得残留已废弃的 FLUX / Seedream / meai.cloud 表述', () => {
    const env = readRepoFile('.env.example')
    expect(/FLUX/i.test(env), '.env.example 残留 FLUX（缺陷）').toBe(false)
    expect(/Seedream|meai\.cloud/i.test(env), '.env.example 残留 Seedream/meai.cloud（缺陷）').toBe(false)
  })
})
