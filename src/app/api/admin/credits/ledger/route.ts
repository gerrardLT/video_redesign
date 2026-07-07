import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/credits/ledger - 获取所有用户积分流水（分页，可按 userId 过滤）
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)))

    const where = userId ? { userId } : {}

    const [entries, total] = await Promise.all([
      prisma.creditLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      }),
      prisma.creditLedger.count({ where }),
    ])

    const result = entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      userEmail: e.user.email,
      jobId: e.jobId,
      action: e.action,
      amount: e.amount,
      balanceAfter: e.balanceAfter,
      remark: e.remark,
      createdAt: e.createdAt.toISOString(),
    }))

    return NextResponse.json({
      entries: result,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/credits/ledger]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取流水失败')
  }
}
