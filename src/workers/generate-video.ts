/**
 * 视频生成 Worker
 * 处理 video-generate 队列任务
 *
 * 生成成功后流程：
 * 1. 下载生成视频到本地临时文件
 * 2. 从生成视频抽取封面帧（ffmpeg，0.1s）并上传 OSS → genCoverUrl
 * 3. 上传生成视频到 OSS → ossVideoUrl
 * 4. atomicSuccessUpdate 事务内一并写入 genStatus/genVideoUrl/genCoverUrl/lastFrameUrl
 * 5. 创建版本历史记录（best-effort，失败仅记录日志不回滚生成结果）
 */
import { Worker, type Job, UnrecoverableError } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { createSeedanceTask, getSeedanceTaskStatus } from '@/lib/video/seedance'
import { createHappyHorseWorkspaceTask, getHappyHorseTaskStatus as getHHWorkspaceStatus } from '@/lib/shared/happyhorse-workspace'
import { refundCredits, chargeCreditsTx } from '@/lib/shared/credit-service'
import { setExpiry } from '@/lib/shared/asset-lifecycle-service'
import { uploadFile } from '@/lib/shared/storage'
import { acquireLock, releaseLock, generateLockKey, withCreditLock } from '@/lib/shared/distributed-lock'
import { checkAndConcatProjectSegments } from '@/lib/video/segment-concat'
import { videoGenerateQueue } from '@/lib/shared/queue'
import { buildGroupGenReference } from '@/lib/video/group-gen-context'
import { applySameSceneContinuation } from '@/lib/video/frame-continuity'
import { logger } from '@/lib/shared/logger'
import { publishStateChange, publishCompleted, publishFailed, publishChainProgress } from '@/lib/shared/progress-publisher'
import { createVersion } from '@/lib/video/version-history-service'
import { writeFile, unlink, mkdir } from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ConnectionOptions } from 'bullmq'

const execFileAsync = promisify(execFile)

interface VideoGenerateJobData {
  jobId: string
  projectId: string
  userId: string
  prompt: string
  duration: number
  aspectRatio: string
  resolution: string
  // 工作台模式标记
  mode?: 'workspace'
  workspaceData?: {
    assetUrls: string[]
    assetTypes: Record<string, 'image' | 'video' | 'audio'>
  }
  // 二选一（保持向后兼容）：
  // - shotId 存在 → 单分镜生成（原有流程不变）
  // - shotGroupId 存在 → 分镜组合并生成（按组分支）
  shotId?: string
  shotGroupId?: string
  referenceImages?: string[]
  referenceAudioUrl?: string
  referenceVideoUrl?: string  // 前一组生成视频 OSS URL，用于 reference_video 无缝衔接
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

  // 确保输出目录存在（生产镜像未预置 public/uploads/temp，且 .dockerignore 已排除该目录，
  // 不能依赖其他 worker 顺手创建——写入前自建，与 parse/merge/upscale/download 各 worker 行为一致）
  await mkdir(path.dirname(outputPath), { recursive: true })

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
// 生成视频封面抽帧（Bug 2 修复）
// ========================

/**
 * 从生成视频抽取封面帧并上传 OSS
 * - 使用 ffmpeg 抽取第 0.1s 帧，JPEG 格式，等比缩放（宽度限 720px）
 * - 上传 OSS 对象键：gencover/{projectId}/{shotGroupId}.jpg
 * - 失败时记录真实错误并返回 undefined（不阻塞主流程、不写伪造 URL）
 */
async function extractAndUploadGenCover(
  tempVideoPath: string,
  projectId: string,
  shotGroupId: string
): Promise<string | undefined> {
  const coverPath = path.join(
    path.dirname(tempVideoPath),
    `gencover_${shotGroupId}_${Date.now()}.jpg`
  )

  try {
    // ffmpeg 从第 0.1s 抽取一帧，等比缩放宽度 720px（高度自适应）
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', '0.1',
      '-i', tempVideoPath,
      '-frames:v', '1',
      '-vf', 'scale=720:-2',
      '-q:v', '2',
      coverPath,
    ], { timeout: 15000 })

    // 上传到 OSS
    const ossKey = `gencover/${projectId}/${shotGroupId}.jpg`
    const genCoverUrl = await uploadFile(ossKey, coverPath)
    return genCoverUrl
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('生成视频封面抽帧失败', { shotGroupId, projectId, error: reason })
    return undefined
  } finally {
    // 清理临时封面文件
    await unlink(coverPath).catch(() => {})
  }
}

// ========================
// 原子化成功更新（Req 6）
// ========================

/**
 * 生成成功后的原子化更新（P2 优化：拆分积分锁与状态写入）
 *
 * 拆为两步：
 *   Step 1: 在 withCreditLock 内仅执行 chargeCreditsTx（积分操作，亚秒级）
 *   Step 2: 在锁外执行状态更新（ShotGroup/Shot/GenerationJob → SUCCEEDED）
 *
 * 好处：积分锁持有时间从 ~1-2s 压缩到 <100ms，5 个并发生成任务在锁上排队等待总时间大幅缩短，
 *       消除极端情况下的 30s 等待超时风险。
 *
 * 风险容忍：扣费成功但状态更新失败时，组仍为 GENERATING。这是可接受的——
 *   - chargeCreditsTx 内置幂等（existingCharge 检查），后续重试不会重复扣费
 *   - 看门狗 Worker 会检测卡死的 GENERATING 任务并修复状态
 *   - 用户视角视频已生成成功（OSS 已有文件），仅卡片状态需刷新
 *
 * 封面与尾帧持久化：genCoverUrl/lastFrameUrl 在 Step 2 状态更新事务中写入。
 */
async function atomicSuccessUpdate(params: {
  jobId: string
  shotGroupId: string
  userId: string
  projectId: string
  ossVideoUrl: string
  costEstimate: number
  lastFrameUrl?: string
  genCoverUrl?: string
}): Promise<void> {
  const { jobId, shotGroupId, userId, projectId, ossVideoUrl, costEstimate, lastFrameUrl, genCoverUrl } = params

  // Step 1: 积分锁内仅做扣费（亚秒级，最大化锁吞吐）
  await withCreditLock(() => prisma.$transaction(async (tx) => {
    await chargeCreditsTx(tx, { userId, jobId, actualAmount: costEstimate })
  }, { timeout: 10000 }), 'groupCharge')

  // Step 2: 锁外状态更新（不竞争积分锁，降低锁排队时间）
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        // 1. 更新 ShotGroup（持久化受信尾帧；生成封面；无尾帧写 null 覆盖陈旧值）
        await tx.shotGroup.update({
          where: { id: shotGroupId },
          data: {
            genStatus: 'SUCCEEDED',
            genVideoUrl: ossVideoUrl,
            lastFrameUrl: lastFrameUrl ?? null,
            ...(genCoverUrl !== undefined ? { genCoverUrl } : {}),
          },
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
      }, { timeout: 10000 })

      return // 状态更新成功
    } catch (txError: unknown) {
      const reason = txError instanceof Error ? txError.message : String(txError)
      if (attempt < maxRetries) {
        logger.error(`状态更新第 ${attempt} 次失败，重试中`, { jobId, shotGroupId, reason })
        await new Promise(resolve => setTimeout(resolve, 1000))
      } else {
        // 3 次重试仍失败 → 积分已扣但状态未更新
        // 不退款（视频已生成成功，用户可使用），由看门狗修复状态
        logger.error(`状态更新 ${maxRetries} 次全部失败（积分已扣，视频已生成，等待看门狗修复状态）`, {
          jobId, shotGroupId, reason,
        })
        // 尝试单独更新 GenerationJob 标记为 SUCCEEDED（最低限度保证 Job 状态正确）
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { status: 'SUCCEEDED', resultVideoUrl: ossVideoUrl },
        }).catch(() => {})
      }
    }
  }
}

async function processVideoGenerate(job: Job<VideoGenerateJobData>) {
  // 工作台模式分支
  if (job.data.mode === 'workspace') {
    return processWorkspaceGenerate(job)
  }

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
    void publishStateChange(userId, 'generation', jobId, 'GENERATING', 10)

    // 调用 Seedance 生成（first_frame 已废弃，统一走文本 + asset:// 多模态参考）
    const { taskId } = await createSeedanceTask({
      prompt,
      duration,
      aspectRatio,
      resolution,
    })
    void publishStateChange(userId, 'generation', jobId, 'SUBMITTED', 20)

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
    // 确保临时目录存在（生产镜像未预置 temp 目录，写入前自建，避免 ENOENT）
    await mkdir(path.dirname(tempPath), { recursive: true })
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
    // 关键积分写：整笔事务经 Redis 全局锁【跨进程】串行化，防止 read-modify-write 丢失更新。
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
    void publishCompleted(userId, 'generation', jobId)

    // 检查是否全部段完成，触发拼合
    await checkAndConcatProjectSegments(projectId)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('项目级分段生成失败', { jobId, projectId, error: errorMessage })
    void publishFailed(userId, 'generation', jobId, errorMessage)

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
      void publishStateChange(userId, 'generation', shotGroupId!, 'SUBMITTED', 10)

      const result = await createSeedanceTask({
        prompt,
        duration,
        aspectRatio,
        resolution,
        referenceImages: job.data.referenceImages,
        referenceAudioUrl: job.data.referenceAudioUrl,
        referenceVideoUrl: job.data.referenceVideoUrl, // reference_video 无缝衔接
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
      void publishStateChange(userId, 'generation', shotGroupId!, 'GENERATING', 20)
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
      // doubao-seedance-2.0 火山方舟官方定价（元/百万 completion_tokens）：
      // 输入包含视频（reference_video 衔接）480p/720p：¥28.0/M = ¥0.028/千tokens
      // 输入不含视频（第一组独立起镜）480p/720p：¥46.0/M = ¥0.046/千tokens
      // 此处统一按含视频参考计算（大多数组都有 reference_video），第一组的微小误差可接受
      const seedanceCostRMB = (tokenUsage.completionTokens / 1_000_000) * 28.0
      console.log(
        `[generate-video] 组 ${shotGroupId} Seedance Token: completion=${tokenUsage.completionTokens} total=${tokenUsage.totalTokens} | ` +
        `成本: ¥${seedanceCostRMB.toFixed(4)}（按 ¥28/M tokens 计）`
      )

      // 累加到 Redis（用于链式结束时汇总，key 60 分钟过期）
      const tokenKey = `token_usage:${projectId}`
      try {
        await redis.incrby(`${tokenKey}:completion`, tokenUsage.completionTokens)
        await redis.incrby(`${tokenKey}:total`, tokenUsage.totalTokens)
        await redis.expire(`${tokenKey}:completion`, 3600)
        await redis.expire(`${tokenKey}:total`, 3600)
      } catch { /* 非关键路径，失败不阻塞 */ }
    }

    // === 视频回存 OSS（Req 1）===
    const tempVideoPath = path.join(process.cwd(), 'public', 'uploads', 'temp', `gen_${jobId}_${Date.now()}.mp4`)
    try {
      // 下载并验证
      await downloadAndValidateVideo(videoUrl, tempVideoPath)

      // 从生成视频抽取封面帧（在 OSS 上传之前、事务之外完成 I/O）
      const genCoverUrl = await extractAndUploadGenCover(tempVideoPath, projectId, shotGroupId)

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
        // 生成视频封面 URL（从 genVideoUrl 抽帧得到，事务内写入保证原子性）
        genCoverUrl,
      })
      void publishCompleted(userId, 'generation', shotGroupId)

      // === 版本历史：生成成功后创建版本记录（best-effort，失败仅记录日志不回滚生成结果）===
      try {
        await createVersion({
          shotGroupId,
          videoUrl: ossVideoUrl,
          coverUrl: genCoverUrl,
          lastFrameUrl,
          promptSnapshot: prompt,
          costEstimate: actualCost,
          generationJobId: jobId,
        })
      } catch (versionError) {
        logger.error('生成成功后创建版本记录失败（best-effort，不影响生成结果）', {
          jobId,
          shotGroupId,
          error: versionError instanceof Error ? versionError.message : String(versionError),
        })
      }

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
      void publishChainProgress(userId, projectId, {
        totalGroups: job.data.chainTotalGroups ?? 1,
        currentGroup: (job.data.chainCurrentIndex ?? 0) + 1,
        completedGroups: (job.data.chainCurrentIndex ?? 0) + 1,
        currentJobStatus: 'SUCCEEDED',
      })
      await triggerNextChainGroup({
        projectId,
        userId,
        currentGroupId: shotGroupId,
        currentIndex: job.data.chainCurrentIndex ?? 0,
        totalGroups: job.data.chainTotalGroups ?? 1,
        lastFrameUrl,
        prevGroupVideoUrl: ossVideoUrl, // 当前组刚生成的视频，传给下一组作 reference_video 衔接
        aspectRatio,
        resolution,
      })
    } finally {
      // 清理临时文件
      await unlink(tempVideoPath).catch(() => {})
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    const errorCode = 'GENERATION_ERROR'
    void publishFailed(userId, 'generation', shotGroupId!, errorMessage)

    // 判断是否为最终失败：确定性错误（不可重试）或已耗尽 BullMQ 重试次数
    const isDeterministic =
      errorMessage.includes('(400)') ||
      errorMessage.includes('InvalidParameter') ||
      errorMessage.includes('生成超时') ||
      errorMessage.includes('Seedance 生成失败')
    const attemptsLimit = job.opts.attempts ?? 1
    const isFinalFailure = isDeterministic || job.attemptsMade + 1 >= attemptsLimit

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

    // 链式最终失败时整体收口：退还所有下游未运行组的冻结积分并置项目 FAILED，
    // 避免下游 QUEUED 组的积分永久锁死、项目永久卡在 GENERATING（修复 A/D）。
    // 仅在最终失败时触发，避免瞬时错误重试场景下误杀本可成功的下游组。
    if (isFinalFailure) {
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
  prevGroupVideoUrl?: string  // 当前组生成的视频 URL，传给下一组作 reference_video 衔接
  aspectRatio: string
  resolution: string
}): Promise<void> {
  const { projectId, userId, currentIndex, currentGroupId, lastFrameUrl, prevGroupVideoUrl, aspectRatio, resolution } = params

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

  // 在候选组中找到第一个有待执行 GenerationJob 的组
  // 链式模式下，后续组的 job 创建时直接为 QUEUED
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

  // 无更多待生成组 → 全部完成，标记项目可编辑（等用户确认后手动导出，不自动合并）
  if (!nextGroup || !nextJob) {
    logger.info('链式生成全部完成，项目回到可编辑状态（等用户手动导出）', { projectId, currentIndex })
    await markChainCompleted(projectId, userId)
    return
  }

  // 入队下一组：多模态参考模式——人物身份由 asset:// 锚定资产承载，每组独立装配参考图
  const nextRef = await buildGroupGenReference(nextGroup.id)
  const referenceImages = nextRef.referenceImages

  // 构建下一组的完整 prompt：merchantPrefix + characterPrefix + 组内所有分镜 prompt 合并
  const nextGroupShots = await prisma.shot.findMany({
    where: { shotGroupId: nextGroup.id },
    orderBy: { orderIndex: 'asc' },
    select: { prompt: true },
  })
  const nextShotsPromptText = nextGroupShots.map(s => s.prompt || '').filter(p => p.trim()).join('\n')
  // 商家画像前缀（仅 merchant 用户有门店时非空，拼到 prompt 最前）
  const merchantPrefixText = nextRef.merchantPrefix || ''
  let nextPrompt = merchantPrefixText + nextRef.characterPrefix + (nextJob.promptSnapshot || nextShotsPromptText)

  // 链式镜头衔接（reference_video 方案）：无条件将当前组生成视频传给下一组作 reference_video，
  // 由 Seedance 模型分析前段视频的运动轨迹、光线、构图来自然续接，不再做场景判定。
  const { VIDEO_CONTINUATION_PROMPT_SUFFIX } = await import('@/lib/video/frame-continuity')
  if (prevGroupVideoUrl) {
    nextPrompt = `${nextPrompt}${VIDEO_CONTINUATION_PROMPT_SUFFIX}`
    logger.info('链式续接：传入上一组视频作 reference_video 衔接', {
      projectId,
      nextGroupId: nextGroup.id,
      prevGroupVideoUrl: prevGroupVideoUrl.substring(0, 60),
    })
  } else {
    logger.info('链式续接：无前组视频（第一组或前组未成功），独立起镜', {
      projectId,
      nextGroupId: nextGroup.id,
    })
  }

  // 保存 promptSnapshot（生成时使用的完整 prompt，便于调试和版本历史）
  await prisma.generationJob.update({
    where: { id: nextJob.id },
    data: { promptSnapshot: nextPrompt },
  })

  await videoGenerateQueue.add('video-generate', {
    jobId: nextJob.id,
    shotGroupId: nextGroup.id,
    projectId,
    userId,
    prompt: nextPrompt,
    duration: nextJob.duration,
    aspectRatio,
    resolution,
    // 多模态参考：asset:// 人物锚定 + 场景帧 + 组音频
    referenceImages,
    referenceAudioUrl: nextRef.referenceAudioUrl,
    // reference_video 无缝衔接：无条件传入当前组生成视频，由模型自行续接
    referenceVideoUrl: prevGroupVideoUrl,
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
        status: { in: ['QUEUED', 'SUBMITTED', 'GENERATING'] },
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
 * 链式生成全部完成后，标记项目为可编辑状态
 *
 * 不再自动触发合并——用户需要先预览各组生成视频、可能微调后再手动点击导出。
 * 项目状态从 GENERATING 回到 EXPORTED（表示所有组已生成完毕，可以导出）。
 */
async function markChainCompleted(projectId: string, userId: string): Promise<void> {
  try {
    // 汇总本项目全部组的积分消耗（从已成功的 GenerationJob 的 costEstimate 汇总）
    const allJobs = await prisma.generationJob.findMany({
      where: { projectId, status: 'SUCCEEDED' },
      select: { costEstimate: true },
    })
    const totalCostCredits = allJobs.reduce((sum, j) => sum + (j.costEstimate ?? 0), 0)

    // 汇总 Seedance Token 消耗（从 Redis 累加器读取）
    const tokenKey = `token_usage:${projectId}`
    let totalCompletionTokens = 0
    let totalTokens = 0
    try {
      const completion = await redis.get(`${tokenKey}:completion`)
      const total = await redis.get(`${tokenKey}:total`)
      totalCompletionTokens = parseInt(completion || '0', 10)
      totalTokens = parseInt(total || '0', 10)
      // 读取后清理
      await redis.del(`${tokenKey}:completion`, `${tokenKey}:total`)
    } catch { /* 非关键路径 */ }

    const seedanceTotalCostRMB = (totalCompletionTokens / 1_000_000) * 28.0
    logger.info('═══ 链式生成完成汇总 ═══', {
      projectId,
      totalGroups: allJobs.length,
      totalCostCredits,
      seedanceTokens: { completion: totalCompletionTokens, total: totalTokens },
      seedanceCostRMB: `¥${seedanceTotalCostRMB.toFixed(4)}`,
    })
    console.log(
      `[generate-video] ═══ 项目 ${projectId} 生成总计 ═══ ` +
      `${allJobs.length} 组 | Seedance Token: completion=${totalCompletionTokens} total=${totalTokens} | ` +
      `Token 成本: ¥${seedanceTotalCostRMB.toFixed(4)} | 积分消耗: ${totalCostCredits}`
    )

    // 查询首个生成成功组的 genCoverUrl 更新项目封面
    const firstSucceededGroup = await prisma.shotGroup.findFirst({
      where: { projectId, genStatus: 'SUCCEEDED', genCoverUrl: { not: null } },
      orderBy: { groupIndex: 'asc' },
      select: { genCoverUrl: true },
    })

    // 标记项目状态为 EDITABLE（生成完毕，等用户手动导出）
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'EDITABLE',
        ...(firstSucceededGroup?.genCoverUrl ? { coverUrl: firstSucceededGroup.genCoverUrl } : {}),
      },
    })

    logger.info('链式生成完成，项目已回到 EDITABLE 状态', { projectId })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('标记链式生成完成状态失败', { projectId, error: msg })

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'FAILED', errorMsg: `标记完成失败: ${msg}` },
    }).catch(() => {})
  }
}

/**
 * 工作台模式视频生成（不涉及 Shot/ShotGroup）
 */
async function processWorkspaceGenerate(job: Job<VideoGenerateJobData>) {
  const { jobId, projectId, userId, workspaceData } = job.data

  logger.info('[workspace] 生成开始', { jobId, projectId })

  const genJob = await prisma.generationJob.findUnique({ where: { id: jobId } })
  if (!genJob) throw new UnrecoverableError(`Job 不存在: ${jobId}`)
  if (genJob.status === 'SUCCEEDED' || genJob.status === 'FAILED') return

  await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'GENERATING' } })
  await publishStateChange(userId, 'generation', jobId, 'GENERATING', 10).catch(() => {})

  const engine = genJob.engine || 'seedance'
  const prompt = genJob.promptSnapshot || ''
  const duration = genJob.duration || 5
  const aspectRatio = job.data.aspectRatio || '16:9'
  const assetUrls = workspaceData?.assetUrls || []
  const assetTypes = workspaceData?.assetTypes || {}

  let externalTaskId: string

  try {
    if (engine === 'happyhorse') {
      const refImages = assetUrls.filter((u) => assetTypes[u] === 'image')
      const r = await createHappyHorseWorkspaceTask({
        prompt, duration, aspectRatio, resolution: '720P',
        referenceImages: refImages.length > 0 ? refImages : undefined,
      })
      externalTaskId = r.taskId
    } else {
      const r = await createSeedanceTask({
        prompt, duration, aspectRatio,
        resolution: job.data.resolution || '720p',
        referenceImages: assetUrls.filter((u) => assetTypes[u] === 'image'),
        referenceAudioUrl: assetUrls.find((u) => assetTypes[u] === 'audio'),
      })
      externalTaskId = r.taskId
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg } })
    await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED', errorMsg: msg } }).catch(() => {})
    await refundCredits(userId, jobId, genJob.costEstimate || 0)
    await publishFailed(userId, 'generation', jobId, msg).catch(() => {})
    return
  }

  await publishStateChange(userId, 'generation', jobId, 'GENERATING', 30).catch(() => {})

  const startTime = Date.now()
  let finalVideoUrl: string | undefined

  while (Date.now() - startTime < MAX_POLL_TIME) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))

    const st = engine === 'happyhorse'
      ? await getHHWorkspaceStatus(externalTaskId)
      : await getSeedanceTaskStatus(externalTaskId)

    if (st.status === 'SUCCEEDED' || st.status === 'succeeded') {
      finalVideoUrl = st.videoUrl
      break
    }
    if (st.status === 'FAILED' || st.status === 'failed') {
      const msg = st.error?.message || '生成失败'
      await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED', errorMsg: msg } }).catch(() => {})
      await refundCredits(userId, jobId, genJob.costEstimate || 0)
      await publishFailed(userId, 'generation', jobId, msg).catch(() => {})
      return
    }

    const elapsed = Date.now() - startTime
    const pct = Math.min(90, 30 + Math.floor((elapsed / MAX_POLL_TIME) * 60))
    await publishStateChange(userId, 'generation', jobId, 'GENERATING', pct).catch(() => {})
  }

  if (!finalVideoUrl) {
    const msg = '生成超时'
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg } })
    await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED', errorMsg: msg } }).catch(() => {})
    await refundCredits(userId, jobId, genJob.costEstimate || 0)
    await publishFailed(userId, 'generation', jobId, msg).catch(() => {})
    return
  }

  // 成功：下载 → 转存 OSS
  const tmpDir = path.join('/tmp', 'workspace-gen', jobId)
  const tmpFile = path.join(tmpDir, 'output.mp4')
  try {
    await mkdir(tmpDir, { recursive: true })
    await downloadAndValidateVideo(finalVideoUrl, tmpFile)
    const ossKey = `workspace/${userId}/generated/${Date.now()}_${jobId}.mp4`
    await uploadFile(ossKey, tmpFile)
    const { getPublicUrl } = await import('@/lib/shared/storage')
    const ossVideoUrl = getPublicUrl(ossKey)

    let coverUrl: string | undefined
    try {
      const coverTmp = path.join(tmpDir, 'cover.jpg')
      await execFileAsync('ffmpeg', ['-i', tmpFile, '-ss', '0.1', '-frames:v', '1', '-y', coverTmp])
      const coverKey = `workspace/${userId}/covers/${Date.now()}_${jobId}.jpg`
      await uploadFile(coverKey, coverTmp)
      coverUrl = getPublicUrl(coverKey)
    } catch { /* 封面失败不阻塞 */ }

    await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', resultVideoUrl: ossVideoUrl } })
    await prisma.project.update({ where: { id: projectId }, data: { status: 'EDITABLE', videoUrl: ossVideoUrl, coverUrl: coverUrl || null } })

    const amt = genJob.costEstimate || 0
    await withCreditLock(() => prisma.$transaction(async (tx) => {
      const ex = await tx.creditLedger.findFirst({ where: { jobId, action: 'CHARGE' } })
      if (ex) return
      await tx.creditLedger.create({ data: { userId, jobId, action: 'CHARGE', amount: -amt, balanceAfter: 0, remark: '工作台生成扣费' } })
    }), 'workspace-charge')

    await setExpiry(ossVideoUrl, 14).catch(() => {})
    await publishCompleted(userId, 'generation', jobId).catch(() => {})
    logger.info('[workspace] 生成成功', { jobId, ossVideoUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg } })
    await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED', errorMsg: msg } }).catch(() => {})
    await refundCredits(userId, jobId, genJob.costEstimate || 0)
    await publishFailed(userId, 'generation', jobId, msg).catch(() => {})
  } finally {
    await unlink(tmpFile).catch(() => {})
    await unlink(path.join(tmpDir, 'cover.jpg')).catch(() => {})
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
