import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/api-error'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

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
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/orders]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取订单列表失败')
  }
}
