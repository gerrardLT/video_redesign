import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  // 筛选参数: all | expiring | expired
  const status = searchParams.get('status') || 'all'

  // 分页参数
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))

  const now = new Date()
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // 构建查询条件
  let where: Record<string, unknown> = {}

  if (status === 'expiring') {
    // 即将过期：expiresAt 在 3 天内且 status != EXPIRED
    where = {
      expiresAt: {
        gt: now,
        lte: threeDaysLater,
      },
      status: { not: 'EXPIRED' },
    }
  } else if (status === 'expired') {
    // 已过期：status == EXPIRED
    where = {
      status: 'EXPIRED',
    }
  }
  // status === 'all' 时不加筛选条件

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        project: {
          select: {
            name: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    }),
    prisma.asset.count({ where }),
  ])

  // 将 user 信息提取到顶层（project 可能为 null，用户级资产不绑定项目）
  const result = assets.map((asset) => ({
    id: asset.id,
    projectId: asset.projectId,
    userId: asset.userId,
    type: asset.type,
    url: asset.url,
    fileName: asset.fileName,
    fileSize: asset.fileSize,
    status: asset.status,
    expiresAt: asset.expiresAt,
    createdAt: asset.createdAt,
    project: {
      name: asset.project?.name ?? null,
    },
    user: {
      email: asset.project?.user?.email ?? null,
    },
  }))

  return NextResponse.json({
    assets: result,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
}
