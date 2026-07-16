/**
 * 积分服务
 * 提供冻结、扣除、返还、充值积分的事务安全操作
 */
import { z } from 'zod/v4'
import { Prisma } from '@/generated/prisma'
import { prisma } from './db'
import { ApiError } from './api-error'
import { withCreditLock } from './distributed-lock'

// 纯计算函数从 credit-calc.ts 重导出（服务端既有 import 不受影响）
export { estimateUpscaleCreditCost, estimateCreditCost, estimateParseCreditCost, estimateHappyHorseCreditCost, calculateHappyHorseActualCost } from './credit-calc'
export type { UpscaleResolution } from './credit-calc'

// ========================
// Zod 参数校验 Schema
// ========================

const topupInputSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  credits: z.number().int().positive('充值积分数必须为正整数'),
  orderId: z.string().min(1, '订单ID不能为空'),
  remark: z.string().optional(),
})

export type TopupInput = z.infer<typeof topupInputSchema>

/**
 * 按组时长与分辨率估算积分消耗
 * 复用 estimateCreditCost 公式：ceil(groupDuration × (resolution === '720p' ? 1.5 : 1.0))
 * 纯函数，按 Shot_Group 总时长而非单个 Shot 结算
 */
export function estimateGroupCreditCost(groupDuration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(groupDuration * multiplier)
}

/**
 * 解析前积分冻结（RESERVE，真实扣减余额 + 写流水）
 *
 * 与生成阶段 reserveCredits 同模型：入队后、消耗外部资源前真实冻结积分，
 * 消除「解析期间余额被其他操作花光→成功后扣费失败→白消耗外部资源」的并发竞态。
 *
 * 解析成功时由 chargeParseCreditsFromReserve 记账（余额不再二次变动）；
 * 解析失败时由 refundParseCredits 退还冻结积分。
 *
 * 幂等：按 projectId 关联 RESERVE 流水，重试时已存在则跳过（不重复冻结）。
 *
 * @param userId 用户 ID
 * @param projectId 项目 ID（作为幂等键）
 * @param amount 冻结额度
 */
export async function freezeParseCredits(
  userId: string,
  projectId: string,
  amount: number
): Promise<void> {
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // 幂等：已存在该 projectId 的 RESERVE 则跳过（重试场景）
      const existing = await tx.creditLedger.findFirst({
        where: { projectId, action: 'RESERVE' },
      })
      if (existing) return

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.creditBalance < amount) {
        throw new ApiError(
          'INSUFFICIENT_CREDITS',
          `积分不足：解析需 ${amount} 积分，当前余额 ${user.creditBalance}`,
          402
        )
      }
      const newBalance = user.creditBalance - amount
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          projectId,
          action: 'RESERVE',
          amount: -amount,
          balanceAfter: newBalance,
          remark: `解析冻结 ${amount} 积分`,
        },
      })
    })
  , 'freezeParseCredits')
}

/**
 * 解析成功记账（CHARGE，基于已有 RESERVE，余额不再二次变动）
 *
 * 在 Prisma 事务中写入 CHARGE 流水（projectId 关联）。
 * 余额已在 freezeParseCredits 时扣减，此处仅记账。
 * 幂等：已存在该 projectId 的 CHARGE 记录则跳过。
 *
 * @param tx Prisma 事务客户端（与置 EDITABLE 同事务）
 * @param userId 用户 ID
 * @param projectId 项目 ID
 * @param amount 扣费额度
 */
export async function chargeParseCreditsFromReserve(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  amount: number
): Promise<void> {
  // 幂等：已扣费则跳过
  const existing = await tx.creditLedger.findFirst({
    where: { projectId, action: 'CHARGE' },
  })
  if (existing) return

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  await tx.creditLedger.create({
    data: {
      userId,
      projectId,
      action: 'CHARGE',
      amount: -amount,
      balanceAfter: user.creditBalance, // 余额在 RESERVE 时已扣，此处不再变动
      remark: `解析扣费 ${amount} 积分`,
    },
  })
}

/**
 * 解析失败退还冻结积分（REFUND，按 projectId 幂等）
 *
 * @param userId 用户 ID
 * @param projectId 项目 ID
 * @param amount 退还额度
 */
export async function refundParseCredits(
  userId: string,
  projectId: string,
  amount: number
): Promise<void> {
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // 幂等：已有该 projectId 的 REFUND 则跳过
      const existing = await tx.creditLedger.findFirst({
        where: { projectId, action: 'REFUND' },
      })
      if (existing) return

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + amount
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          projectId,
          action: 'REFUND',
          amount,
          balanceAfter: newBalance,
          remark: `解析失败退还 ${amount} 积分`,
        },
      })
    })
  , 'refundParseCredits')
}

/**
 * 导出阶段积分冻结（RESERVE，按 projectId 关联，无 jobId 外键）
 *
 * 与 freezeParseCredits 同模型：入队前真实冻结积分，成功时由 merge Worker 记账，失败时退还。
 * 幂等：按 projectId + action='RESERVE' + remark 前缀 `[EXPORT]` 去重，重试不重复冻结。
 *
 * 注意：不能使用 reserveCredits（该函数写 jobId 字段，有 GenerationJob 外键约束），
 * 导出阶段无 GenerationJob，必须走 projectId 关联。
 *
 * @param userId 用户 ID
 * @param projectId 项目 ID（幂等键）
 * @param amount 冻结额度
 */
export async function freezeExportCredits(
  userId: string,
  projectId: string,
  amount: number
): Promise<void> {
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // P0 修复：幂等键使用固定前缀 `[EXPORT]` 而非 `contains: '导出'`（中文文案），避免因文案变动导致幂等失效
      const existing = await tx.creditLedger.findFirst({
        where: { projectId, action: 'RESERVE', remark: { startsWith: '[EXPORT]' } },
      })
      if (existing) return

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.creditBalance < amount) {
        throw new ApiError(
          'INSUFFICIENT_CREDITS',
          `积分不足：导出超分需 ${amount} 积分，当前余额 ${user.creditBalance}`,
          402
        )
      }
      const newBalance = user.creditBalance - amount
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          projectId,
          action: 'RESERVE',
          amount: -amount,
          balanceAfter: newBalance,
          remark: `[EXPORT] 导出超分冻结 ${amount} 积分`,
        },
      })
    })
  , 'freezeExportCredits')
}

/**
 * 计算某商家关联键 (bizRefType, bizRefId) 当前「进行中」的冻结净额（pending）。
 *
 * 商家计费恒以 (bizRefType, bizRefId) 为关联键，一个 briefId 在其生命周期内可能经历
 * 多轮「冻结 →（成功扣费 | 失败退款）」——失败后用户重新提交同一 briefId 会开启新一轮。
 * 旧幂等键仅按 (bizRefType, bizRefId, action) 判断「是否存在」，无法区分轮次：
 * 失败退款后重提交会因已存在 RESERVE 而跳过冻结，charge 又以为已冻结而不扣余额 → 白嫖。
 *
 * 改用金额守恒判据（不依赖记录形态，天然兼容 charge 内部的差额 REFUND）：
 *   pending = Σ|RESERVE| - Σ REFUND - Σ|CHARGE|
 * - pending > 0：存在一轮尚未结算的冻结（进行中）。
 * - pending ≤ 0：无进行中的冻结（本轮已全部扣费或已退款），已结算。
 *
 * reserve 在 pending>0 时幂等跳过、否则开新一轮冻结；charge/refund 以 pending 作为本轮
 * 待结算额，pending≤0 时幂等跳过。对单轮流程行为与旧实现完全等价。
 *
 * @param tx Prisma 事务客户端
 * @param bizRefType 商家实体关联类型
 * @param bizRefId 商家实体主键
 * @returns 当前进行中的冻结净额（≤0 视为已结算）
 */
async function computeBizRefPending(
  tx: Prisma.TransactionClient,
  bizRefType: string,
  bizRefId: string
): Promise<number> {
  const entries = await tx.creditLedger.findMany({
    where: { bizRefType, bizRefId },
    select: { action: true, amount: true },
  })
  let reservedTotal = 0
  let refundedTotal = 0
  let chargedTotal = 0
  for (const e of entries) {
    if (e.action === 'RESERVE') reservedTotal += Math.abs(e.amount)
    else if (e.action === 'REFUND') refundedTotal += e.amount
    else if (e.action === 'CHARGE') chargedTotal += Math.abs(e.amount)
  }
  return reservedTotal - refundedTotal - chargedTotal
}

/**
 * 商家操作积分冻结（RESERVE，按 (bizRefType, bizRefId) 关联，恒不写 jobId）
 *
 * 泛化 freezeExportCredits 的关联键：把单一 projectId 抽象为 (bizRefType, bizRefId) 元组，
 * 既能避免 jobId 外键约束（credit_ledger_job_id_fkey 要求 jobId 指向已存在的 generation_jobs.id，
 * 而商家操作无对应 GenerationJob），又能区分 CONTENT_BRIEF / CONTENT_PLAN / STORE 等不同商家实体。
 *
 * @internal 仅由 merchant-billing-service 调用，外部禁止直接使用。商家平台所有计费操作统一经 merchant-billing-service 入口。
 *
 * 与既有 freezeExportCredits / projectId 版本并存，不改动既有函数签名。
 *
 * - 经 withCreditLock 全局锁【跨进程】串行化 + Prisma 事务，防止 read-modify-write 丢失更新。
 * - 幂等（金额守恒判据）：存在一轮尚未结算的冻结（pending>0）则跳过，避免重复冻结；
 *   失败退款后 pending 归零，重提交同一 bizRefId 会正确开启新一轮冻结（详见 computeBizRefPending）。
 * - 余额 < amount → 抛 ApiError('INSUFFICIENT_CREDITS', 402)，余额不变、绝不为负、绝不欠费。
 * - 写 CreditLedger 时 jobId 恒为 null，关联字段写 bizRefType / bizRefId。
 *
 * @param params.userId 用户 ID
 * @param params.bizRefType 商家实体关联类型（CONTENT_BRIEF | CONTENT_PLAN | STORE）
 * @param params.bizRefId 商家实体主键（无外键约束）
 * @param params.amount 冻结额度（估算值，必须 > 0）
 * @param params.remark 流水备注（用于区分操作，如 '[MERCHANT_RENDER] 渲染冻结'）
 */
export async function reserveCreditsByBizRef(params: {
  userId: string
  bizRefType: string
  bizRefId: string
  amount: number
  remark: string
}): Promise<void> {
  const { userId, bizRefType, bizRefId, amount, remark } = params
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // 幂等（金额守恒判据）：存在一轮尚未结算的冻结（pending>0）则跳过，避免重复冻结；
      // 失败退款后 pending 归零，重提交同一 briefId 会正确开启新一轮冻结（修复失败重提交白嫖）。
      const pending = await computeBizRefPending(tx, bizRefType, bizRefId)
      if (pending > 0) return

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.creditBalance < amount) {
        throw new ApiError(
          'INSUFFICIENT_CREDITS',
          `积分不足：本次操作需 ${amount} 积分，当前余额 ${user.creditBalance}`,
          402
        )
      }
      const newBalance = user.creditBalance - amount
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          // jobId 恒为 null：商家操作无对应 GenerationJob，关联恒走 bizRefType / bizRefId
          bizRefType,
          bizRefId,
          action: 'RESERVE',
          amount: -amount,
          balanceAfter: newBalance,
          remark,
        },
      })
    })
  , 'reserveCreditsByBizRef')
}

/**
 * 解析前余额预检（仅校验，不冻结）——供 API 入口快速拒绝余额为 0 的请求
 *
 * 真实冻结由 Worker 内的 freezeParseCredits 执行（拿到精确视频时长后）。
 * 本函数仅作前端/API 层的快速卡死入口，防止明显余额为 0 的用户进入队列。
 *
 * @param client Prisma 客户端或事务客户端（仅需 user.findUniqueOrThrow）
 * @param userId 用户 ID
 * @param parseCost 预估解析成本
 */
export async function reserveParseCreditsTx(
  client: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
  parseCost: number
): Promise<void> {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < parseCost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：解析需 ${parseCost} 积分，当前余额 ${user.creditBalance}`,
      402
    )
  }
}

/**
 * 解析成功扣费（CHARGE，按 projectId 关联）
 *
 * 在 Prisma 事务中扣减余额并写入 CHARGE 流水（projectId 关联，jobId 为空）。
 * 调用时机：parse-video Worker 解析成功、置项目 EDITABLE 的同一事务内。
 * 由于成功路径不重试、失败永不扣费，无需幂等键；reparse 为新的成功，会再次扣费。
 *
 * 不允许欠费：扣费前二次校验余额，余额不足时抛 ApiError('INSUFFICIENT_CREDITS')，
 * 绝不兜底扣至 0、绝不为负，与生成阶段「不允许欠费」哲学一致（入口已由
 * reserveParseCreditsTx 预检拦截，此处为事务内最终一致性兜底）。
 *
 * @param tx Prisma 事务客户端（与置 EDITABLE 同事务）
 * @param userId 用户 ID
 * @param projectId 项目 ID
 * @param amount 扣费额度
 */
export async function chargeParseCreditsTx(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  amount: number
): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < amount) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `解析扣费失败：积分不足（应扣 ${amount}，当前余额 ${user.creditBalance}）`,
      402
    )
  }
  const newBalance = user.creditBalance - amount

  await tx.user.update({
    where: { id: userId },
    data: { creditBalance: newBalance },
  })

  await tx.creditLedger.create({
    data: {
      userId,
      projectId,
      action: 'CHARGE',
      amount: -amount,
      balanceAfter: newBalance,
      remark: `解析扣费 ${amount} 积分`,
    },
  })
}
export async function reserveCredits(
  userId: string,
  jobId: string,
  amount: number
): Promise<void> {
  // 关键积分写：经 Redis 全局锁【跨进程】串行化执行，防止 read-modify-write 丢失更新
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })

      if (user.creditBalance < amount) {
        throw new Error('积分余额不足')
      }

      const newBalance = user.creditBalance - amount

      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })

      await tx.creditLedger.create({
        data: {
          userId,
          jobId,
          action: 'RESERVE',
          amount: -amount,
          balanceAfter: newBalance,
          remark: `冻结 ${amount} 积分`,
        },
      })
    })
  , 'reserveCredits')
}

/**
 * 统一正式扣费（CHARGE，事务内）—— 收敛原先分散在 chargeCredits、generate-video
 * 的 atomicSuccessUpdate 内联、processProjectSegmentGenerate 内联三处的重复扣费逻辑，
 * 为单一可复用实现，兼容 jobId / projectId 双键关联。
 *
 * 对齐生成阶段 RESERVE→CHARGE 模型：
 * - 幂等：已存在该键（jobId 或 projectId）的 CHARGE 记录则跳过（队列重试不重复扣费）。
 * - 若存在对应 RESERVE（创建即冻结、余额已在冻结时扣减）：将多冻结部分
 *   （reserved - actualAmount）以 REFUND 退回并更新余额，再写一条 CHARGE 记账
 *   （余额不再二次变动）。
 * - 若不存在 RESERVE（未走冻结模型的直扣场景）：校验余额充足后直接扣减并写 CHARGE，
 *   余额不足抛 ApiError('INSUFFICIENT_CREDITS')，绝不欠费、绝不兜底扣至 0。
 *
 * @param tx Prisma 事务客户端
 * @param params.userId 用户 ID
 * @param params.jobId 生成任务 ID（按 jobId 关联，与 projectId 二选一）
 * @param params.projectId 项目 ID（按 projectId 关联，与 jobId 二选一）
 * @param params.actualAmount 实际应扣额度
 */
export async function chargeCreditsTx(
  tx: Prisma.TransactionClient,
  params: { userId: string; jobId?: string; projectId?: string; actualAmount: number }
): Promise<void> {
  const { userId, jobId, projectId, actualAmount } = params
  if (!jobId && !projectId) {
    throw new ApiError('VALIDATION_ERROR', 'chargeCreditsTx 需提供 jobId 或 projectId 之一')
  }

  // 幂等键：按传入的 jobId 或 projectId 关联 CHARGE / RESERVE 流水
  const ledgerKey: { jobId?: string; projectId?: string } = jobId ? { jobId } : { projectId }

  // 幂等检查：已扣费则跳过（保证扣费恰好一次）
  const existingCharge = await tx.creditLedger.findFirst({
    where: { ...ledgerKey, action: 'CHARGE' },
  })
  if (existingCharge) return

  // 查找 RESERVE：存在则走「冻结→扣费」差额退款；不存在则直扣
  const reserveEntry = await tx.creditLedger.findFirst({
    where: { ...ledgerKey, action: 'RESERVE' },
  })

  if (reserveEntry) {
    // RESERVE→CHARGE：余额已在冻结时扣减，此处仅退还多冻结差额并记账
    const reservedAmount = Math.abs(reserveEntry.amount)
    const diff = reservedAmount - actualAmount
    if (diff > 0) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + diff
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          ...ledgerKey,
          action: 'REFUND',
          amount: diff,
          balanceAfter: newBalance,
          remark: `退还多冻结 ${diff} 积分`,
        },
      })
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    await tx.creditLedger.create({
      data: {
        userId,
        ...ledgerKey,
        action: 'CHARGE',
        amount: -actualAmount,
        balanceAfter: user.creditBalance,
        remark: `正式扣除 ${actualAmount} 积分`,
      },
    })
    return
  }

  // 无 RESERVE：直扣并校验余额，绝不欠费、绝不兜底扣至 0
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < actualAmount) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：应扣 ${actualAmount}，当前余额 ${user.creditBalance}`,
      402
    )
  }
  const newBalance = user.creditBalance - actualAmount
  await tx.user.update({
    where: { id: userId },
    data: { creditBalance: newBalance },
  })
  await tx.creditLedger.create({
    data: {
      userId,
      ...ledgerKey,
      action: 'CHARGE',
      amount: -actualAmount,
      balanceAfter: newBalance,
      remark: `正式扣除 ${actualAmount} 积分`,
    },
  })
}

/**
 * 商家操作正式扣费（CHARGE，按 (bizRefType, bizRefId) 关联，恒不写 jobId，事务内）
 *
 * 泛化 chargeCreditsTx 的关联键：把 jobId / projectId 抽象为 (bizRefType, bizRefId) 元组，
 * 既能避免 jobId 外键约束（商家操作无对应 GenerationJob），又能区分 CONTENT_BRIEF /
 * CONTENT_PLAN / STORE 等不同商家实体。语义与 chargeCreditsTx 完全一致：
 *
 * - 幂等（金额守恒判据）：本轮冻结净额 pending≤0 时跳过（本轮已扣费/已退款），保证扣费恰好一次；
 *   多轮场景下本轮冻结额取 pending（非单条 RESERVE 金额），正确处理失败重提交后的新一轮扣费。
 * - 若存在对应 RESERVE（余额已在冻结时扣减）：将多冻结部分（pending - actualAmount）
 *   以 REFUND 退回并更新余额，再写一条 CHARGE 记账（余额不再二次变动），
 *   使最终净扣减恰好等于 actualAmount。
 * - 若不存在 RESERVE（未走冻结模型的直扣场景）：已存在 CHARGE 则幂等跳过，否则校验余额充足后
 *   直接扣减并写 CHARGE，余额不足抛 ApiError('INSUFFICIENT_CREDITS')，绝不欠费、绝不兜底扣至 0。
 *
 * tx 版本：可在外部事务中调用，与商家实体状态更新（如置 ContentBrief GENERATED）同事务。
 *
 * @internal 仅由 merchant-billing-service 调用，外部禁止直接使用。商家平台所有计费操作统一经 merchant-billing-service 入口。
 * 与既有 chargeCreditsTx（jobId / projectId 版本）并存，不改动既有函数签名。
 *
 * @param tx Prisma 事务客户端（与商家实体状态更新同事务）
 * @param params.userId 用户 ID
 * @param params.bizRefType 商家实体关联类型（CONTENT_BRIEF | CONTENT_PLAN | STORE）
 * @param params.bizRefId 商家实体主键（无外键约束）
 * @param params.actualAmount 实际应扣额度（≤ 已冻结额，多余部分退回）
 */
export async function chargeCreditsByBizRef(
  tx: Prisma.TransactionClient,
  params: { userId: string; bizRefType: string; bizRefId: string; actualAmount: number }
): Promise<void> {
  const { userId, bizRefType, bizRefId, actualAmount } = params

  // 幂等键：按 (bizRefType, bizRefId) 关联 CHARGE / RESERVE 流水
  const ledgerKey = { bizRefType, bizRefId }

  // 是否走过冻结模型：存在任一 RESERVE 即按「冻结→扣费」差额退款结算，否则直扣。
  const reserveEntry = await tx.creditLedger.findFirst({
    where: { ...ledgerKey, action: 'RESERVE' },
  })

  if (reserveEntry) {
    // 本轮待结算的冻结净额（金额守恒判据，天然幂等且正确处理多轮）：
    // pending≤0 表示本轮已结算（已扣费或已退款），直接跳过，保证扣费恰好一次。
    const pending = await computeBizRefPending(tx, bizRefType, bizRefId)
    if (pending <= 0) return
    // RESERVE→CHARGE：余额已在冻结时扣减，此处仅退还本轮多冻结差额并记账。
    // 本轮冻结额取 pending（而非单条 RESERVE 金额），多轮场景下才正确。
    const reservedAmount = pending
    const diff = reservedAmount - actualAmount
    if (diff > 0) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + diff
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          ...ledgerKey,
          action: 'REFUND',
          amount: diff,
          balanceAfter: newBalance,
          remark: `退还多冻结 ${diff} 积分`,
        },
      })
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    await tx.creditLedger.create({
      data: {
        userId,
        ...ledgerKey,
        action: 'CHARGE',
        amount: -actualAmount,
        balanceAfter: user.creditBalance,
        remark: `正式扣除 ${actualAmount} 积分`,
      },
    })
    return
  }

  // 无 RESERVE：直扣并校验余额，绝不欠费、绝不兜底扣至 0
  // 幂等：直扣场景无冻结轮次概念，已存在 CHARGE 即跳过（重试不重复扣费）。
  const existingCharge = await tx.creditLedger.findFirst({
    where: { ...ledgerKey, action: 'CHARGE' },
  })
  if (existingCharge) return
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < actualAmount) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：应扣 ${actualAmount}，当前余额 ${user.creditBalance}`,
      402
    )
  }
  const newBalance = user.creditBalance - actualAmount
  await tx.user.update({
    where: { id: userId },
    data: { creditBalance: newBalance },
  })
  await tx.creditLedger.create({
    data: {
      userId,
      ...ledgerKey,
      action: 'CHARGE',
      amount: -actualAmount,
      balanceAfter: newBalance,
      remark: `正式扣除 ${actualAmount} 积分`,
    },
  })
}

/**
 * 商家操作失败补偿退款（REFUND，按 (bizRefType, bizRefId) 关联，恒不写 jobId）
 *
 * 用于商家渲染 / 导出等操作在 CHARGE 之前失败的全额补偿退款：
 * 退还额 = 该关联键本轮进行中的冻结净额（pending，见 computeBizRefPending），
 * 无需调用方传入金额，避免与冻结额不一致。
 *
 * 泛化 refundParseCredits 的关联键：把单一 projectId 抽象为 (bizRefType, bizRefId) 元组，
 * 既能避免 jobId 外键约束（商家操作无对应 GenerationJob），又能区分 CONTENT_BRIEF /
 * CONTENT_PLAN / STORE 等不同商家实体。与既有 refundParseCredits / refundCredits 并存，
 * 不改动既有函数签名。
 *
 * @internal 仅由 merchant-billing-service 调用，外部禁止直接使用。商家平台所有计费操作统一经 merchant-billing-service 入口。
 *
 * - 经 withCreditLock 全局锁【跨进程】串行化 + Prisma 事务，防止 read-modify-write 丢失更新。
 * - 幂等（金额守恒判据）：本轮冻结净额 pending≤0 时跳过（无进行中冻结 / 已结算 / 重复退款），不重复退款。
 * - 退款后余额恢复到该操作本轮冻结发生前的数值（冻结—退款往返一致），绝不凭空增加余额。
 *
 * @param params.userId 用户 ID
 * @param params.bizRefType 商家实体关联类型（CONTENT_BRIEF | CONTENT_PLAN | STORE）
 * @param params.bizRefId 商家实体主键（无外键约束）
 */
export async function refundCreditsByBizRef(params: {
  userId: string
  bizRefType: string
  bizRefId: string
}): Promise<void> {
  const { userId, bizRefType, bizRefId } = params
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // 幂等 + 多轮正确（金额守恒判据）：本轮进行中的冻结净额 pending≤0 时跳过
      //（无进行中冻结 / 已结算 / 重复退款），绝不凭空增加余额。
      const amount = await computeBizRefPending(tx, bizRefType, bizRefId)
      if (amount <= 0) return

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + amount
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          // jobId 恒为 null：商家操作无对应 GenerationJob，关联恒走 bizRefType / bizRefId
          bizRefType,
          bizRefId,
          action: 'REFUND',
          amount,
          balanceAfter: newBalance,
          remark: `操作失败退还 ${amount} 积分`,
        },
      })
    })
  , 'refundCreditsByBizRef')
}

/**
 * 正式扣除积分（CHARGE，按 jobId 关联）
 * 薄封装：在 Prisma 事务中调用统一的 chargeCreditsTx（幂等 + RESERVE 差额退款）。
 * 关键积分写：经 Redis 全局锁【跨进程】串行化执行，防止 read-modify-write 丢失更新。
 */
export async function chargeCredits(
  userId: string,
  jobId: string,
  actualAmount: number
): Promise<void> {
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      await chargeCreditsTx(tx, { userId, jobId, actualAmount })
    })
  , 'chargeCredits')
}

/**
 * 返还积分（REFUND）
 * 幂等性：如果已存在该 jobId 的 REFUND 记录则跳过
 * 关键积分写：经 Redis 全局锁【跨进程】串行化执行，防止 read-modify-write 丢失更新。
 */
export async function refundCredits(
  userId: string,
  jobId: string,
  amount: number
): Promise<void> {
  await withCreditLock(() =>
    prisma.$transaction(async (tx) => {
      // 幂等检查
      const existingRefund = await tx.creditLedger.findFirst({
        where: { jobId, action: 'REFUND' },
      })
      if (existingRefund) return // 已退还，跳过

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + amount

      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })

      await tx.creditLedger.create({
        data: {
          userId,
          jobId,
          action: 'REFUND',
          amount: amount,
          balanceAfter: newBalance,
          remark: `返还 ${amount} 积分`,
        },
      })
    })
  , 'refundCredits')
}

/**
 * 充值积分（TOPUP）
 * 幂等性：如果已存在该 orderId 的 TOPUP 记录则跳过
 * 在 Prisma 事务中：增加用户余额 → 创建 TOPUP 流水记录（含 orderId）
 * 返回充值后的新余额（幂等跳过时返回当前余额）
 * 关键积分写：充值回调来自 Next.js 应用进程，经 Redis 全局锁【跨进程】串行化，
 * 防止 read-modify-write 丢失更新。
 */
export async function topupCredits(
  userId: string,
  credits: number,
  orderId: string,
  remark?: string
): Promise<number> {
  // Zod 参数校验
  const validated = topupInputSchema.parse({ userId, credits, orderId, remark })

  const newBalance = await withCreditLock(() => prisma.$transaction(async (tx) => {
    // 幂等检查：如果已存在该 orderId 的 TOPUP 记录则跳过
    const existingTopup = await tx.creditLedger.findFirst({
      where: { orderId: validated.orderId, action: 'TOPUP' },
    })
    if (existingTopup) {
      // 已充值，返回当前余额
      const user = await tx.user.findUniqueOrThrow({ where: { id: validated.userId } })
      return user.creditBalance
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: validated.userId } })
    const updatedBalance = user.creditBalance + validated.credits

    await tx.user.update({
      where: { id: validated.userId },
      data: { creditBalance: updatedBalance },
    })

    await tx.creditLedger.create({
      data: {
        userId: validated.userId,
        orderId: validated.orderId,
        action: 'TOPUP',
        amount: validated.credits,
        balanceAfter: updatedBalance,
        remark: validated.remark ?? `充值 ${validated.credits} 积分`,
      },
    })

    return updatedBalance
  }), 'topupCredits')

  return newBalance
}

/**
 * 获取用户当前积分余额
 */
export async function getBalance(userId: string): Promise<number> {
  if (!userId) {
    throw new ApiError('VALIDATION_ERROR', '用户ID不能为空')
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  return user.creditBalance
}
