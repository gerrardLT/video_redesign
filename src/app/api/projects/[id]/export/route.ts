/**
 * 项目导出 API
 * POST /api/projects/[id]/export - 触发项目合并导出
 *
 * 导出前检查是否存在 STALE 状态的分镜组（Req 7.4）
 * 存在 STALE 组则拒绝导出并返回 STALE 组列表
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { videoMergeQueue } from '@/lib/queue'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: projectId } = await params

    // 校验项目存在且归属当前用户
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 查询所有分镜组
    const shotGroups = await prisma.shotGroup.findMany({
      where: { projectId },
      orderBy: { groupIndex: 'asc' },
      select: {
        id: true,
        groupIndex: true,
        genStatus: true,
        genVideoUrl: true,
        startTime: true,
        endTime: true,
        genDuration: true,
      },
    })

    // 检查是否存在 STALE 状态的分镜组（Req 7.4）
    const staleGroups = shotGroups.filter(g => g.genStatus === 'STALE')
    if (staleGroups.length > 0) {
      return NextResponse.json({
        error: '存在过期分镜组需要重新生成',
        staleGroups: staleGroups.map(g => ({ id: g.id, groupIndex: g.groupIndex })),
      }, { status: 400 })
    }

    // 检查是否所有分镜组都已生成成功
    const notSucceeded = shotGroups.filter(g => g.genStatus !== 'SUCCEEDED')
    if (notSucceeded.length > 0) {
      return NextResponse.json({
        error: '存在未完成生成的分镜组',
        pendingGroups: notSucceeded.map(g => ({
          id: g.id,
          groupIndex: g.groupIndex,
          genStatus: g.genStatus,
        })),
      }, { status: 400 })
    }

    // 构建合并任务数据
    // targetDuration = 该组在原视频中的真实时长（endTime - startTime）。
    // 当 Seedance 因 4s 下限把短组拉伸（genDuration > targetDuration）时，
    // 合并阶段按 targetDuration 裁切，保证最终时序对齐原片（trim-on-merge）。
    const shotVideoUrls = shotGroups
      .filter(g => g.genVideoUrl)
      .map(g => ({
        orderIndex: g.groupIndex,
        videoUrl: g.genVideoUrl!,
        targetDuration: Math.max(0, g.endTime - g.startTime),
        genDuration: g.genDuration,
      }))

    if (shotVideoUrls.length === 0) {
      return NextResponse.json({ error: '没有可合并的视频' }, { status: 400 })
    }

    // 入队合并任务
    const mergeJob = await videoMergeQueue.add('video-merge', {
      projectId,
      userId,
      shotVideoUrls,
      outputAspectRatio: project.aspectRatio || '16:9',
      outputResolution: '720p',
    })

    // 更新项目状态为 GENERATING（合并中）
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'GENERATING' },
    })

    return NextResponse.json(
      { message: '导出任务已创建', jobId: mergeJob.id },
      { status: 202 }
    )
  } catch (error) {
    console.error('[POST /api/projects/[id]/export]', error)
    return NextResponse.json({ error: '导出任务创建失败' }, { status: 500 })
  }
}
