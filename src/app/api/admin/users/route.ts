import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-helpers'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // P1 修复：使用统一的 requireAdmin 函数替代重复的角色检查
    requireAdmin(request)

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { projects: true },
        },
      },
    })

    const result = users.map((u) => ({
      id: u.id,
      email: u.email,
      nickname: u.nickname,
      role: u.role,
      creditBalance: u.creditBalance,
      projectCount: u._count.projects,
      createdAt: u.createdAt.toISOString(),
    }))

    return NextResponse.json({ users: result })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    return toErrorResponse('INTERNAL_ERROR')
  }
}
