import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  // 筛选参数
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const status = searchParams.get('status')
  const packageId = searchParams.get('packageId')

  // 分页参数
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))

  // 构建查询条件
  const where: Record<string, unknown> = {}

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) {
      (where.createdAt as Record<string, unknown>).gte = new Date(startDate)
    }
    if (endDate) {
      (where.createdAt as Record<string, unknown>).lte = new Date(endDate)
    }
  }

  if (status) {
    where.status = status
  }

  if (packageId) {
    where.packageId = packageId
  }

  const [orders, total] = await Promise.all([
    prisma.packageOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: {
            email: true,
            nickname: true,
          },
        },
        package: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.packageOrder.count({ where }),
  ])

  return NextResponse.json({
    orders,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
}
