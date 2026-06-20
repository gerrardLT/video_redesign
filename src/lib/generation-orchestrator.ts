/**
 * 生成编排器（GenerationOrchestrator）
 *
 * 所有等级统一走链式串行模式：仅入队第一组（chainMode=true），后续由 Worker 逐组触发。
 * 原因：分镜组尾帧衔接需要前一组完成后才能拿到尾帧给下一组，因此必须串行。
 *
 * 并发限制的含义为"项目级"：用户能同时对多少个不同项目发起生成任务，
 * 由 API 入口基于 DB 项目状态查询门控（在 route.ts 中完成），不侵入 Worker 内部。
 *
 * 核心流程：
 * 1. 计算所有分镜组的积分总消耗
 * 2. 校验用户余额是否充足（不足则拒绝，绝不欠费）
 * 3. 通过 withCreditLock 原子冻结全部积分（批量 RESERVE）
 * 4. 只入队第一组（chainMode=true），其余组保持 QUEUED 等待链式续接
 * 5. 创建 GenerationJob 数据库记录
 */

import { estimateGroupCreditCost } from '@/lib/credit-service'
import { withCreditLock } from '@/lib/distributed-lock'
import { scheduleWithPriority } from '@/lib/priority-scheduler'
import { videoGenerateQueue } from '@/lib/queue'
import { prisma } from '@/lib/db'
import { buildGroupGenReference } from '@/lib/group-gen-context'
import { ApiError } from '@/lib/api-error'
import { type UserTier } from '@/constants/concurrency'

// ========================
// 类型定义
// ========================

/** 编排参数：分镜组信息 */
export interface OrchestrationGroup {
  /** 分镜组 ID */
  id: string
  /** 分镜组总时长（秒） */
  duration: number
  /** 分镜组在项目中的顺序索引 */
  shotGroupIndex: number
}

/** 编排入参 */
export interface OrchestrationParams {
  /** 用户 ID */
  userId: string
  /** 项目 ID */
  projectId: string
  /** 待生成的分镜组列表 */
  groups: Array<OrchestrationGroup>
  /** 生成分辨率 */
  resolution: string
  /** 画面宽高比 */
  aspectRatio: string
  /** 用户等级 */
  tier: UserTier
}

/** 编排结果 */
export interface OrchestrationResult {
  /** 生成模式：始终为 chain（链式串行） */
  mode: 'chain'
  /** 本次实际入队的分镜组数量（始终为 1） */
  enqueuedGroups: number
  /** 分镜组总数 */
  totalGroups: number
  /** 积分总消耗 */
  totalCost: number
  /** 各分镜组的任务信息 */
  jobs: Array<{ id: string; groupIndex: number; status: string }>
}

// ========================
// 编排主逻辑
// ========================

/**
 * 编排一键生成（所有等级统一链式串行）
 *
 * 完整流程：
 * a. 计算全部组积分总消耗
 * b. 校验用户余额
 * c. withCreditLock 原子冻结全部积分
 * d. 只入队第一组（chainMode=true），其余由 Worker 链式续接
 *
 * @param params - 编排参数
 * @returns 编排结果
 * @throws ApiError('INSUFFICIENT_CREDITS') 余额不足时抛出
 */
export async function orchestrateGeneration(params: OrchestrationParams): Promise<OrchestrationResult> {
  const { userId, projectId, groups, resolution, aspectRatio, tier } = params

  // a. 计算全部组的积分总消耗
  const totalCost = groups.reduce(
    (sum, group) => sum + estimateGroupCreditCost(group.duration, resolution),
    0
  )

  // b. 校验用户余额
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.creditBalance < totalCost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：生成需 ${totalCost} 积分，当前余额 ${user.creditBalance}`,
      402
    )
  }

  // c. 使用 withCreditLock 原子冻结全部积分
  // 在单次事务中为所有分镜组创建 RESERVE 流水并扣减余额
  const jobRecords = await withCreditLock(async () => {
    return prisma.$transaction(async (tx) => {
      // 事务内二次校验余额（防止并发窗口内余额变动）
      const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (freshUser.creditBalance < totalCost) {
        throw new ApiError(
          'INSUFFICIENT_CREDITS',
          `积分不足：生成需 ${totalCost} 积分，当前余额 ${freshUser.creditBalance}`,
          402
        )
      }

      // 一次性扣减用户余额
      const newBalance = freshUser.creditBalance - totalCost
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })

      // 为每个分镜组创建 RESERVE 流水 + GenerationJob 记录
      let runningBalance = newBalance + totalCost // 从扣减前余额逐步减少记录每组的 balanceAfter
      const jobs: Array<{ id: string; groupIndex: number; status: string; estimatedCost: number }> = []

      for (const group of groups) {
        const groupCost = estimateGroupCreditCost(group.duration, resolution)
        runningBalance -= groupCost

        // 创建 GenerationJob 记录（直接设为 QUEUED，由 Worker 链式续接时直接拾取）
        const job = await tx.generationJob.create({
          data: {
            userId,
            projectId,
            shotGroupId: group.id,
            status: 'QUEUED',
            resolution,
            aspectRatio,
            costEstimate: groupCost,
          },
        })

        // 创建 RESERVE 积分流水
        await tx.creditLedger.create({
          data: {
            userId,
            jobId: job.id,
            action: 'RESERVE',
            amount: -groupCost,
            balanceAfter: runningBalance,
            remark: `冻结分镜组 #${group.shotGroupIndex + 1} 积分（${groupCost}）`,
          },
        })

        jobs.push({
          id: job.id,
          groupIndex: group.shotGroupIndex,
          status: 'QUEUED',
          estimatedCost: groupCost,
        })
      }

      return jobs
    })
  }, 'orchestrateGeneration')

  // d. 所有等级统一走链式串行：只入队第一组，其余由 Worker 链式续接
  // Job 创建时已为 QUEUED，无需额外更新状态

  // d.2 构建第一组的生成上下文（prompt、referenceImages、音频）并入队 BullMQ
  const firstGroup = groups[0]
  const firstRef = await buildGroupGenReference(firstGroup.id)

  // 读取第一组所有分镜的 prompt 并拼接（Seedance 时间轴分镜脚本需要全部分镜的 prompt）
  const firstGroupShots = await prisma.shot.findMany({
    where: { shotGroupId: firstGroup.id },
    orderBy: { orderIndex: 'asc' },
    select: { prompt: true },
  })
  const shotsPromptText = firstGroupShots.map(s => s.prompt || '').filter(p => p.trim()).join('\n')
  let firstPrompt = firstRef.characterPrefix + shotsPromptText
  let referenceImages = firstRef.referenceImages

  // 尾帧衔接：检查第一个 pending 组前面是否有已 SUCCEEDED 的组（含 genVideoUrl）
  // reference_video 方案：无条件用前一组视频作衔接参考，不再做场景判定
  const prevSucceededGroup = await prisma.shotGroup.findFirst({
    where: {
      projectId,
      groupIndex: { lt: firstGroup.shotGroupIndex },
      genStatus: 'SUCCEEDED',
      genVideoUrl: { not: null },
    },
    orderBy: { groupIndex: 'desc' }, // 取最近的一个已成功组
    select: { id: true, genVideoUrl: true, lastFrameUrl: true },
  })

  let prevGroupVideoUrl: string | undefined
  if (prevSucceededGroup?.genVideoUrl) {
    // 有前一组视频 → 传入作 reference_video，并在 prompt 追加衔接指令
    const { VIDEO_CONTINUATION_PROMPT_SUFFIX } = await import('@/lib/frame-continuity')
    prevGroupVideoUrl = prevSucceededGroup.genVideoUrl
    firstPrompt = `${firstPrompt}${VIDEO_CONTINUATION_PROMPT_SUFFIX}`
  }

  // 获取分镜组时长
  const firstShotGroup = await prisma.shotGroup.findUnique({
    where: { id: firstGroup.id },
    select: { genDuration: true },
  })

  await scheduleWithPriority(
    videoGenerateQueue,
    'generate-video',
    {
      jobId: jobRecords[0].id,
      userId,
      projectId,
      shotGroupId: firstGroup.id,
      shotGroupIndex: firstGroup.shotGroupIndex,
      resolution,
      aspectRatio,
      prompt: firstPrompt,
      duration: firstShotGroup?.genDuration ?? firstGroup.duration,
      referenceImages,
      referenceAudioUrl: firstRef.referenceAudioUrl,
      referenceVideoUrl: prevGroupVideoUrl, // reference_video 无缝衔接（第一组无前序视频时为 undefined）
      chainMode: true,
      chainTotalGroups: groups.length,
      chainCurrentIndex: groups[0].shotGroupIndex, // 使用真实 groupIndex，非数组索引
    },
    tier
  )

  // 构建返回结果
  const result: OrchestrationResult = {
    mode: 'chain',
    enqueuedGroups: 1,
    totalGroups: groups.length,
    totalCost,
    jobs: jobRecords.map((job) => ({
      id: job.id,
      groupIndex: job.groupIndex,
      status: job.status,
    })),
  }

  return result
}
