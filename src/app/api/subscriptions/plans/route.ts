import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/subscriptions/plans
 * 获取所有活跃订阅套餐列表，按 sortOrder 排序
 */
export async function GET(_request: NextRequest) {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        price: true,
        monthlyCredits: true,
        bonusCredits: true,
        description: true,
        privileges: true,
        sortOrder: true,
      },
    })

    return NextResponse.json({ plans })
  } catch (error) {
    console.error('[GET /api/subscriptions/plans]', error)
    return NextResponse.json({ error: '获取订阅套餐列表失败' }, { status: 500 })
  }
}
