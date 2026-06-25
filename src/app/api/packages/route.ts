import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/packages - 获取所有活跃套餐列表
export async function GET(_request: NextRequest) {
  try {
    const packages = await prisma.package.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        credits: true,
        price: true,
        description: true,
        sortOrder: true,
      },
    })

    return NextResponse.json({ packages })
  } catch (error) {
    console.error('[GET /api/packages]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取套餐列表失败' } },
      { status: 500 }
    )
  }
}
