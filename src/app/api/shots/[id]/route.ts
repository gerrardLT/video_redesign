import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// 对白条目 schema
const DialogueEntrySchema = z.object({
  speaker: z.string(),
  text: z.string(),
})

// 分镜更新 schema - 所有字段可选
const UpdateShotSchema = z.object({
  scene: z.string().optional(),
  shotType: z.string().optional(),
  cameraMove: z.string().optional(),
  dialogue: z.array(DialogueEntrySchema).optional(),
  audioDesc: z.string().optional(),
  prompt: z.string().optional(),
})

// PUT /api/shots/[id] - 更新分镜字段
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 验证分镜存在且属于用户的项目
    const shot = await prisma.shot.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    })

    if (!shot || shot.project.userId !== userId) {
      return NextResponse.json({ error: '分镜不存在' }, { status: 404 })
    }

    // 校验请求体
    const body = await request.json()
    const parseResult = UpdateShotSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const data = parseResult.data

    // 构建更新数据
    const updateData: Record<string, unknown> = {}
    if (data.scene !== undefined) updateData.scene = data.scene
    if (data.shotType !== undefined) updateData.shotType = data.shotType
    if (data.cameraMove !== undefined) updateData.cameraMove = data.cameraMove
    if (data.audioDesc !== undefined) updateData.audioDesc = data.audioDesc
    if (data.prompt !== undefined) updateData.prompt = data.prompt
    if (data.dialogue !== undefined) {
      updateData.dialogue = JSON.stringify(data.dialogue)
    }

    // 更新分镜
    const updatedShot = await prisma.shot.update({
      where: { id },
      data: updateData,
    })

    // 解析 dialogue 返回给前端
    let parsedDialogue: Array<{ speaker: string; text: string }> = []
    if (updatedShot.dialogue) {
      try {
        parsedDialogue = JSON.parse(updatedShot.dialogue)
      } catch {
        parsedDialogue = []
      }
    }

    return NextResponse.json({
      shot: {
        id: updatedShot.id,
        orderIndex: updatedShot.orderIndex,
        startTime: updatedShot.startTime,
        endTime: updatedShot.endTime,
        coverUrl: updatedShot.coverUrl,
        scene: updatedShot.scene,
        shotType: updatedShot.shotType,
        cameraMove: updatedShot.cameraMove,
        dialogue: parsedDialogue,
        audioDesc: updatedShot.audioDesc,
        prompt: updatedShot.prompt,
        genStatus: updatedShot.genStatus,
        genVideoUrl: updatedShot.genVideoUrl,
      },
    })
  } catch (error) {
    console.error('[PUT /api/shots/[id]]', error)
    return NextResponse.json({ error: '更新分镜失败' }, { status: 500 })
  }
}
