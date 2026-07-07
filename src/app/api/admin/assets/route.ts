import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

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
            },
          },
          user: {
            select: {
              email: true,
            },
          },
        },
      }),
      prisma.asset.count({ where }),
    ])

    // 直接从 Asset→User 关联获取用户邮箱，不再绕道 project.user（修复用户级资产丢失用户信息）
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
        email: asset.user.email,
      },
    }))

    return NextResponse.json({
      assets: result,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/assets]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取资产列表失败')
  }
}
