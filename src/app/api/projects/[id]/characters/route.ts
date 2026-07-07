import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/characters - 获取项目人物列表
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 返回人物列表，按创建时间排序
    const characters = await prisma.character.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        appearance: c.appearance,
        enabled: c.enabled,
        imageUrl: c.imageUrl,
        avatarStatus: c.avatarStatus,
        avatarAssetUrl: c.avatarAssetUrl,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/characters]', error)
    return NextResponse.json({ error: '获取人物列表失败' }, { status: 500 })
  }
}
