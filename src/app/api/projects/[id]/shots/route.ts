import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/shots - 获取项目分镜列表
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

    // 获取分镜列表，按 orderIndex 排序
    const shots = await prisma.shot.findMany({
      where: { projectId: id },
      orderBy: { orderIndex: 'asc' },
    })

    // 解析 dialogue JSON 字符串
    const formattedShots = shots.map((shot) => ({
      id: shot.id,
      orderIndex: shot.orderIndex,
      startTime: shot.startTime,
      endTime: shot.endTime,
      coverUrl: shot.coverUrl,
      scene: shot.scene,
      shotType: shot.shotType,
      cameraMove: shot.cameraMove,
      dialogue: parseDialogue(shot.dialogue),
      audioDesc: shot.audioDesc,
      prompt: shot.prompt,
      genStatus: shot.genStatus,
      genVideoUrl: shot.genVideoUrl,
    }))

    return NextResponse.json({ shots: formattedShots })
  } catch (error) {
    console.error('[GET /api/projects/[id]/shots]', error)
    return NextResponse.json({ error: '获取分镜列表失败' }, { status: 500 })
  }
}

// 解析 dialogue JSON 字符串
function parseDialogue(dialogue: string | null): Array<{ speaker: string; text: string }> {
  if (!dialogue) return []
  try {
    const parsed = JSON.parse(dialogue)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}
