import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/shots/[id]/latest-job - 获取分镜最新的生成任务
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: shotId } = await params

    const job = await prisma.generationJob.findFirst({
      where: { shotId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        resultVideoUrl: true,
        errorMessage: true,
        costEstimate: true,
        createdAt: true,
      },
    })

    if (!job) {
      return NextResponse.json({ job: null })
    }

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        resultVideoUrl: job.resultVideoUrl,
        errorMessage: job.errorMessage,
        costEstimate: job.costEstimate,
      },
    })
  } catch (error) {
    console.error('[GET /api/shots/[id]/latest-job]', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
