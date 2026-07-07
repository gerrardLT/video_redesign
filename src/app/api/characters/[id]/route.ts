import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// 更新人物 schema
const UpdateCharacterSchema = z.object({
  name: z.string().optional(),
  appearance: z.string().optional(),
  enabled: z.boolean().optional(),
})

// PUT /api/characters/[id] - 更新人物信息
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 验证人物存在且属于用户的项目
    const character = await prisma.character.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    })

    if (!character || character.project.userId !== userId) {
      return NextResponse.json({ error: '人物不存在' }, { status: 404 })
    }

    // 校验请求体
    const body = await request.json()
    const parseResult = UpdateCharacterSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const data = parseResult.data

    // 构建更新数据
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.appearance !== undefined) updateData.appearance = data.appearance
    if (data.enabled !== undefined) updateData.enabled = data.enabled

    // 更新人物
    const updatedCharacter = await prisma.character.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      character: {
        id: updatedCharacter.id,
        name: updatedCharacter.name,
        appearance: updatedCharacter.appearance,
        enabled: updatedCharacter.enabled,
        imageUrl: updatedCharacter.imageUrl,
        avatarStatus: updatedCharacter.avatarStatus,
        avatarAssetUrl: updatedCharacter.avatarAssetUrl,
        createdAt: updatedCharacter.createdAt.toISOString(),
        updatedAt: updatedCharacter.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[PUT /api/characters/[id]]', error)
    return NextResponse.json({ error: '更新人物失败' }, { status: 500 })
  }
}
