import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/projects - 获取所有项目列表（管理员）
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
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
    console.error('[GET /api/admin/projects]', error)
    return NextResponse.json({ error: '获取项目列表失败' }, { status: 500 })
  }
}
