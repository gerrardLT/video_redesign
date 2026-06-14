import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/credits/history - 查询积分流水（分页）
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))
    const skip = (page - 1) * pageSize

    const [entries, total] = await Promise.all([
      prisma.creditLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          action: true,
          amount: true,
          balanceAfter: true,
          remark: true,
          createdAt: true,
          jobId: true,
        },
      }),
      prisma.creditLedger.count({ where: { userId } }),
    ])

    return NextResponse.json({
      entries: entries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error('[GET /api/credits/history]', error)
    return NextResponse.json({ error: '查询积分流水失败' }, { status: 500 })
  }
}
