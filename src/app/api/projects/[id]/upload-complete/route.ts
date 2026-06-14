import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { estimateParseCreditCost, getBalance } from '@/lib/credit-service'

export const dynamic = 'force-dynamic'

const UploadCompleteSchema = z.object({
  videoUrl: z.string().min(1, '视频 URL 不能为空'),
  localUrl: z.string().optional(), // 本地相对路径，供 parse-video FFmpeg 使用
})

// POST /api/projects/[id]/upload-complete - 确认上传完成并触发解析
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params
    const body = await request.json()

    const parsed = UploadCompleteSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    // 校验项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 余额闸门：解析会消耗 AI 分析 + 首帧图等真实资源，入队前校验余额（按项目时长预估）
    // 最终扣费以 worker 端实际视频元数据时长为准。
    const estimatedCost = estimateParseCreditCost(project.duration ?? 0)
    const balance = await getBalance(userId)
    if (balance < estimatedCost) {
      return NextResponse.json(
        { error: '积分余额不足，无法开始解析', required: estimatedCost, available: balance },
        { status: 402 }
      )
    }

    // 更新项目 videoUrl（存 OSS 公网 URL）
    await prisma.project.update({
      where: { id },
      data: { videoUrl: parsed.data.videoUrl },
    })

    // 传给 parse-video 的路径：优先使用本地路径（FFmpeg 需要本地文件）
    // 如果没有 localUrl，降级使用 videoUrl（兼容旧逻辑，只有本地路径才能被 FFmpeg 处理）
    const parseVideoUrl = parsed.data.localUrl || parsed.data.videoUrl

    // 添加解析任务到队列；入队失败时不静默吞掉，标记项目 FAILED 并返回错误
    try {
      const { videoParseQueue } = await import('@/lib/queue')
      await videoParseQueue.add('parse-video', {
        projectId: id,
        videoUrl: parseVideoUrl,
      })
    } catch (queueError) {
      const reason = queueError instanceof Error ? queueError.message : String(queueError)
      console.error('[upload-complete] 添加解析任务到队列失败:', reason)
      await prisma.project.update({
        where: { id },
        data: { status: 'FAILED', errorMsg: `解析任务入队失败：${reason}` },
      }).catch(() => {})
      return NextResponse.json(
        { error: '解析任务入队失败，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json({ message: '解析任务已创建' })
  } catch (error) {
    console.error('[POST /api/projects/[id]/upload-complete]', error)
    return NextResponse.json({ error: '确认上传失败' }, { status: 500 })
  }
}
