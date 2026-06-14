import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { canRetry, assertTransition } from '@/lib/state-machine'
import { estimateCreditCost, reserveCredits } from '@/lib/credit-service'
import { videoGenerateQueue } from '@/lib/queue'
import { buildReferenceData } from '@/lib/reference-builder'

export const dynamic = 'force-dynamic'

// POST /api/jobs/[id]/retry - 重试失败任务
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    const job = await prisma.generationJob.findFirst({
      where: { id, userId },
    })

    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (!canRetry(job.status)) {
      return NextResponse.json(
        { error: `当前状态 ${job.status} 不可重试` },
        { status: 400 }
      )
    }

    // 状态机强制校验：重试路径 FAILED → QUEUED 必须合法（启用状态机）
    assertTransition(job.status, 'QUEUED')

    // 该接口仅处理单分镜任务；按组任务（shotId 为空）应走按组重试逻辑
    if (!job.shotId) {
      return NextResponse.json(
        { error: '该任务为分镜组任务，不支持此单分镜重试操作' },
        { status: 409 }
      )
    }
    const shotId = job.shotId

    // 重新估算积分
    const costEstimate = estimateCreditCost(job.duration, job.resolution)

    // 检查余额
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.creditBalance < costEstimate) {
      return NextResponse.json(
        { error: '积分余额不足', required: costEstimate, available: user.creditBalance },
        { status: 400 }
      )
    }

    // 查询 shot 关联数据（coverUrl、shotAssets、组音频）用于构建参考数据
    const shot = await prisma.shot.findUnique({
      where: { id: shotId },
      include: {
        shotAssets: { include: { asset: true }, orderBy: { displayNum: 'asc' } },
        shotGroup: { select: { audioKey: true } },
      },
    })

    // 构建参考数据（若 shot 查询失败则降级为空参考数据；first_frame / reference_video 已废弃，仅装配多模态参考）
    let referenceImages: string[] = job.assetSnapshot
      ? JSON.parse(job.assetSnapshot)
      : []

    if (shot) {
      // 将 ShotGroup.audioKey（OSS 对象键）转为公网 URL 传入
      const groupAudioUrl = shot.shotGroup?.audioKey
        ? `${process.env.OSS_PUBLIC_URL || ''}/${shot.shotGroup.audioKey}`
        : undefined

      const refData = buildReferenceData({
        shot: {
          id: shot.id,
          orderIndex: shot.orderIndex,
          coverUrl: shot.coverUrl,
          prompt: shot.prompt,
          shotAssets: shot.shotAssets,
        },
        projectId: job.projectId,
        groupAudioUrl,
      })
      referenceImages = refData.referenceImages
    }

    // 创建新 Job
    const newJob = await prisma.generationJob.create({
      data: {
        userId,
        projectId: job.projectId,
        shotId: shotId,
        status: 'QUEUED',
        promptSnapshot: job.promptSnapshot,
        assetSnapshot: job.assetSnapshot,
        duration: job.duration,
        aspectRatio: job.aspectRatio,
        resolution: job.resolution,
        costEstimate,
        retryCount: job.retryCount + 1,
      },
    })

    // 冻结积分
    await reserveCredits(userId, newJob.id, costEstimate)

    // 更新分镜状态
    await prisma.shot.update({
      where: { id: shotId },
      data: { genStatus: 'QUEUED' },
    })

    // 添加到队列（传递多模态参考数据；first_frame / reference_video 已废弃）
    await videoGenerateQueue.add('video-generate', {
      jobId: newJob.id,
      shotId: shotId,
      projectId: job.projectId,
      userId,
      prompt: job.promptSnapshot || '',
      referenceImages,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      resolution: job.resolution,
    })

    return NextResponse.json(
      { job: { id: newJob.id, status: 'QUEUED', costEstimate } },
      { status: 202 }
    )
  } catch (error) {
    console.error('[POST /api/jobs/[id]/retry]', error)
    return NextResponse.json({ error: '重试任务失败' }, { status: 500 })
  }
}
