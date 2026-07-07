/**
 * 导出状态查询 API
 * GET /api/projects/[id]/export-status
 *
 * 返回当前导出任务状态（MERGING / UPSCALING / COMPLETED / FAILED）、
 * 输出分辨率、视频 URL、错误信息、退还积分数。
 * 前端轮询（3s 间隔）调用，用于实时展示导出进度。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: projectId } = await params

    // 项目归属校验
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        exportStatus: true,
        exportResolution: true,
        exportVideoUrl: true,
        exportError: true,
        exportCreatedAt: true,
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: '项目不存在' },
        { status: 404 }
      )
    }

    // 无导出记录时返回空状态
    if (!project.exportStatus) {
      return NextResponse.json({
        status: null,
        resolution: null,
        videoUrl: null,
        errorMessage: null,
        refundedCredits: null,
        createdAt: null,
      })
    }

    // 查询退还积分数（FAILED 状态时有意义）
    let refundedCredits: number | null = null
    if (project.exportStatus === 'FAILED') {
      const refundEntry = await prisma.creditLedger.findFirst({
        where: {
          userId,
          projectId,
          action: 'REFUND',
        },
        orderBy: { createdAt: 'desc' },
        select: { amount: true },
      })
      refundedCredits = refundEntry?.amount ?? null
    }

    return NextResponse.json({
      status: project.exportStatus,
      resolution: project.exportResolution,
      videoUrl: project.exportVideoUrl,
      errorMessage: project.exportError,
      refundedCredits,
      createdAt: project.exportCreatedAt,
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/export-status]', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: '查询导出状态失败' },
      { status: 500 }
    )
  }
}
