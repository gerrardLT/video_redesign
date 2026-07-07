import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const now = new Date()

    // 今日起始时间
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // 本周起始时间（周一）
    const dayOfWeek = now.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)

    // 本月起始时间
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // 仅统计 PAID 订单
    const paidWhere = { status: 'PAID' }

    const [todayRevenue, weekRevenue, monthRevenue, totalRevenue, packageSales] =
      await Promise.all([
        // 今日收入
        prisma.packageOrder.aggregate({
          where: {
            ...paidWhere,
            paidAt: { gte: todayStart },
          },
          _sum: { amount: true },
        }),
        // 本周收入
        prisma.packageOrder.aggregate({
          where: {
            ...paidWhere,
            paidAt: { gte: weekStart },
          },
          _sum: { amount: true },
        }),
        // 本月收入
        prisma.packageOrder.aggregate({
          where: {
            ...paidWhere,
            paidAt: { gte: monthStart },
          },
          _sum: { amount: true },
        }),
        // 累计收入
        prisma.packageOrder.aggregate({
          where: paidWhere,
          _sum: { amount: true },
        }),
        // 各套餐销售数量统计
        prisma.packageOrder.groupBy({
          by: ['packageId'],
          where: paidWhere,
          _count: { id: true },
        }),
      ])

    // 获取套餐名称
    const packageIds = packageSales.map((p) => p.packageId)
    const packages = await prisma.package.findMany({
      where: { id: { in: packageIds } },
      select: { id: true, name: true },
    })

    const packageNameMap = new Map(packages.map((p) => [p.id, p.name]))

    const packageSalesWithName = packageSales.map((p) => ({
      packageId: p.packageId,
      packageName: packageNameMap.get(p.packageId) || '未知套餐',
      count: p._count.id,
    }))

    return NextResponse.json({
      revenue: {
        today: todayRevenue._sum.amount || 0,
        week: weekRevenue._sum.amount || 0,
        month: monthRevenue._sum.amount || 0,
        total: totalRevenue._sum.amount || 0,
      },
      packageSales: packageSalesWithName,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/orders/stats]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取订单统计失败')
  }
}
