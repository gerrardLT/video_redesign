import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// GET /api/credits/balance - 查询积分余额
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    })

    return NextResponse.json({ balance: user.creditBalance })
  } catch (error) {
    console.error('[GET /api/credits/balance]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '查询余额失败' } },
      { status: 500 }
    )
  }
}
