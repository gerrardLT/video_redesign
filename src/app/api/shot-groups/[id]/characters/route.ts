import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// 校验分镜组归属当前用户，返回 group 及其 projectId
async function loadOwnedGroup(shotGroupId: string, userId: string) {
  const group = await prisma.shotGroup.findFirst({
    where: { id: shotGroupId },
    include: { project: { select: { id: true, userId: true } } },
  })
  if (!group || group.project.userId !== userId) return null
  return group
}

// GET /api/shot-groups/[id]/characters
// 返回该组已选人物 id 列表 + 项目全部人物（素材库，含形象图与状态）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: shotGroupId } = await params

    const group = await loadOwnedGroup(shotGroupId, userId)
    if (!group) {
      return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
    }

    const [links, library] = await Promise.all([
      prisma.shotGroupCharacter.findMany({
        where: { shotGroupId },
        select: { characterId: true },
      }),
      prisma.character.findMany({
        where: { projectId: group.project.id, enabled: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, imageUrl: true, avatarStatus: true, appearance: true },
      }),
    ])

    return NextResponse.json({
      selectedCharacterIds: links.map((l) => l.characterId),
      library,
    })
  } catch (error) {
    console.error('[GET /api/shot-groups/[id]/characters]', error)
    return NextResponse.json({ error: '获取分镜组人物失败' }, { status: 500 })
  }
}

const PutSchema = z.object({
  characterIds: z.array(z.string()).max(20),
})

// PUT /api/shot-groups/[id]/characters
// 整组替换选中人物集合（set 语义）：删除旧关联 → 写入新关联（仅接受属于本项目的人物）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: shotGroupId } = await params

    const group = await loadOwnedGroup(shotGroupId, userId)
    if (!group) {
      return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const parsed = PutSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: '参数校验失败' }, { status: 400 })
    }

    // 仅保留确属本项目的人物 id，过滤非法 id（不静默接受越权/无效数据）
    const validChars = await prisma.character.findMany({
      where: { projectId: group.project.id, id: { in: parsed.data.characterIds } },
      select: { id: true },
    })
    const validIds = validChars.map((c) => c.id)

    // set 语义替换：事务内先清空再写入
    await prisma.$transaction(async (tx) => {
      await tx.shotGroupCharacter.deleteMany({ where: { shotGroupId } })
      if (validIds.length > 0) {
        await tx.shotGroupCharacter.createMany({
          data: validIds.map((characterId) => ({ shotGroupId, characterId })),
        })
      }
    })

    return NextResponse.json({ selectedCharacterIds: validIds })
  } catch (error) {
    console.error('[PUT /api/shot-groups/[id]/characters]', error)
    return NextResponse.json({ error: '更新分镜组人物失败' }, { status: 500 })
  }
}
