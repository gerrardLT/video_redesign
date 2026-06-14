import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { estimateParseCreditCost, getBalance } from '@/lib/credit-service'

export const dynamic = 'force-dynamic'

// POST /api/projects/[id]/reparse - 重新触发视频解析
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 校验项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 可重新解析的状态：
    // - EDITABLE：已解析成功，想用新逻辑重跑
    // - FAILED：解析失败重试
    // - EXPORTED：已导出成片后，仍允许用新逻辑重做（旧成片 Asset 保留，不受影响）
    const REPARSABLE_STATUSES = ['FAILED', 'EDITABLE', 'EXPORTED']
    if (!REPARSABLE_STATUSES.includes(project.status)) {
      return NextResponse.json(
        { error: `项目状态为 ${project.status}，无法重新解析（仅解析完成、失败或已导出的项目可重新解析）` },
        { status: 400 }
      )
    }

    // 检查视频 URL 是否存在
    if (!project.videoUrl) {
      return NextResponse.json(
        { error: '项目无视频文件，无法解析' },
        { status: 400 }
      )
    }

    // 余额闸门：重新解析会再次消耗 AI 分析 + 首帧图等真实资源，入队前校验余额
    const estimatedCost = estimateParseCreditCost(project.duration ?? 0)
    const balance = await getBalance(userId)
    if (balance < estimatedCost) {
      return NextResponse.json(
        { error: '积分余额不足，无法重新解析', required: estimatedCost, available: balance },
        { status: 402 }
      )
    }

    // 删除已有的解析数据（分镜 / 人物 / 分组 / 风格设定），避免重复
    await prisma.shot.deleteMany({ where: { projectId: id } })
    await prisma.character.deleteMany({ where: { projectId: id } })
    await prisma.shotGroup.deleteMany({ where: { projectId: id } })
    await prisma.styleConfig.deleteMany({ where: { projectId: id } })

    // 重置项目状态为 PARSING
    await prisma.project.update({
      where: { id },
      data: {
        status: 'PARSING',
        errorMsg: null,
      },
    })

    // 添加新的解析任务到队列
    try {
      const { videoParseQueue } = await import('@/lib/queue')
      await videoParseQueue.add('parse-video', {
        projectId: id,
        videoUrl: project.videoUrl,
      })
    } catch (queueError) {
      console.error('[reparse] 无法添加解析任务到队列:', queueError)
      // 队列不可用时回滚状态
      await prisma.project.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorMsg: '队列服务不可用，请稍后重试',
        },
      })
      return NextResponse.json(
        { error: '队列服务不可用，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json({ message: '重新解析任务已创建' })
  } catch (error) {
    console.error('[POST /api/projects/[id]/reparse]', error)
    return NextResponse.json({ error: '重新解析失败' }, { status: 500 })
  }
}
