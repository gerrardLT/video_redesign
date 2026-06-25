import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/api-error'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status')

    const where = statusFilter ? { status: statusFilter } : {}

    const jobs = await prisma.generationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true } },
        // 单分镜任务通过 shot 关联项目名；按组任务（shotId 为空）通过 shotGroup 关联项目名
        shot: {
          select: {
            project: { select: { name: true } },
          },
        },
        shotGroup: {
          select: {
            project: { select: { name: true } },
          },
        },
      },
    })

    const result = jobs.map((job) => ({
      id: job.id,
      status: job.status,
      userEmail: job.user.email,
      // 兼容单分镜任务与按组任务两种归属来源
      projectName: job.shot?.project.name ?? job.shotGroup?.project.name ?? null,
      seedanceTaskId: job.seedanceTaskId,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      resolution: job.resolution,
      retryCount: job.retryCount,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    }))

    return NextResponse.json({ jobs: result })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/jobs]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取任务列表失败')
  }
}
