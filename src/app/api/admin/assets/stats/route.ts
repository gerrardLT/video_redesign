import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const now = new Date()
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const [activeStats, expiredStats, expiringCount] = await Promise.all([
    // 活跃资产：status != EXPIRED
    prisma.asset.aggregate({
      where: {
        status: { not: 'EXPIRED' },
      },
      _count: { id: true },
      _sum: { fileSize: true },
    }),
    // 已过期资产：status == EXPIRED
    prisma.asset.aggregate({
      where: {
        status: 'EXPIRED',
      },
      _count: { id: true },
      _sum: { fileSize: true },
    }),
    // 即将过期（3天内）资产数量：expiresAt 在 (now, now+3days] 且 status != EXPIRED
    prisma.asset.count({
      where: {
        expiresAt: {
          gt: now,
          lte: threeDaysLater,
        },
        status: { not: 'EXPIRED' },
      },
    }),
  ])

  return NextResponse.json({
    active: {
      count: activeStats._count.id,
      totalSize: activeStats._sum.fileSize || 0,
    },
    expired: {
      count: expiredStats._count.id,
      totalSize: expiredStats._sum.fileSize || 0,
    },
    expiring: {
      count: expiringCount,
    },
  })
}
