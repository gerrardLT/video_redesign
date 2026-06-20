/**
 * 视频导出超分 API
 * POST /api/projects/[id]/export
 *
 * 接受目标分辨率参数（Zod 校验），执行并发检查 → 入队视频合并任务。
 * 入队前通过 ConcurrencyController 校验 merge 类型并发额度，
 * 超限返回 429 并附带升级提示；通过后使用 PriorityScheduler 按用户等级设置优先级入队。
 * 480p 直接合并导出；720p/1080p 合并后触发 WaveSpeed 超分流程（免费）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { videoMergeQueue } from '@/lib/queue'
import { getUserPrivileges } from '@/lib/privilege-engine'
import { buildRejectionResponse } from '@/lib/concurrency-controller'
import { scheduleWithPriority } from '@/lib/priority-scheduler'

export const dynamic = 'force-dynamic'

/** 导出请求体 Zod 校验 Schema */
const exportBodySchema = z.object({
  target_resolution: z.enum(['480p', '720p', '1080p']),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: projectId } = await params

    // 1. 参数校验（Zod 校验 target_resolution）
    const body = await request.json().catch(() => ({}))
    const parsed = exportBodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'INVALID_RESOLUTION',
          message: 'target_resolution 参数无效，合法取值为: 480p, 720p, 1080p',
        },
        { status: 400 }
      )
    }

    const { target_resolution } = parsed.data

    // 2. 鉴权校验：项目必须属于当前用户
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        shotGroups: {
          where: { genStatus: 'SUCCEEDED' },
          orderBy: { groupIndex: 'asc' },
          select: {
            groupIndex: true,
            genVideoUrl: true,
            genDuration: true,
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: '项目不存在' },
        { status: 404 }
      )
    }

    // 3. 状态校验：项目必须有已完成的分镜组
    if (project.shotGroups.length === 0) {
      return NextResponse.json(
        { error: 'INVALID_PROJECT_STATE', message: '项目没有已完成的分镜视频，无法导出' },
        { status: 409 }
      )
    }

    // 4. 重复导出校验：已有进行中的导出（MERGING/UPSCALING）则拒绝
    if (project.exportStatus === 'MERGING' || project.exportStatus === 'UPSCALING') {
      return NextResponse.json(
        { error: 'EXPORT_IN_PROGRESS', message: '已有导出任务进行中，请等待完成后再试' },
        { status: 409 }
      )
    }

    // 5. 并发额度检查：P0 修复——改为 DB 查询门控（与 generate/parse 一致），
    //    不再使用 Redis 原子计数器（checkAndIncrement），消除 Worker 完成后未 decrement 导致的计数漂移。
    //    DB 是唯一真相源：项目 exportStatus 变更（COMPLETED/FAILED）时并发额度自然释放。
    const privileges = await getUserPrivileges(userId)
    const activeMergeCount = await prisma.project.count({
      where: { userId, exportStatus: 'MERGING' },
    })
    if (activeMergeCount >= privileges.concurrency.merge) {
      return NextResponse.json(
        buildRejectionResponse(privileges.tier, 'merge', privileges.concurrency.merge),
        { status: 429 }
      )
    }

    // 6. 计算视频总时长（秒）
    const totalDuration = project.shotGroups.reduce(
      (sum, g) => sum + (g.genDuration || 0),
      0
    )

    // 7. 积分查询（720p/1080p 统一免费超分，不冻结积分）
    const estimatedCredits = 0
    let currentBalance = 0

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    currentBalance = user.creditBalance

    // 8. 构建分镜视频列表（按 groupIndex 排序）
    const shotVideoUrls = project.shotGroups.map((g) => ({
      orderIndex: g.groupIndex,
      videoUrl: g.genVideoUrl!,
      targetDuration: g.genDuration || undefined,
    }))

    // 9. 入队 video-merge 任务，使用优先级调度器按用户等级设置优先级
    await scheduleWithPriority(videoMergeQueue, 'export-merge', {
      projectId,
      userId,
      shotVideoUrls,
      outputAspectRatio: project.aspectRatio || '16:9',
      outputResolution: '480p', // 合并统一 480p，超分由后续 Worker 处理
      targetResolution: target_resolution, // 超分目标分辨率
      reservedCredits: estimatedCredits, // 冻结的积分数（480p 时为 0）
      videoDuration: totalDuration, // 视频总时长
    }, privileges.tier)

    // 10. 更新项目导出状态
    await prisma.project.update({
      where: { id: projectId },
      data: {
        exportStatus: 'MERGING',
        exportResolution: target_resolution,
        exportCreatedAt: new Date(),
        exportError: null,
        exportVideoUrl: null,
      },
    })

    // 11. 返回 202 Accepted
    return NextResponse.json(
      {
        exportId: projectId,
        status: 'MERGING',
        targetResolution: target_resolution,
        estimatedCredits,
        currentBalance,
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('[POST /api/projects/[id]/export]', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: '导出请求处理失败' },
      { status: 500 }
    )
  }
}
