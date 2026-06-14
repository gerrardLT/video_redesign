/**
 * 视频生成 Worker
 * 处理 video-generate 队列任务
 */
import { Worker, type Job, UnrecoverableError } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { createSeedanceTask, getSeedanceTaskStatus } from '@/lib/seedance'
import { refundCredits, chargeCreditsTx } from '@/lib/credit-service'
import { setExpiry } from '@/lib/asset-lifecycle-service'
import { uploadFile } from '@/lib/storage'
import { acquireLock, releaseLock, generateLockKey, withCreditLock } from '@/lib/distributed-lock'
import { checkAndConcatProjectSegments } from '@/lib/segment-concat'
import { videoGenerateQueue } from '@/lib/queue'
import { buildGroupGenReference } from '@/lib/group-gen-context'
import { applySameSceneContinuation } from '@/lib/frame-continuity'
import { logger } from '@/lib/logger'
import { writeFile, unlink } from 'fs/promises'
import path from 'path'
import type { ConnectionOptions } from 'bullmq'

interface VideoGenerateJobData {
  jobId: string
  projectId: string
  userId: string
  prompt: string
  duration: number
  aspectRatio: string
  resolution: string
  // 二选一（保持向后兼容）：
  // - shotId 存在 → 单分镜生成（原有流程不变）
  // - shotGroupId 存在 → 分镜组合并生成（按组分支）
  shotId?: string
  shotGroupId?: string
  referenceImages?: string[]
  referenceAudioUrl?: string
  // 显式请求返回尾帧（单组路径使用）：存在同场景后继组时置 true，使本组尾帧被持久化以支撑 单组→单组 承接。
  // 链式路径不设此字段（undefined），由 chainMode + 非最后一组判定，结果与现状相同。
  returnLastFrame?: boolean
  avatarMode?: boolean          // 是否为虚拟角色模式
  avatarReferenceImages?: string[] // 虚拟角色模式的 asset:// URLs + 场景帧 URLs
  // 链式生成参数
  chainMode?: boolean           // 是否为链式生成模式
  chainTotalGroups?: number     // 链式总组数
  chainCurrentIndex?: number    // 当前是第几组（0-based）
}

const connection = redis as unknown as ConnectionOptions

// 轮询间隔 5 秒
const POLL_INTERVAL = 5000
// 最大轮询时间 10 分钟
const MAX_POLL_TIME = 10 * 60 * 1000

// ========================
// 视频回存 OSS 辅助函数（Req 1）
// ========================

/**
 * 验证 MP4 文件有效性
 * - 文件大小 > 0 字节
 * - 前 8 字节包含 ftyp box 标识
 */
function validateMp4File(buffer: Buffer): boolean {
  if (!buffer || buffer.length === 0) return false
  // MP4 ftyp box: 偏移 4-7 字节为 "ftyp"
  if (buffer.length < 8) return false
  const ftypSignature = buffer.subarray(4, 8).toString('ascii')
  return ftypSignature === 'ftyp'
}

/**
 * 下载远程视频并验证有效性
 * - 单次超时 30s，重试 3 次，间隔 2s
 * - 验证文件大小 > 0 且包含有效 MP4 文件头（ftyp box）
 */
async function downloadAndValidateVideo(videoUrl: string, outputPath: string): Promise<void> {
  const maxRetries = 3
  const retryInterval = 2000
  const timeout = 30000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(videoUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 VideoRedesign/1.0' },
      })
      clearTimeout(timer)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      if (!validateMp4File(buffer)) {
        throw new Error('下载的文件不是有效的 MP4 格式')
      }

      await writeFile(outputPath, buffer)
      return
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (attempt < maxRetries) {
        console.warn(`[generate-video] 下载视频第 ${attempt} 次失败（${reason}），${retryInterval / 1000}s 后重试...`)
        await new Promise(resolve => setTimeout(resolve, retryInterval))
      } else {
        throw new Error(`下载视频全部 ${maxRetries} 次尝试失败: ${reason}`)
      }
    }
  }
}

/**
 * 上传生成视频到 OSS 并返回公网 URL
 * - 重试 2 次，间隔 2s
 * - 对象键：generated/{projectId}/{shotGroupId}_{timestamp}.mp4
 */
async function uploadGeneratedVideoToOSS(
  filePath: string,
  projectId: string,
  shotGroupId: string
): Promise<string> {
  const maxRetries = 2
  const retryInterval = 2000
  const ossKey = `generated/${projectId}/${shotGroupId}_${Date.now()}.mp4`

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const ossUrl = await uploadFile(ossKey, filePath)
      return ossUrl
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (attempt <= maxRetries) {
        console.warn(`[generate-video] 上传 OSS 第 ${attempt} 次失败（${reason}），${retryInterval / 1000}s 后重试...`)
        await new Promise(resolve => setTimeout(resolve, retryInterval))
      } else {
        throw new Error(`上传 OSS 全部 ${maxRetries + 1} 次尝试失败: ${reason}`)
      }
    }
  }

  throw new Error('上传 OSS 失败（不应到达此处）')
}

// ========================
// 原子化成功更新（Req 6）
// ========================

/**
 * 生成成功后的原子化更新（单一 Prisma 事务，超时 10s）
 * 在一个事务内完成：
 * 1. ShotGroup.genStatus = SUCCEEDED, genVideoUrl = ossUrl, lastFrameUrl = lastFrameUrl ?? null
 * 2. 组内所有 Shot.genStatus = SUCCEEDED, genVideoUrl = ossUrl
 * 3. GenerationJob.status = SUCCEEDED, resultVideoUrl = ossUrl
 * 4. chargeCreditsTx（统一幂等扣费：existingCharge 幂等 + RESERVE 差额 REFUND）
 *
 * 尾帧持久化（同场景承接）：成功且 Seedance 返回尾帧时把受信尾帧 URL 写入 ShotGroup.lastFrameUrl，
 * 供后续同场景组（链式 / 单组）承接复用；本次无尾帧（未请求或未返回）则写 null，确保持久化尾帧始终
 * 对应当前最新视频内容，避免 force 重生成后残留陈旧尾帧。链式与单组组生成都经此函数，一处写覆盖两路径。
 *
 * 关键积分写（缺陷 11）：整笔成功事务经 Redis 全局锁【跨进程】串行化，与应用进程/其它 Worker
 * 分支的积分写互斥，消除 libSQL/SQLite 并发写锁竞争与读-改-写丢失更新（锁内复用 db-retry 兜底）。
 */
async function atomicSuccessUpdate(params: {
  jobId: string
  shotGroupId: string
  userId: string
  projectId: string
  ossVideoUrl: string
  costEstimate: number
  lastFrameUrl?: string
}): Promise<void> {
  const { jobId, shotGroupId, userId, ossVideoUrl, costEstimate, lastFrameUrl } = params
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await withCreditLock(() => prisma.$transaction(async (tx) => {
        // 1. 更新 ShotGroup（持久化受信尾帧；无尾帧写 null 覆盖陈旧值）
        await tx.shotGroup.update({
          where: { id: shotGroupId },
          data: { genStatus: 'SUCCEEDED', genVideoUrl: ossVideoUrl, lastFrameUrl: lastFrameUrl ?? null },
        })

        // 2. 更新组内所有 Shot
        await tx.shot.updateMany({
          where: { shotGroupId },
          data: { genStatus: 'SUCCEEDED', genVideoUrl: ossVideoUrl },
        })

        // 3. 更新 GenerationJob
        await tx.generationJob.update({
          where: { id: jobId },
          data: { status: 'SUCCEEDED', resultVideoUrl: ossVideoUrl },
        })

        // 4. 幂等扣费：收敛为统一的 chargeCreditsTx（existingCharge 幂等 + RESERVE 差额 REFUND）
        await chargeCreditsTx(tx, { userId, jobId, actualAmount: costEstimate })
      }, { timeout: 10000 }), 'groupChargeSuccess')

      return // 事务成功
    } catch (txError: unknown) {
      const reason = txError instanceof Error ? txError.message : String(txError)
      if (attempt < maxRetries) {
        logger.error(`原子化事务第 ${attempt} 次失败，重试中`, { jobId, shotGroupId, reason })
        await new Promise(resolve => setTimeout(resolve, 1000))
      } else {
        // 3 次重试仍失败 → FAILED + 退还积分
        logger.error(`原子化事务 ${maxRetries} 次全部失败`, { jobId, shotGroupId, reason })
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorCode: 'TX_FAILED', errorMessage: reason },
        }).catch(() => {})
        await prisma.shotGroup.update({
          where: { id: shotGroupId },
          data: { genStatus: 'FAILED' },
        }).catch(() => {})
        await prisma.shot.updateMany({
          where: { shotGroupId },
          data: { genStatus: 'FAILED' },
        }).catch(() => {})
        await refundCredits(userId, jobId, costEstimate).catch(() => {})
        throw new Error(`原子化事务全部重试失败: ${reason}`)
      }
    }
  }
}

async function processVideoGenerate(job: Job<VideoGenerateJobData>) {
  // 项目级生成（无 shotGroupId）：直接走通用生成逻辑
  if (!job.data.shotGroupId) {
    return processProjectSegmentGenerate(job)
  }
  return processGroupVideoGenerate(job)
}

/**
 * 项目级分段生成（无 ShotGroup 关联）
 * 生成逻辑与 processGroupVideoGenerate 相同（Seedance 调用 + 回存 OSS + 原子扣费），
 * 但不操作 ShotGroup 状态，仅更新 GenerationJob。
 */
async function processProjectSegmentGenerate(job: Job<VideoGenerateJobData>) {
  const { jobId, userId, prompt, duration, aspectRatio, resolution, projectId } = job.data

  // 使用 jobId 作为锁 key（项目级生成用 jobId 隔离并发）
  const lockKey = generateLockKey(jobId)
  const lockValue = jobId
  const lockAcquired = await acquireLock(lockKey, lockValue)

  if (!lockAcquired) {
    logger.info('分布式锁获取失败，跳过项目级分段任务', { jobId, projectId, lockKey })
    return
  }

  try {
    // 查询 GenerationJob 获取 costEstimate
    const genJob = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { costEstimate: true, status: true },
    })
    if (!genJob) {
      throw new UnrecoverableError(`GenerationJob ${jobId} 不存在`)
    }
    if (genJob.status === 'SUCCEEDED') {
      logger.info('项目级分段任务已完成（幂等），跳过', { jobId })
      return
    }
    const costEstimate = genJob.costEstimate ?? 0

    // 更新 GenerationJob 状态为 GENERATING
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'GENERATING' },
    })

    // 调用 Seedance 生成（first_frame 已废弃，统一走文本 + asset:// 多模态参考）
    const { taskId } = await createSeedanceTask({
      prompt,
      duration,
      aspectRatio,
      resolution,
    })

    // 轮询 Seedance 结果
    const startTime = Date.now()
    let resultVideoUrl: string | null = null

    while (Date.now() - startTime < MAX_POLL_TIME) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
      const status = await getSeedanceTaskStatus(taskId).catch((pollErr) => {
        const reason = pollErr instanceof Error
          ? `${pollErr.message}${pollErr.cause ? ` (cause: ${pollErr.cause})` : ''}`
          : String(pollErr)
        console.warn(`[generate-video] 轮询状态网络异常（继续重试）: ${reason}`)
        return null
      })

      if (!status) continue

      if (status.status === 'succeeded' && status.videoUrl) {
        resultVideoUrl = status.videoUrl
        break
      }
      if (status.status === 'failed') {
        throw new Error(`Seedance 生成失败: ${status.error || '未知错误'}`)
      }
    }

    if (!resultVideoUrl) {
      throw new Error('生成超时：10 分钟内未获得结果')
    }

    // 下载视频并回存到 OSS
    const tempPath = path.join(process.cwd(), 'public', 'uploads', 'temp', `gen_${jobId}_${Date.now()}.mp4`)
    const downloadResp = await fetch(resultVideoUrl)
    if (!downloadResp.ok) {
      throw new Error(`下载 Seedance 视频失败: HTTP ${downloadResp.status}`)
    }
    const videoBuffer = Buffer.from(await downloadResp.arrayBuffer())
    await writeFile(tempPath, videoBuffer)

    const ossKey = `generated/${projectId}/${jobId}.mp4`
    const ossUrl = await uploadFile(ossKey, tempPath)

    // 清理临时文件
    await unlink(tempPath).catch(() => {})

    // 原子化扣费 + 更新 GenerationJob
    // 关键积分写（缺陷 11）：整笔事务经 Redis 全局锁【跨进程】串行化，与应用进程/其它 Worker
    // 分支的积分写互斥，消除 libSQL/SQLite 并发写锁竞争与读-改-写丢失更新（锁内复用 db-retry 兜底）。
    await withCreditLock(() => prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'SUCCEEDED',
          resultVideoUrl: ossUrl,
        },
      })

      // 扣费：收敛为统一的 chargeCreditsTx（existingCharge 幂等 + RESERVE 差额 REFUND，
      // 真正退还多冻结差额并保证扣费恰好一次，与按组路径 atomicSuccessUpdate 行为一致）
      await chargeCreditsTx(tx, { userId, jobId, actualAmount: costEstimate })
    }), 'segmentChargeSuccess')

    // 设置过期
    const asset = await prisma.asset.create({
      data: {
        projectId,
        userId,
        type: 'AI_GENERATED',
        url: ossUrl,
        fileName: `segment-${jobId}.mp4`,
        fileSize: videoBuffer.length,
        status: 'UPLOADED',
        sortOrder: 0,
      },
    })
    await setExpiry(asset.id, 14)

    logger.info('项目级分段生成成功', { jobId, projectId, ossUrl })

    // 检查是否全部段完成，触发拼合
    await checkAndConcatProjectSegments(projectId)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('项目级分段生成失败', { jobId, projectId, error: errorMessage })

    // 标记 GenerationJob 为 FAILED
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorMessage: errorMessage.substring(0, 500) },
    }).catch(() => {})

    // 退还积分
    const genJob = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { costEstimate: true },
    })
    if (genJob?.costEstimate) {
      await refundCredits(userId, jobId, genJob.costEstimate).catch(() => {})
    }

    // 检查是否有段失败需要标记项目
    await checkAndConcatProjectSegments(projectId)

    if (
      errorMessage.includes('(400)') ||
      errorMessage.includes('InvalidParameter') ||
      errorMessage.includes('生成超时') ||
      errorMessage.includes('Seedance 生成失败')
    ) {
      throw new UnrecoverableError(errorMessage)
    }
    throw error
  } finally {
    await releaseLock(lockKey, lockValue).catch(() => {})
  }
}

/**
 * 分镜组合并生成（按组分支）
 * 一个分镜组对应一次 Seedance 调用与一段合并视频，
 * 生成成功/失败时需同步组内全部 Shot 的状态与视频地址。
 *
 * 集成：分布式锁（Req 5）+ 视频回存 OSS（Req 1）+ 原子化扣费（Req 6）
 */
async function processGroupVideoGenerate(job: Job<VideoGenerateJobData>) {
  const { jobId, shotGroupId, userId, prompt, duration, aspectRatio, resolution, projectId } = job.data

  if (!shotGroupId) {
    throw new Error('按组生成任务缺少 shotGroupId')
  }

  // === 分布式锁防并发（Req 5）===
  const lockKey = generateLockKey(shotGroupId)
  const lockValue = jobId
  const lockAcquired = await acquireLock(lockKey, lockValue)

  if (!lockAcquired) {
    // 获取锁失败：另一个 Worker 正在处理，标记任务完成（不重试）
    logger.info('分布式锁获取失败，跳过任务', { jobId, shotGroupId, lockKey })
    return
  }

  try {
    // 二次检查 genStatus：获取锁后确认是否已完成
    const currentGroup = await prisma.shotGroup.findUnique({ where: { id: shotGroupId } })
    if (currentGroup && (currentGroup.genStatus === 'SUCCEEDED' || currentGroup.genStatus === 'GENERATING')) {
      logger.info('二次检查发现任务已完成/进行中，释放锁并跳过', { jobId, shotGroupId, genStatus: currentGroup.genStatus })
      await releaseLock(lockKey, lockValue).catch(() => {})
      return
    }

    // === 重试恢复：检查是否已有 seedanceTaskId（上一次尝试可能已创建任务但轮询超时）===
    const existingJob = await prisma.generationJob.findUnique({ where: { id: jobId } })
    let taskId: string

    if (existingJob?.seedanceTaskId) {
      // 上一次重试已创建过 Seedance 任务，直接恢复轮询（不重复创建、不浪费 API 费用）
      taskId = existingJob.seedanceTaskId
      logger.info('恢复轮询已有 Seedance 任务（重试场景）', { jobId, shotGroupId, taskId })

      // 更新状态为 GENERATING（可能上次超时后被标记为 FAILED）
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'GENERATING' },
      })
    } else {
      // 首次执行：创建新的 Seedance 任务
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'SUBMITTED' },
      })

      const result = await createSeedanceTask({
        prompt,
        duration,
        aspectRatio,
        resolution,
        referenceImages: job.data.referenceImages,
        referenceAudioUrl: job.data.referenceAudioUrl,
        // 请求返回尾帧的两条来源：
        // - 单组路径：路由显式置 job.data.returnLastFrame===true（存在同场景后继组时），用于持久化本组尾帧；
        // - 链式路径：job.data.returnLastFrame 为 undefined，沿用「chainMode 且非最后一组」判定，结果与现状相同。
        returnLastFrame:
          job.data.returnLastFrame === true ||
          (job.data.chainMode && (job.data.chainCurrentIndex ?? 0) < ((job.data.chainTotalGroups ?? 1) - 1)),
      })
      taskId = result.taskId

      // 更新状态：GENERATING + seedanceTaskId
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'GENERATING', seedanceTaskId: taskId },
      })
    }

    // 分镜组置 GENERATING，并同步组内全部 Shot 置 GENERATING
    await prisma.shotGroup.update({
      where: { id: shotGroupId },
      data: { genStatus: 'GENERATING' },
    })
    await prisma.shot.updateMany({
      where: { shotGroupId },
      data: { genStatus: 'GENERATING' },
    })

    // 轮询 Seedance 任务状态
    const startTime = Date.now()
    let videoUrl: string | undefined
    let lastFrameUrl: string | undefined
    let tokenUsage: { completionTokens: number; totalTokens: number } | undefined

    while (Date.now() - startTime < MAX_POLL_TIME) {
      const status = await getSeedanceTaskStatus(taskId).catch((pollErr) => {
        // 网络抖动容忍：打印完整错误（含 cause）但不中断轮询
        const reason = pollErr instanceof Error
          ? `${pollErr.message}${pollErr.cause ? ` (cause: ${pollErr.cause})` : ''}`
          : String(pollErr)
        console.warn(`[generate-video] 轮询状态网络异常（继续重试）: ${reason}`)
        return null
      })

      // 网络异常时跳过本轮，等下次轮询
      if (!status) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
        continue
      }

      if (status.status === 'succeeded') {
        videoUrl = status.videoUrl
        lastFrameUrl = status.lastFrameUrl
        tokenUsage = status.tokenUsage
        break
      }

      if (status.status === 'failed') {
        throw new Error(
          `Seedance 生成失败: ${status.error?.code || 'UNKNOWN'} - ${status.error?.message || '未知错误'}`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }

    if (!videoUrl) {
      throw new Error('生成超时：超过 10 分钟未完成')
    }

    if (tokenUsage) {
      console.log(`[generate-video] 组任务 ${jobId} Token 消耗: ${tokenUsage.completionTokens} tokens`)
    }

    // === 视频回存 OSS（Req 1）===
    const tempVideoPath = path.join(process.cwd(), 'public', 'uploads', 'temp', `gen_${jobId}_${Date.now()}.mp4`)
    try {
      // 下载并验证
      await downloadAndValidateVideo(videoUrl, tempVideoPath)

      // 上传到 OSS
      const ossVideoUrl = await uploadGeneratedVideoToOSS(tempVideoPath, projectId, shotGroupId)

      // === 原子化成功更新（Req 6）===
      const genJob = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } })
      const actualCost = genJob.costEstimate || 0

      await atomicSuccessUpdate({
        jobId,
        shotGroupId,
        userId,
        projectId,
        ossVideoUrl,
        costEstimate: actualCost,
        // 透传轮询得到的受信尾帧（链式与单组共用此函数，一处持久化覆盖两路径）
        lastFrameUrl,
      })

      // 创建 AI_GENERATED 类型 Asset 并设置 14 天过期
      try {
        const asset = await prisma.asset.create({
          data: {
            projectId,
            userId,
            type: 'AI_GENERATED',
            url: ossVideoUrl,
            fileName: `group-${shotGroupId}-generated.mp4`,
            status: 'UPLOADED',
            sortOrder: 0,
          },
        })
        await setExpiry(asset.id, 14)
      } catch (expiryError) {
        logger.error('分镜组视频生成后设置资产过期时间失败', {
          jobId,
          shotGroupId,
          error: expiryError instanceof Error ? expiryError.message : String(expiryError),
        })
      }

      // === 链式生成续接：触发下一组 ===
      if (job.data.chainMode) {
        await triggerNextChainGroup({
          projectId,
          userId,
          currentGroupId: shotGroupId,
          currentIndex: job.data.chainCurrentIndex ?? 0,
          totalGroups: job.data.chainTotalGroups ?? 1,
          lastFrameUrl,
          aspectRatio,
          resolution,
        })
      }
    } finally {
      // 清理临时文件
      await unlink(tempVideoPath).catch(() => {})
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    const errorCode = 'GENERATION_ERROR'

    try {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorCode, errorMessage },
      })

      await prisma.shotGroup.update({
        where: { id: shotGroupId },
        data: { genStatus: 'FAILED' },
      })

      await prisma.shot.updateMany({
        where: { shotGroupId },
        data: { genStatus: 'FAILED' },
      })
    } catch (updateError) {
      logger.error('分镜组生成失败且状态更新本身失败', {
        jobId,
        shotGroupId,
        errorCode,
        errorMessage,
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }

    // 返还冻结积分
    const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } })
    if (genJob?.costEstimate) {
      await refundCredits(userId, jobId, genJob.costEstimate)
    }

    // 判断是否为最终失败：确定性错误（不可重试）或已耗尽 BullMQ 重试次数
    const isDeterministic =
      errorMessage.includes('(400)') ||
      errorMessage.includes('InvalidParameter') ||
      errorMessage.includes('生成超时') ||
      errorMessage.includes('Seedance 生成失败')
    const attemptsLimit = job.opts.attempts ?? 1
    const isFinalFailure = isDeterministic || job.attemptsMade + 1 >= attemptsLimit

    // 链式模式且确为最终失败时整体收口：退还所有下游未运行组的冻结积分并置项目 FAILED，
    // 避免下游 QUEUED 组的积分永久锁死、项目永久卡在 GENERATING（修复 A/D）。
    // 仅在最终失败时触发，避免瞬时错误重试场景下误杀本可成功的下游组。
    if (job.data.chainMode && isFinalFailure) {
      await failProjectChain(
        projectId,
        userId,
        `链式生成在分镜组 ${shotGroupId} 失败：${errorMessage}`,
        jobId // 当前组已自行退款，跳过避免重复
      )
    }

    // 对确定性失败使用 UnrecoverableError 阻止 BullMQ 重试
    // 超时、参数错误、Seedance 明确拒绝 → 重试无意义
    if (
      errorMessage.includes('(400)') ||
      errorMessage.includes('InvalidParameter') ||
      errorMessage.includes('生成超时') ||
      errorMessage.includes('Seedance 生成失败')
    ) {
      throw new UnrecoverableError(errorMessage)
    }
    throw error
  } finally {
    // 安全释放分布式锁（验证锁值一致）
    const released = await releaseLock(lockKey, lockValue).catch(() => false)
    if (!released) {
      logger.warn('释放分布式锁失败或锁已不属于当前持有者', { jobId, shotGroupId, lockKey })
    }
  }
}
/**
 * 链式生成续接：当前组完成后触发下一组
 *
 * 核心一致性机制：人物身份由全片唯一 asset:// 锚定资产承载，每组生成时独立作 reference_image 注入，
 * 跨组保持人物一致。镜头连贯性：同场景的相邻组，把上一组尾帧作为额外 reference_image 并用提示词
 * 指定为起始承接画面（软承接，非 role=first_frame，避免与人物锚定互斥）；跨场景则不承接、独立起镜。
 *
 * 续接规则（修复链式断裂与下游冻结锁死）：
 * - 跳过已 SUCCEEDED 的组（resume 场景：项目曾部分成功后重新生成），继续找下一个待生成组；
 * - 找到下一个有 QUEUED 任务的组 → 入队；
 * - 后续再无待生成组 → 触发全项目合并；
 * - 出现异常断裂（下一组应存在却查不到任务等）→ 整体失败兜底（退款下游 + 项目置 FAILED），
 *   绝不静默 return 导致项目卡死、积分锁死。
 */
async function triggerNextChainGroup(params: {
  projectId: string
  userId: string
  currentGroupId: string
  currentIndex: number
  totalGroups: number
  lastFrameUrl?: string
  aspectRatio: string
  resolution: string
}): Promise<void> {
  const { projectId, userId, currentIndex, currentGroupId, lastFrameUrl, aspectRatio, resolution } = params

  // 查找 groupIndex 大于当前组、且仍有待生成（QUEUED）任务的下一个分镜组（按 groupIndex 升序）
  // 已 SUCCEEDED 的组没有 QUEUED 任务，会被自然跳过。
  const pendingGroups = await prisma.shotGroup.findMany({
    where: {
      projectId,
      groupIndex: { gt: currentIndex },
      genStatus: { in: ['PENDING', 'QUEUED'] },
    },
    orderBy: { groupIndex: 'asc' },
  })

  // 在候选组中找到第一个确实存在 QUEUED GenerationJob 的组
  let nextGroup: (typeof pendingGroups)[number] | null = null
  let nextJob: Awaited<ReturnType<typeof prisma.generationJob.findFirst>> = null
  for (const candidate of pendingGroups) {
    const job = await prisma.generationJob.findFirst({
      where: { shotGroupId: candidate.id, status: 'QUEUED' },
      orderBy: { createdAt: 'desc' },
    })
    if (job) {
      nextGroup = candidate
      nextJob = job
      break
    }
  }

  // 无更多待生成组 → 全部完成，触发合并
  if (!nextGroup || !nextJob) {
    logger.info('链式生成无更多待生成组，触发合并', { projectId, currentIndex })
    await triggerChainMerge(projectId, userId)
    return
  }

  // 入队下一组：多模态参考模式——人物身份由 asset:// 锚定资产承载，每组独立装配参考图（promptSnapshot 已 baked 角色引用前缀）。
  const nextRef = await buildGroupGenReference(nextGroup.id)
  let referenceImages = nextRef.referenceImages
  let nextPrompt = nextJob.promptSnapshot || ''

  // 链式镜头承接（同场景软承接）：调用共享函数 applySameSceneContinuation，与单组路径共用同一实现，
  // 保证两路径产出完全一致。函数内部判定上一组末镜 scene 与下一组首镜 scene 是否同场景，
  // 同场景且参考图未满 9 张时把上一组受信尾帧（Seedance 产物，作 reference_image 不触发人脸审核）
  // 追加为额外参考图，并以提示词指定其为本组「起始承接画面」（软承接，非 role=first_frame）；
  // lastFrameUrl 为空 / 已满 9 张 / 跨场景或 scene 缺失则不承接、下一组独立起镜（保守，宁跳变不糊连）。
  const continuation = await applySameSceneContinuation({
    prevGroupId: currentGroupId,
    currentGroupId: nextGroup.id,
    lastFrameUrl,
    referenceImages,
    prompt: nextPrompt,
  })
  referenceImages = continuation.referenceImages
  nextPrompt = continuation.prompt
  if (continuation.applied) {
    logger.info('链式续接：同场景，启用上一组尾帧作承接参考', {
      projectId,
      nextGroupId: nextGroup.id,
      contIndex: continuation.contIndex,
    })
  } else {
    logger.info('链式续接：不承接尾帧（无受信尾帧 / 参考图已满 / 跨场景或 scene 缺失），下一组独立起镜', {
      projectId,
      nextGroupId: nextGroup.id,
    })
  }

  await videoGenerateQueue.add('video-generate', {
    jobId: nextJob.id,
    shotGroupId: nextGroup.id,
    projectId,
    userId,
    prompt: nextPrompt,
    duration: nextJob.duration,
    aspectRatio,
    resolution,
    // 多模态参考：asset:// 人物锚定 + 场景帧 + 组音频（同场景时末尾含上一组尾帧承接参考）
    referenceImages,
    referenceAudioUrl: nextRef.referenceAudioUrl,
    // 链式参数传递：currentIndex 用下一组的真实 groupIndex（非数组下标，兼容跳过已成功组）
    chainMode: true,
    chainTotalGroups: params.totalGroups,
    chainCurrentIndex: nextGroup.groupIndex,
  })

  logger.info('链式续接：已入队下一组', {
    projectId,
    nextGroupIndex: nextGroup.groupIndex,
    nextGroupId: nextGroup.id,
    nextJobId: nextJob.id,
    referenceImageCount: nextRef.referenceImages.length,
  })
}

/**
 * 链式整体失败兜底：将项目所有非终态 GenerationJob 退款并标记 FAILED，项目置 FAILED。
 *
 * 用途（修复 A/D）：链式中任意组失败、或链式续接异常断裂时调用，
 * 确保未运行的下游组冻结积分被退还、项目不会永久卡在 GENERATING。
 *
 * 幂等：refundCredits 按 jobId 幂等；已 SUCCEEDED 的组与已退款的 Job 不受影响。
 *
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param reason 失败原因（写入项目 errorMsg）
 * @param excludeJobId 可选：跳过的 jobId（当前组失败路径已自行退款，避免重复处理日志噪音）
 */
export async function failProjectChain(
  projectId: string,
  userId: string,
  reason: string,
  excludeJobId?: string
): Promise<void> {
  try {
    // 查找项目下所有非终态 Job（尚未运行/进行中的下游组）
    const pendingJobs = await prisma.generationJob.findMany({
      where: {
        projectId,
        status: { in: ['QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING'] },
      },
      select: { id: true, costEstimate: true, shotGroupId: true },
    })

    for (const job of pendingJobs) {
      if (job.id === excludeJobId) continue

      // 退还该 Job 冻结的积分（幂等）
      if (job.costEstimate) {
        await refundCredits(userId, job.id, job.costEstimate).catch((err) => {
          logger.error('链式失败兜底：退款失败', {
            projectId,
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }

      // 标记 Job 失败
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorCode: 'CHAIN_FAILED', errorMessage: reason },
      }).catch(() => {})

      // 同步标记其分镜组与组内分镜失败
      if (job.shotGroupId) {
        await prisma.shotGroup.update({
          where: { id: job.shotGroupId },
          data: { genStatus: 'FAILED' },
        }).catch(() => {})
        await prisma.shot.updateMany({
          where: { shotGroupId: job.shotGroupId },
          data: { genStatus: 'FAILED' },
        }).catch(() => {})
      }
    }

    // 项目状态回退：如果项目已有分镜组数据（解析已成功），回退到 EDITABLE 让用户可重新生成；
    // 仅在真的没有分镜组数据时（解析阶段就失败了）才置 FAILED。
    const hasShotGroups = await prisma.shotGroup.count({ where: { projectId } })
    const targetStatus = hasShotGroups > 0 ? 'EDITABLE' : 'FAILED'

    await prisma.project.update({
      where: { id: projectId },
      data: { status: targetStatus, errorMsg: reason.substring(0, 500) },
    }).catch(() => {})

    logger.info('链式失败兜底完成', { projectId, refundedJobs: pendingJobs.length, reason })
  } catch (err) {
    logger.error('链式失败兜底执行异常', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 链式生成全部完成后，触发全项目视频合并
 */
async function triggerChainMerge(projectId: string, userId: string): Promise<void> {
  try {
    // 查询所有分镜组（按 groupIndex 排序），收集生成的视频 URL
    const groups = await prisma.shotGroup.findMany({
      where: { projectId, genStatus: 'SUCCEEDED' },
      orderBy: { groupIndex: 'asc' },
      select: { groupIndex: true, genVideoUrl: true, genDuration: true, startTime: true, endTime: true },
    })

    if (groups.length === 0) {
      logger.error('链式合并触发但无成功的分镜组', { projectId })
      await failProjectChain(projectId, userId, '链式合并失败：无成功生成的分镜组')
      return
    }

    const shotVideoUrls = groups
      .filter((g) => g.genVideoUrl)
      .map((g) => ({
        orderIndex: g.groupIndex,
        videoUrl: g.genVideoUrl!,
        targetDuration: g.endTime - g.startTime,
        genDuration: g.genDuration,
      }))

    if (shotVideoUrls.length === 0) {
      logger.error('链式合并无可用视频 URL', { projectId })
      await failProjectChain(projectId, userId, '链式合并失败：无可用的分镜组视频 URL')
      return
    }

    // 获取项目画幅信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { aspectRatio: true },
    })

    // 入队 video-merge
    const { videoMergeQueue } = await import('@/lib/queue')
    await videoMergeQueue.add('video-merge', {
      projectId,
      userId,
      shotVideoUrls,
      outputAspectRatio: project?.aspectRatio || '16:9',
      outputResolution: '720p',
    })

    logger.info('链式合并已入队', { projectId, segmentCount: shotVideoUrls.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('触发链式合并失败', { projectId, error: msg })

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'FAILED', errorMsg: `合并触发失败: ${msg}` },
    }).catch(() => {})
  }
}

export const generateVideoWorker = new Worker(
  'video-generate',
  processVideoGenerate,
  {
    connection,
    concurrency: 5,
    // 单任务最长轮询 MAX_POLL_TIME（10min），锁时长必须 ≥ 该值，否则任务执行期间锁过期会被
    // 误判 stalled 而重复派发（缺陷 12）。留 1min 余量设为 11min。
    lockDuration: MAX_POLL_TIME + 60 * 1000,
    // stalled 扫描周期与锁时长对齐（同为 11min），避免在正常轮询窗口内误判 stalled。
    stalledInterval: MAX_POLL_TIME + 60 * 1000,
    // 最多允许一次 stalled 重入，超过即判失败，防止长任务被无限重复派发。
    maxStalledCount: 1,
  }
)

generateVideoWorker.on('completed', (job) => {
  console.log(`[generate-video] Job ${job.id} 完成`)

  // 项目级分段生成完成后，检查是否全部段已完成并触发拼合
  const data = job.data as VideoGenerateJobData
  if (!data.shotGroupId && !data.shotId && data.projectId) {
    checkAndConcatProjectSegments(data.projectId).catch(err => {
      logger.error('检查项目分段拼合时出错', {
        projectId: data.projectId,
        jobId: data.jobId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
})

generateVideoWorker.on('failed', (job, err) => {
  console.error(`[generate-video] Job ${job?.id} 失败:`, err.message)

  // 项目级分段生成失败后，检查是否需要标记项目为 FAILED
  if (job) {
    const data = job.data as VideoGenerateJobData
    if (!data.shotGroupId && !data.shotId && data.projectId) {
      checkAndConcatProjectSegments(data.projectId).catch(concatErr => {
        logger.error('检查项目分段拼合状态时出错（失败触发）', {
          projectId: data.projectId,
          jobId: data.jobId,
          error: concatErr instanceof Error ? concatErr.message : String(concatErr),
        })
      })
    }
  }
})
