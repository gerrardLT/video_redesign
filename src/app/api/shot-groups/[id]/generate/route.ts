import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { videoGenerateQueue } from '@/lib/shared/queue'
import { estimateGroupCreditCost } from '@/lib/shared/credit-service'
import { withCreditLock } from '@/lib/shared/distributed-lock'
import { isRateLimited } from '@/lib/shared/rate-limiter'
import { mergeTimelineScript, type MergeInputShot } from '@/lib/video/script-merger'
import { computeScriptHash } from '@/lib/shared/script-hash'
import { MAX_GROUP_DURATION } from '@/lib/video/grouping-service'
import { buildGroupGenReference } from '@/lib/video/group-gen-context'
import { getPrevGroupVideoUrl, VIDEO_CONTINUATION_PROMPT_SUFFIX } from '@/lib/video/frame-continuity'

export const dynamic = 'force-dynamic'

// 按组生成请求参数 schema
// duration 不来自请求体：以 ShotGroup.genDuration 为准（分组算法已约束在 [4,15]）
// resolution/aspectRatio 可选，缺省沿用默认值（480p / 16:9）
// force：抽卡（re-roll）开关。用户主动点「重新生成」时传 true，
//        跳过 SUCCEEDED 的 scriptHash 幂等短路，强制重新调用 Seedance 拿新结果（正常扣积分）。
const GenerateSchema = z.object({
  // aspectRatio 接受任意字符串（Seedance 使用 adaptive 自动匹配，项目画幅可能是 "1920:1080" 等原始格式）
  aspectRatio: z.string().optional(),
  resolution: z.enum(['480p', '720p']).optional(),
  force: z.boolean().optional(),
})

// POST /api/shot-groups/[id]/generate - 触发分镜组合并视频生成
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!

    // 速率限制检查（与单分镜生成共用 generate 限流键）
    if (isRateLimited(userId, 'generate')) {
      return NextResponse.json({ error: '请求过于频繁，请稍后重试' }, { status: 429 })
    }

    const { id: shotGroupId } = await params

    // 校验请求体（resolution/aspectRatio 可选）
    const body = await request.json().catch(() => ({}))
    const parseResult = GenerateSchema.safeParse(body ?? {})
    if (!parseResult.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    // 校验分镜组存在且归属当前用户（通过 group.project.userId）
    const group = await prisma.shotGroup.findFirst({
      where: { id: shotGroupId },
      include: {
        project: { select: { id: true, userId: true, aspectRatio: true } },
        shots: {
          orderBy: { orderIndex: 'asc' },
          include: {
            shotAssets: {
              select: { asset: { select: { url: true, isCharImage: true } } },
            },
          },
        },
      },
    })

    if (!group || group.project.userId !== userId) {
      return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
    }

    // 校验组内 Shot 非空
    if (group.shots.length === 0) {
      return NextResponse.json({ error: '分镜组内没有分镜，无法生成' }, { status: 400 })
    }

    // 校验各 Shot 的 prompt 齐备（任一为空即拒绝，不静默跳过）
    const missingPromptShots = group.shots.filter(
      (s) => !s.prompt || s.prompt.trim().length === 0
    )
    if (missingPromptShots.length > 0) {
      return NextResponse.json(
        {
          error: '组内存在缺少提示词的分镜，无法生成',
          missingShotOrderIndexes: missingPromptShots.map((s) => s.orderIndex),
        },
        { status: 400 }
      )
    }

    // 解析分辨率与画幅：请求体优先，其次项目设置，最后回落 GenerationJob 默认值
    const resolution = parseResult.data.resolution ?? '480p'
    const aspectRatio =
      parseResult.data.aspectRatio ?? group.project.aspectRatio ?? '16:9'
    // 抽卡开关：用户主动「重新生成」时为 true，强制走真生成
    const force = parseResult.data.force === true

    // 脚本来源：
    // - 用户手动编辑过（scriptEdited=true）→ 固定复用 timelineScript，尊重用户改动；
    // - 否则 → 每次按最新规则自动重合并（确保对白/台词、风格等最新逻辑都纳入）。
    let finalScript: string
    // 取舍说明：合并过程中如有分镜丢弃/截断，此字段非 null，非静默回传前端
    let lossNotice: string | null = null

    if (group.scriptEdited && group.timelineScript && group.timelineScript.trim().length > 0) {
      // 用户已编辑脚本，直接使用，跳过自动合并
      finalScript = group.timelineScript
    } else {
      // 自动合并脚本（加载项目全局风格作为前缀，确保单组/链式一致性）
      const projectStyle = await prisma.styleConfig.findUnique({
        where: { projectId: group.project.id },
        include: { template: true },
      })
      const stylePrefix = projectStyle?.template?.promptPrefix
        || projectStyle?.customDescription
        || ''

      const mergeInput: MergeInputShot[] = group.shots.map((s) => ({
        orderIndex: s.orderIndex,
        startTime: s.startTime,
        endTime: s.endTime,
        prompt: s.prompt,
        // 传入对白：merger 会把台词以「角色（说话）："…"」嵌入提示词，
        // generate_audio=true 时 Seedance 据此生成配音（与链式路由一致，修复单组台词丢失）
        dialogue: s.dialogue,
        scene: s.scene,
      }))
      const genDurationForMerge = Math.min(Math.round(group.genDuration), MAX_GROUP_DURATION)
      const timelineScript = mergeTimelineScript(mergeInput, {
        genDuration: genDurationForMerge,
        stylePrefix,
        addNegativeConstraints: true,
      })

      if (!timelineScript.text || timelineScript.text.trim().length === 0) {
        return NextResponse.json(
          { error: '时间轴脚本合并结果为空，无法生成' },
          { status: 400 }
        )
      }

      finalScript = timelineScript.text
      // 取舍说明：合并过程中如有分镜丢弃/截断，以结构化字段非静默回传前端（遵守用户铁律：禁止静默处理）
      lossNotice = timelineScript.lossNotice

      // 合并结果写回 timelineScript 字段
      await prisma.shotGroup.update({
        where: { id: group.id },
        data: { timelineScript: finalScript },
      })
    }

    // 生成时长以分镜组 genDuration 为准，并再次确认不超过 Seedance 15 秒上限
    const durationNum = Math.min(Math.round(group.genDuration), MAX_GROUP_DURATION)

    // === 装配按组参考数据（asset:// 人物锚定 + 无脸场景帧 + 组音频，无 first_frame）===
    // 人物身份由全片唯一 asset:// 锚定资产承载，每组独立引用，逐组单独生成也保持一致。
    const groupRef = await buildGroupGenReference(group.id)

    // 提交给 Seedance 的实际 prompt = 角色引用前缀（图片N中的{角色}）+ 时间轴脚本
    // 注意：characterPrefix 不写回 timelineScript，避免重生成时重复叠加前缀。
    // 声明为 let：余额校验后可能被同场景尾帧承接逻辑追加「承接指令」覆盖（见下方承接块）。
    let seedancePrompt = `${groupRef.characterPrefix}${finalScript}`

    // === scriptHash 幂等去重（Req 4）===
    // 全面放弃 first_frame，幂等键以「用户授权内容」即基础 seedancePrompt（角色前缀 + 脚本）
    // + 时长 + 分辨率计算。注意：同场景尾帧承接（下方）只改写实际提交 Seedance 的 prompt 与
    // referenceImages，不进入此哈希——承接源自前一组持久化尾帧这一外部可变状态，若纳入幂等键，
    // 前一组 force 重生成刷新尾帧会静默改变本组幂等键并触发非预期重生成，违反 Req 3.6 幂等保持与
    // Req 3.8「不级联重生成」。故哈希固定基于承接前的基础内容。
    const scriptHash = computeScriptHash(seedancePrompt, durationNum, resolution)

    // 查询 ShotGroup 现有 scriptHash + genStatus
    // 注意：force=true（用户主动抽卡重生成）时跳过 SUCCEEDED 幂等短路，直接走真生成；
    //       但进行中（QUEUED/GENERATING）的去重保护始终生效，避免重复扣费。
    if (group.scriptHash === scriptHash) {
      const currentStatus = group.genStatus

      // SUCCEEDED：内容未变且非强制重生成时，返回已有成功任务信息（幂等命中，不重复扣费/生成）
      if (currentStatus === 'SUCCEEDED' && !force) {
        const existingJob = await prisma.generationJob.findFirst({
          where: { shotGroupId: group.id, status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
        })
        return NextResponse.json({
          idempotent: true,
          job: {
            id: existingJob?.id,
            status: 'SUCCEEDED',
            genVideoUrl: group.genVideoUrl,
          },
        })
      }

      // QUEUED/GENERATING：返回进行中任务信息（force 也不允许并发重复提交，防止重复扣费）
      if (currentStatus === 'QUEUED' || currentStatus === 'GENERATING') {
        const existingJob = await prisma.generationJob.findFirst({
          where: { shotGroupId: group.id, status: { in: ['QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING'] } },
          orderBy: { createdAt: 'desc' },
        })
        return NextResponse.json({
          idempotent: true,
          job: {
            id: existingJob?.id,
            status: currentStatus,
          },
        })
      }

      // FAILED/CANCELED：清除旧 hash，正常创建新任务
      if (currentStatus === 'FAILED' || currentStatus === 'CANCELED') {
        await prisma.shotGroup.update({
          where: { id: group.id },
          data: { scriptHash: null },
        })
      }
    }

    // 估算积分消耗（按组总时长）
    const costEstimate = estimateGroupCreditCost(durationNum, resolution)

    // 检查余额，不足则在冻结前拒绝（Req 8.2）
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.creditBalance < costEstimate) {
      return NextResponse.json(
        { error: '积分余额不足', required: costEstimate, available: user.creditBalance },
        { status: 400 }
      )
    }

    // 组音频引用：已在 buildGroupReferenceData 中按 Seedance 约束计算（需配合参考图）

    // === Reference Video 无缝衔接（取代旧的同场景尾帧承接）===
    // 无条件查前一组已成功生成的视频 URL，作为 reference_video 传给 Seedance。
    // 不做场景判定——无论同场景/跨场景，模型都能自行理解如何从前段视频自然过渡。
    const referenceImages = groupRef.referenceImages
    const prevGroupVideoUrl = await getPrevGroupVideoUrl(group.project.id, group.groupIndex)
    if (prevGroupVideoUrl) {
      seedancePrompt = `${seedancePrompt}${VIDEO_CONTINUATION_PROMPT_SUFFIX}`
      console.log(
        `[shot-groups/generate] reference_video 衔接：组 ${group.id} 传入前一组视频作衔接参考`
      )
    } else {
      console.log(
        `[shot-groups/generate] 无前组视频（第一组或前组未成功），独立起镜`
      )
    }

    // === 决定是否请求返回尾帧（returnLastFrame，保留向后兼容但不再作为主要衔接机制）===
    // reference_video 方案下尾帧不再是衔接的核心依据，但仍可请求返回以备不时之需。
    // 保守策略：始终请求返回尾帧（开销可忽略），持久化到 ShotGroup.lastFrameUrl。
    const returnLastFrame = true

    // 事务内保证一致性：冻结积分（RESERVE）+ 创建 GenerationJob + 组状态置 QUEUED
    // + 组内全部 Shot 置 QUEUED + 持久化 timelineScript（Req 8.3）
    // 注意：此处采用内联冻结而非调用 reserveCredits，避免事务嵌套冲突，
    // 与单分镜 generate 路由保持一致的组织顺序。
    // 关键积分写：本路由运行于 Next.js 应用进程，整笔「冻结 + 入队」事务经
    // Redis 全局锁【跨进程】串行化，防止 read-modify-write 丢失更新。
    const job = await withCreditLock(() => prisma.$transaction(async (tx) => {
      // 事务内重读余额并二次校验（消除 TOCTOU 并发风险，修复 F）
      const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (freshUser.creditBalance < costEstimate) {
        throw new Error('积分余额不足')
      }
      const newBalance = freshUser.creditBalance - costEstimate
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })

      // 创建 GenerationJob（关联 shotGroupId，shotId 留空；promptSnapshot 为时间轴脚本）
      const newJob = await tx.generationJob.create({
        data: {
          userId,
          projectId: group.project.id,
          shotGroupId: group.id,
          status: 'QUEUED',
          promptSnapshot: seedancePrompt,
          duration: durationNum,
          aspectRatio,
          resolution,
          costEstimate,
        },
      })

      // 创建 RESERVE 流水（关联 jobId）
      await tx.creditLedger.create({
        data: {
          userId,
          jobId: newJob.id,
          action: 'RESERVE',
          amount: -costEstimate,
          balanceAfter: newBalance,
          remark: `分镜组生成冻结 ${costEstimate} 积分`,
        },
      })

      // 持久化 timelineScript 到分镜组并置组状态 QUEUED + 存储 scriptHash
      await tx.shotGroup.update({
        where: { id: group.id },
        data: { genStatus: 'QUEUED', timelineScript: finalScript, scriptHash },
      })

      // 同步组内全部 Shot 状态置 QUEUED
      await tx.shot.updateMany({
        where: { shotGroupId: group.id },
        data: { genStatus: 'QUEUED' },
      })

      return newJob
    }), 'shotGroupReserve')

    // 入队 video-generate：携带 shotGroupId（按组任务，无 shotId）
    // 多模态参考：asset:// 人物锚定 + 场景帧 reference_image + 组音频 reference_audio
    // reference_video 衔接：无条件传入前一组视频 URL（有则传，无则 undefined）
    // returnLastFrame：始终请求返回尾帧（保留向后兼容）
    await videoGenerateQueue.add('video-generate', {
      jobId: job.id,
      shotGroupId: group.id,
      projectId: group.project.id,
      userId,
      prompt: seedancePrompt,
      duration: durationNum,
      aspectRatio,
      resolution,
      referenceImages,
      referenceAudioUrl: groupRef.referenceAudioUrl,
      referenceVideoUrl: prevGroupVideoUrl ?? undefined,
      returnLastFrame,
    })

    return NextResponse.json(
      { job: { id: job.id, status: 'QUEUED', costEstimate }, lossNotice },
      { status: 202 }
    )
  } catch (error) {
    // 事务内余额不足抛出的错误，返回明确 400（而非通用 500）
    if (error instanceof Error && error.message === '积分余额不足') {
      return NextResponse.json({ error: '积分余额不足（并发扣减）' }, { status: 400 })
    }
    console.error('[POST /api/shot-groups/[id]/generate]', error)
    return NextResponse.json({ error: '生成任务创建失败' }, { status: 500 })
  }
}
