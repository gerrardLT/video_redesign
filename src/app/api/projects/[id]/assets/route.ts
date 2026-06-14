import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/assets - 获取项目素材列表
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

    // 返回素材列表：人物图在前，然后按 sortOrder、createdAt 排序
    const assets = await prisma.asset.findMany({
      where: { projectId: id },
      orderBy: [
        { isCharImage: 'desc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    })

    return NextResponse.json({
      assets: assets.map((a) => ({
        id: a.id,
        type: a.type,
        url: a.url,
        thumbUrl: a.thumbUrl,
        fileName: a.fileName,
        isCharImage: a.isCharImage,
        status: a.status,
        sortOrder: a.sortOrder,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/assets]', error)
    return NextResponse.json({ error: '获取素材列表失败' }, { status: 500 })
  }
}
