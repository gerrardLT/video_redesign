/**
 * 积分服务
 * 提供冻结、扣除、返还、充值积分的事务安全操作
 */
import { z } from 'zod/v4'
import { Prisma } from '@/generated/prisma'
import { prisma } from './db'
import { ApiError } from './api-error'
import { withCreditLock } from './distributed-lock'

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
 * 估算积分消耗
 * duration × (resolution === '720p' ? 1.5 : 1.0)，向上取整
 */
export function estimateCreditCost(duration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(duration * multiplier)
}

/**
 * 按组时长与分辨率估算积分消耗
 * 复用 estimateCreditCost 公式：ceil(groupDuration × (resolution === '720p' ? 1.5 : 1.0))
 * 纯函数，按 Shot_Group 总时长而非单个 Shot 结算（Req 8.1、8.7）
 */
export function estimateGroupCreditCost(groupDuration: number, resolution: string): number {
  return estimateCreditCost(groupDuration, resolution)
}

/**
 * 估算解析阶段积分消耗
 *
 * 解析消耗的外部资源为 AI 多模态视频直传分析（成本随时长增长）。
 * 公式：ceil(duration × 0.5)。
 *
 * @param duration 视频时长（秒）
 */
export function estimateParseCreditCost(duration: number): number {
  return Math.ceil(duration * 0.5)
}

/**
 * 解析前余额预检（对齐生成阶段「先校验、不允许欠费」的扣费哲学）
 *
 * 在消耗任何外部资源（FFmpeg Normalize / OSS 上传 / AI 多模态分析）之前调用：
 * 校验用户余额是否足以支付预估解析成本，不足则抛 ApiError('INSUFFICIENT_CREDITS')
 * 拒绝继续，绝不进入后续外部资源消耗、绝不事后兜底扣至 0 让零余额用户白嫖。
 *
 * 解析采用「成功路径单点扣费」模型：本预检为入口闸门，实际扣减在解析成功事务内由
 * chargeParseCreditsTx 一次性完成（仍二次校验余额），二者共同保证不欠费。
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
  // 关键积分写（缺陷 11）：经 Redis 全局锁【跨进程】串行化执行，消除 libSQL/SQLite 单写锁下
  // 「Worker 进程 × Next.js 应用进程」并发写 creditLedger/余额的锁竞争与读-改-写丢失更新；
  // 锁内复用 db-retry 对跨进程残余 SQLITE_BUSY 兜底，串行化与重试互补。
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
 * 关键积分写（缺陷 11）：经 Redis 全局锁【跨进程】串行化执行，消除 libSQL/SQLite 单写锁
 * 下「Worker 进程 × 应用进程」并发写锁竞争与读-改-写丢失更新（锁内复用 db-retry 兜底）。
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
 * 关键积分写（缺陷 11）：经 Redis 全局锁【跨进程】串行化执行，消除 libSQL/SQLite 单写锁
 * 下「Worker 进程 × 应用进程」并发写锁竞争与读-改-写丢失更新（锁内复用 db-retry 兜底）。
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
 * 关键积分写（缺陷 11）：充值回调来自 Next.js 应用进程，经 Redis 全局锁【跨进程】串行化，
 * 与 Worker 进程的扣费/退款互斥，消除 libSQL/SQLite 并发写锁竞争与读-改-写丢失更新。
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
