import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/api-error'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/projects - 获取所有项目列表（管理员）
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            nickname: true,
          },
        },
        _count: {
          select: { shots: true },
        },
      },
    })

    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      shotCount: p._count.shots,
      userId: p.user.id,
      userEmail: p.user.email,
      userNickname: p.user.nickname,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }))

    return NextResponse.json({ projects: result })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/projects]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取项目列表失败')
  }
}
