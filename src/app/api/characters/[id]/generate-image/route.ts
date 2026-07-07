import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { imageGenerateQueue } from '@/lib/shared/queue'

export const dynamic = 'force-dynamic'

// POST /api/characters/[id]/generate-image - 生成人物参考图
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 验证人物存在且属于用户的项目
    const character = await prisma.character.findFirst({
      where: { id },
      include: { project: { select: { userId: true, id: true } } },
    })

    if (!character || character.project.userId !== userId) {
      return NextResponse.json({ error: '人物不存在' }, { status: 404 })
    }

    // 检查人物是否有外貌描述
    if (!character.appearance || character.appearance.trim() === '') {
      return NextResponse.json(
        { error: '请先填写人物外貌描述' },
        { status: 400 }
      )
    }

    // 添加任务到图像生成队列
    try {
      await imageGenerateQueue.add('generate-character-image', {
        characterId: id,
        projectId: character.project.id,
        userId,
        prompt: character.appearance,
      })
    } catch (queueError) {
      console.error('[generate-image] 队列添加失败（Redis 可能不可用）:', queueError)
      return NextResponse.json(
        { error: '任务队列暂不可用，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { message: '人物图生成任务已创建' },
      { status: 202 }
    )
  } catch (error) {
    console.error('[POST /api/characters/[id]/generate-image]', error)
    return NextResponse.json({ error: '创建生成任务失败' }, { status: 500 })
  }
}
