import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { withCreditLock } from '@/lib/distributed-lock'

export const dynamic = 'force-dynamic'

const AdjustSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int(),
  remark: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = AdjustSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数校验失败', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const { userId, amount, remark } = parsed.data

  // 关键积分写（缺陷 11）：管理员调账来自 Next.js 应用进程，整笔事务经 Redis 全局锁
  // 【跨进程】串行化，与 Worker 进程的扣费/退款互斥，消除 libSQL/SQLite 并发写锁竞争与
  // 读-改-写丢失更新（锁内复用 db-retry 兜底）。
  const result = await withCreditLock(() => prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new Error('USER_NOT_FOUND')
    }

    const newBalance = user.creditBalance + amount
    if (newBalance < 0) {
      throw new Error('BALANCE_NEGATIVE')
    }

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    })

    const ledger = await tx.creditLedger.create({
      data: {
        userId,
        action: 'ADMIN_ADJUST',
        amount,
        balanceAfter: newBalance,
        remark,
      },
    })

    return { newBalance, ledgerId: ledger.id }
  }), 'adminAdjust').catch((err: Error) => {
    if (err.message === 'USER_NOT_FOUND') {
      return { error: '用户不存在' }
    }
    if (err.message === 'BALANCE_NEGATIVE') {
      return { error: '调整后余额不能为负数' }
    }
    throw err
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    newBalance: result.newBalance,
    ledgerId: result.ledgerId,
  })
}
