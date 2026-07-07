import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { withCreditLock } from '@/lib/shared/distributed-lock'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

const AdjustSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int(),
  remark: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    requireAdmin(request)

    const body = await request.json()
    const parsed = AdjustSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { userId, amount, remark } = parsed.data

    // 关键积分写：管理员调账经 Redis 全局锁【跨进程】串行化，防止 read-modify-write 丢失更新。
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
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[POST /api/admin/credits/adjust]', error)
    return toErrorResponse('INTERNAL_ERROR', '积分调账失败')
  }
}
