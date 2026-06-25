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
