/**
 * POST /api/projects/[id]/generate - 一键生成视频
 *
 * 核心流程：
 * 统一按分镜组分段，链式串行调用 Seedance（每组独立入队，由 Worker 完成后触发下一组）。
 *
 * 链式生成策略：
 * - 逐组独立生成：每组各自调用一次 Seedance，不传 first_frame（first_frame 已废弃）。
 * - 第一组入队后，后续组由 Worker 在前一组完成时依次触发，并自动跳过已 SUCCEEDED 的组。
 * - 最后一组生成完成后自动触发 FFmpeg concat 合并。
 *
 * 一致性保证：
 * - 所有组共用相同的「风格前缀」（从项目 StyleConfig 提取）。
 * - 人物外貌一致性由 asset:// 人物锚定 reference_image 承载（每组独立引用，不依赖链式尾帧传递）。
 * - 每组 prompt 经 mergeTimelineScript 合并，受 MAX_SCRIPT_LENGTH（250 字总预算）约束。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { videoGenerateQueue } from '@/lib/queue'
import { estimateGroupCreditCost } from '@/lib/credit-service'
import { withCreditLock } from '@/lib/distributed-lock'
import { isRateLimited } from '@/lib/rate-limiter'
import { mergeTimelineScript, type MergeInputShot } from '@/lib/script-merger'
import { MAX_GROUP_DURATION } from '@/lib/grouping-service'
import { buildGroupGenReference } from '@/lib/group-gen-context'

export const dynamic = 'force-dynamic'

const GenerateSchema = z.object({
  resolution: z.enum(['480p', '720p']).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: projectId } = await params

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
    const resolution = parseResult.data.resolution ?? '720p'

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
        styleConfig: {
          include: { template: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (project.status !== 'EDITABLE' && project.status !== 'FAILED') {
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

    // 获取全局风格描述（完整传入 mergeTimelineScript，由其内部根据 250 字总预算动态分配空间）
    // 不再做外层截断——风格行用多少字算多少，剩余空间给时间轴分段
    const stylePrefix = project.styleConfig?.template?.promptPrefix
      || project.styleConfig?.customDescription
      || ''

    // === 统一走链式串行生成（无论视频长度） ===
    // 每个分镜组独立调用 Seedance，last_frame → first_frame 传递一致性
    return await handleChainGenerate({
      userId,
      project,
      stylePrefix,
      resolution,
      aspectRatio,
    })
  } catch (error) {
    // 事务内余额不足抛出的错误，返回明确 400（而非通用 500）
    if (error instanceof Error && error.message === '积分余额不足') {
      return NextResponse.json({ error: '积分余额不足（并发扣减）' }, { status: 400 })
    }
    console.error('[POST /api/projects/[id]/generate]', error)
    return NextResponse.json({ error: '生成任务创建失败' }, { status: 500 })
  }
}

// ========================
// 链式串行生成（统一策略）
// ========================

async function handleChainGenerate(params: {
  userId: string
  project: {
    id: string
    shotGroups: Array<{
      id: string
      groupIndex: number
      genDuration: number
      startTime: number
      endTime: number
      genStatus: string
      audioKey: string | null
      shots: Array<{ orderIndex: number; startTime: number; endTime: number; prompt: string | null; dialogue: string | null; hasFace: boolean; coverUrl: string | null }>
    }>
    styleConfig?: { template?: { promptPrefix: string } | null; customDescription?: string | null } | null
  }
  stylePrefix: string
  resolution: string
  aspectRatio: string
}) {
  const { userId, project, stylePrefix, resolution, aspectRatio } = params
  const allGroups = project.shotGroups

  // 幂等/防重：若已有组处于进行中（QUEUED/GENERATING），说明生成正在进行，拒绝重复触发，
  // 避免重复建 Job + 重复冻结积分（修复 C）。
  const inProgressGroup = allGroups.find(
    (g) => g.genStatus === 'QUEUED' || g.genStatus === 'GENERATING'
  )
  if (inProgressGroup) {
    return NextResponse.json(
      { error: '该项目正在生成中，请勿重复触发', inProgressGroupId: inProgressGroup.id },
      { status: 409 }
    )
  }

  // 仅为「未成功」的组创建任务（跳过已 SUCCEEDED 的组，支持 FAILED 后续跑而不重复扣费/重复生成，修复 C）
  const groups = allGroups.filter((g) => g.genStatus !== 'SUCCEEDED')

  // 全部组已成功 → 无需再生成，直接触发合并（幂等返回）
  if (groups.length === 0) {
    return NextResponse.json(
      { mode: 'chain', idempotent: true, message: '所有分镜组已生成完成', totalJobs: 0 },
      { status: 200 }
    )
  }

  // 为每个待生成组合并 prompt
  const groupPrompts: Array<{ groupId: string; prompt: string; duration: number }> = []

  for (const group of groups) {
    const mergeInput: MergeInputShot[] = group.shots.map((s) => ({
      orderIndex: s.orderIndex,
      startTime: s.startTime,
      endTime: s.endTime,
      prompt: s.prompt,
      dialogue: s.dialogue,
    }))

    const genDuration = Math.min(Math.round(group.genDuration), MAX_GROUP_DURATION)
    const merged = mergeTimelineScript(mergeInput, {
      genDuration,
      stylePrefix,
      addNegativeConstraints: true,
    })

    // 装配该组人物引用前缀（图片N中的{角色} / 外貌兜底），baked 进 promptSnapshot，
    // 供链式续接直接复用，避免下游重复拼接。
    const groupRef = await buildGroupGenReference(group.id)
    groupPrompts.push({
      groupId: group.id,
      prompt: `${groupRef.characterPrefix}${merged.text}`,
      duration: genDuration,
    })
  }

  // 估算总积分（仅待生成组）
  const totalCost = groupPrompts.reduce(
    (sum, g) => sum + estimateGroupCreditCost(g.duration, resolution),
    0
  )

  // 检查余额
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < totalCost) {
    return NextResponse.json(
      { error: '积分余额不足', required: totalCost, available: user.creditBalance },
      { status: 400 }
    )
  }

  // 事务：一次性冻结全部积分 + 创建所有待生成组的 Job
  // 关键积分写（缺陷 11）：本路由运行于 Next.js 应用进程，整笔「冻结全部 + 建 Job」事务经
  // Redis 全局锁【跨进程】串行化，与 Worker 进程的扣费/退款互斥，消除 libSQL/SQLite 并发写
  // 锁竞争与读-改-写丢失更新（锁内复用 db-retry 兜底）。
  const jobs = await withCreditLock(() => prisma.$transaction(async (tx) => {
    // 事务内重读余额并二次校验（降低 TOCTOU 风险）
    const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    if (freshUser.creditBalance < totalCost) {
      throw new Error('积分余额不足')
    }

    const createdJobs: Array<{ id: string; groupId: string; groupIndex: number }> = []

    // 逐组扣减并记录正确的递减 balanceAfter（修复 B：不再全部写同一个最终余额）
    let runningBalance = freshUser.creditBalance
    for (let i = 0; i < groupPrompts.length; i++) {
      const g = groupPrompts[i]
      const group = groups[i]
      const cost = estimateGroupCreditCost(g.duration, resolution)
      runningBalance -= cost

      const newJob = await tx.generationJob.create({
        data: {
          userId,
          projectId: project.id,
          shotGroupId: g.groupId,
          status: 'QUEUED',
          promptSnapshot: g.prompt,
          duration: g.duration,
          aspectRatio,
          resolution,
          costEstimate: cost,
        },
      })

      await tx.creditLedger.create({
        data: {
          userId,
          jobId: newJob.id,
          action: 'RESERVE',
          amount: -cost,
          balanceAfter: runningBalance, // 逐笔递减，保证账本可对账
          remark: `一键生成(链式第${i + 1}/${groupPrompts.length}组)冻结 ${cost} 积分`,
        },
      })

      createdJobs.push({ id: newJob.id, groupId: g.groupId, groupIndex: group.groupIndex })
    }

    // 扣减用户余额到最终值
    await tx.user.update({ where: { id: userId }, data: { creditBalance: runningBalance } })

    // 更新项目状态；仅把待生成组及其分镜置 QUEUED（已成功组保持 SUCCEEDED）
    await tx.project.update({ where: { id: project.id }, data: { status: 'GENERATING' } })
    for (const group of groups) {
      await tx.shotGroup.update({ where: { id: group.id }, data: { genStatus: 'QUEUED' } })
      await tx.shot.updateMany({ where: { shotGroupId: group.id }, data: { genStatus: 'QUEUED' } })
    }

    return createdJobs
  }), 'projectReserve')

  // 只入队第一个待生成组（链式：后续由 Worker 完成时触发下一组，会自动跳过已成功组）
  const firstJob = jobs[0]
  const firstGroup = groups[0]
  const firstPrompt = groupPrompts[0]

  // 装配第一组的多模态参考（asset:// 人物锚定 + 场景帧 + 组音频，无 first_frame）
  const firstRef = await buildGroupGenReference(firstJob.groupId)

  await videoGenerateQueue.add('video-generate', {
    jobId: firstJob.id,
    shotGroupId: firstJob.groupId,
    projectId: project.id,
    userId,
    prompt: firstPrompt.prompt,
    duration: firstPrompt.duration,
    aspectRatio,
    resolution,
    // 链式生成参数：currentIndex 用首个待生成组的真实 groupIndex
    chainMode: true,
    chainTotalGroups: allGroups.length,
    chainCurrentIndex: firstGroup.groupIndex,
    // 多模态参考：人物身份由 asset:// 锚定资产承载（每组独立引用，不依赖链式尾帧）
    referenceImages: firstRef.referenceImages,
    referenceAudioUrl: firstRef.referenceAudioUrl,
  })

  return NextResponse.json(
    {
      mode: 'chain',
      totalJobs: jobs.length,
      costEstimate: totalCost,
      jobs: jobs.map((j, i) => ({
        id: j.id,
        groupIndex: j.groupIndex,
        status: i === 0 ? 'QUEUED' : 'WAITING',
      })),
    },
    { status: 202 }
  )
}
