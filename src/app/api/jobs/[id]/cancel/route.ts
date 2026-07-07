import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { canCancel, assertTransition } from '@/lib/shared/state-machine'
import { refundCredits } from '@/lib/shared/credit-service'

export const dynamic = 'force-dynamic'

// POST /api/jobs/[id]/cancel - 取消任务
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

    if (!canCancel(job.status)) {
      return NextResponse.json(
        { error: `当前状态 ${job.status} 不可取消` },
        { status: 400 }
      )
    }

    // 该接口仅处理单分镜任务；按组任务（shotId 为空）应走按组取消逻辑
    if (!job.shotId) {
      return NextResponse.json(
        { error: '该任务为分镜组任务，不支持此单分镜取消操作' },
        { status: 409 }
      )
    }
    const shotId = job.shotId

    // 状态机强制校验：当前状态 → CANCELED 必须合法（启用状态机，非法转换直接抛错）
    assertTransition(job.status, 'CANCELED')

    // 更新任务状态
    await prisma.generationJob.update({
      where: { id },
      data: { status: 'CANCELED' },
    })

    // 更新分镜状态
    await prisma.shot.update({
      where: { id: shotId },
      data: { genStatus: 'CANCELED' },
    })

    // 返还积分
    if (job.costEstimate && job.costEstimate > 0) {
      await refundCredits(userId, job.id, job.costEstimate)
    }

    return NextResponse.json({ success: true, status: 'CANCELED' })
  } catch (error) {
    console.error('[POST /api/jobs/[id]/cancel]', error)
    return NextResponse.json({ error: '取消任务失败' }, { status: 500 })
  }
}
