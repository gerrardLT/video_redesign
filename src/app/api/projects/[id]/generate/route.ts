/**
 * POST /api/projects/[id]/generate - 一键生成视频
 *
 * 核心流程：
 * 1. 校验项目状态与分镜完整性
 * 2. 获取用户特权（含并发配置）
 * 3. 项目级并发检查（基于 DB 查询 GENERATING 项目数量，纯门控不侵入 Worker）
 * 4. 先完成所有 DB 状态写入（项目/分镜组/分镜 → GENERATING/QUEUED），再入队 BullMQ
 * 5. 调用 GenerationOrchestrator 执行链式串行编排：
 *    - 所有等级统一走链式串行（仅入队第一组，chainMode=true，后续由 Worker 逐组触发）
 * 6. 返回 OrchestrationResult（202 Accepted）
 *
 * 并发控制：
 * - 入队前通过 DB 查询 status='GENERATING' 的项目数量进行门控（项目级）
 * - 超限返回 429 + CONCURRENCY_LIMIT_REACHED 响应体（含升级提示）
 * - orchestrateGeneration 失败时回滚 DB 状态（无需 decrement，并发由 DB 状态自然释放）
 *
 * 积分保证：
 * - 编排器内部通过 withCreditLock 原子冻结全部组积分
 * - 余额不足返回 402 + INSUFFICIENT_CREDITS
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { isRateLimited } from '@/lib/shared/rate-limiter'
import { orchestrateGeneration, type OrchestrationGroup } from '@/lib/video/generation-orchestrator'
import { getUserPrivileges } from '@/lib/shared/privilege-engine'
import { buildRejectionResponse } from '@/lib/shared/concurrency-controller'
import { ApiError } from '@/lib/shared/api-error'

export const dynamic = 'force-dynamic'

const GenerateSchema = z.object({
  resolution: z.enum(['480p', '720p']).optional(),
  engine: z.enum(['seedance', 'happyhorse']).optional(),
  // HappyHorse 模式专用参数
  prompt: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = request.headers.get('x-user-id')!
  const { id: projectId } = await params

  try {
    // 速率限制
    if (isRateLimited(userId, 'generate')) {
      return NextResponse.json({ error: '请求过于频繁，请稍后重试' }, { status: 429 })
    }

    // 校验请求体
    const body = await request.json().catch(() => ({}))
    const parseResult = GenerateSchema.safeParse(body ?? {})
    if (!parseResult.success) {
      return NextResponse.json({ error: '参数校验失败' }, { status: 400 })
    }
    const resolution = parseResult.data.resolution ?? '480p'

    // 查询项目 + 分镜组 + 分镜
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        shotGroups: {
          orderBy: { groupIndex: 'asc' },
          include: {
            shots: { orderBy: { orderIndex: 'asc' } },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 引擎转发：当显式传入 engine=happyhorse 或项目默认引擎为 happyhorse 时，转发到 HappyHorse 编排
    const requestedEngine = parseResult.data.engine || project.engine || 'seedance'
    if (requestedEngine === 'happyhorse') {
      const { orchestrateHappyHorseGeneration } = await import('@/lib/video/generation-orchestrator')
      const { getUserPrivileges: getPriv } = await import('@/lib/shared/privilege-engine')
      const privileges = await getPriv(userId)

      if (!project.videoUrl || !project.duration) {
        return NextResponse.json(
          { error: '项目无原始视频或时长信息，无法使用 HappyHorse 模式' },
          { status: 400 }
        )
      }

      if (!parseResult.data.prompt) {
        return NextResponse.json(
          { error: 'HappyHorse 模式需要提供 prompt 参数' },
          { status: 400 }
        )
      }

      try {
        const result = await orchestrateHappyHorseGeneration({
          userId,
          projectId,
          videoUrl: project.videoUrl,
          videoDuration: project.duration,
          prompt: parseResult.data.prompt,
          referenceImages: parseResult.data.referenceImages,
          tier: privileges.tier,
        })

        await prisma.project.update({
          where: { id: projectId },
          data: { status: 'GENERATING', engine: 'happyhorse' },
        })

        return NextResponse.json(result, { status: 202 })
      } catch (error) {
        if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS') {
          return NextResponse.json(
            { error: 'INSUFFICIENT_CREDITS', message: error.message },
            { status: 402 }
          )
        }
        throw error
      }
    }

    if (project.status !== 'EDITABLE' && project.status !== 'FAILED' && project.status !== 'MERGE_FAILED') {
      return NextResponse.json(
        { error: `项目状态为 ${project.status}，无法生成` },
        { status: 400 }
      )
    }

    if (project.shotGroups.length === 0) {
      return NextResponse.json({ error: '项目没有分镜组，请先解析视频' }, { status: 400 })
    }

    // 校验所有分镜都有 prompt
    const allShots = project.shotGroups.flatMap((g) => g.shots)
    const missingPrompt = allShots.filter((s) => !s.prompt || s.prompt.trim() === '')
    if (missingPrompt.length > 0) {
      return NextResponse.json(
        { error: '存在缺少提示词的分镜，无法生成', missingShotIds: missingPrompt.map((s) => s.id) },
        { status: 400 }
      )
    }

    const aspectRatio = project.aspectRatio ?? '16:9'

    // 幂等/防重：若已有组处于进行中（QUEUED/GENERATING），拒绝重复触发
    const inProgressGroup = project.shotGroups.find(
      (g) => g.genStatus === 'QUEUED' || g.genStatus === 'GENERATING'
    )
    if (inProgressGroup) {
      return NextResponse.json(
        { error: '该项目正在生成中，请勿重复触发', inProgressGroupId: inProgressGroup.id },
        { status: 409 }
      )
    }

    // 仅为「未成功」的组发起生成（跳过已 SUCCEEDED 的组）
    const pendingGroups = project.shotGroups.filter((g) => g.genStatus !== 'SUCCEEDED')

    // 全部组已成功 → 无需再生成
    if (pendingGroups.length === 0) {
      return NextResponse.json(
        { mode: 'chain', idempotent: true, message: '所有分镜组已生成完成', totalJobs: 0 },
        { status: 200 }
      )
    }

    // === 获取用户特权（含并发配置） ===
    const privileges = await getUserPrivileges(userId)

    // === 项目级并发检查：查询用户当前正在生成中的项目数量 ===
    const generatingProjectCount = await prisma.project.count({
      where: { userId, status: 'GENERATING' },
    })
    if (generatingProjectCount >= privileges.concurrency.generate) {
      return NextResponse.json(
        buildRejectionResponse(privileges.tier, 'generate', privileges.concurrency.generate),
        { status: 429 }
      )
    }

    // === 调用 GenerationOrchestrator 执行链式串行编排 ===
    // 构建编排参数：待生成的分镜组列表
    const orchestrationGroups: OrchestrationGroup[] = pendingGroups.map((g) => ({
      id: g.id,
      duration: g.genDuration,
      shotGroupIndex: g.groupIndex,
    }))

    // 先更新项目和分镜组/分镜状态（在 BullMQ 入队前完成所有 DB 写）
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'GENERATING' },
    })
    for (const group of pendingGroups) {
      await prisma.shotGroup.update({
        where: { id: group.id },
        data: { genStatus: 'QUEUED' },
      })
      await prisma.shot.updateMany({
        where: { shotGroupId: group.id },
        data: { genStatus: 'QUEUED' },
      })
    }

    let orchestrationSucceeded = false
    try {
      const result = await orchestrateGeneration({
        userId,
        projectId,
        groups: orchestrationGroups,
        resolution,
        aspectRatio,
        tier: privileges.tier,
      })
      orchestrationSucceeded = true

      // 返回编排结果（202 Accepted）
      return NextResponse.json(
        {
          mode: result.mode,
          enqueuedGroups: result.enqueuedGroups,
          totalGroups: result.totalGroups,
          totalCost: result.totalCost,
          jobs: result.jobs,
        },
        { status: 202 }
      )
    } catch (error) {
      // 编排未成功：回滚 DB 状态（无需 decrement，并发控制基于 DB 项目状态查询）
      if (!orchestrationSucceeded) {
        // 编排失败：回滚项目和分镜组状态
        await prisma.project.update({
          where: { id: projectId },
          data: { status: 'EDITABLE' },
        }).catch(() => {})
        for (const group of pendingGroups) {
          await prisma.shotGroup.update({
            where: { id: group.id },
            data: { genStatus: 'PENDING' },
          }).catch(() => {})
          await prisma.shot.updateMany({
            where: { shotGroupId: group.id },
            data: { genStatus: 'PENDING' },
          }).catch(() => {})
        }
      }

      // 区分错误类型返回对应 HTTP 状态码
      if (error instanceof ApiError) {
        if (error.code === 'INSUFFICIENT_CREDITS') {
          return NextResponse.json(
            { error: error.message, code: 'INSUFFICIENT_CREDITS' },
            { status: 402 }
          )
        }
        if (error.code === 'CONCURRENCY_LIMIT_REACHED') {
          return NextResponse.json(
            { error: error.message, code: 'CONCURRENCY_LIMIT_REACHED' },
            { status: 429 }
          )
        }
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.statusCode }
        )
      }

      // 事务内余额不足抛出的通用错误
      if (error instanceof Error && error.message === '积分余额不足') {
        return NextResponse.json(
          { error: '积分余额不足', code: 'INSUFFICIENT_CREDITS' },
          { status: 402 }
        )
      }

      throw error // 未知错误重新抛出，由外层 catch 处理
    }
  } catch (error) {
    console.error('[POST /api/projects/[id]/generate]', error)
    return NextResponse.json({ error: '生成任务创建失败' }, { status: 500 })
  }
}
