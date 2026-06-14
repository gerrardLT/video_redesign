import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

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
}
