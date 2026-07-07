import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// GET /api/jobs/[id] - 查询任务状态
export async function GET(
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

    return NextResponse.json({
      job: {
        id: job.id,
        shotId: job.shotId,
        projectId: job.projectId,
        status: job.status,
        costEstimate: job.costEstimate,
        resultVideoUrl: job.resultVideoUrl,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[GET /api/jobs/[id]]', error)
    return NextResponse.json({ error: '查询任务失败' }, { status: 500 })
  }
}
