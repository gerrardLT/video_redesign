/**
 * 视频解析 Worker
 * 处理 'video-parse' 队列任务
 * 流程：获取视频 → 余额预检 → FFmpeg Normalize → 上传 OSS → AI 视频直传分析 → 写入数据库 → 分组 → 音频切片 → 更新项目状态
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { getVideoMetadata, normalizeVideo } from '@/lib/ffmpeg'
import { parseVideoDirectly } from '@/lib/video-analyzer'
import { groupShots } from '@/lib/grouping-service'
import { uploadFile } from '@/lib/storage'
import { estimateParseCreditCost, reserveParseCreditsTx, chargeParseCreditsTx } from '@/lib/credit-service'
import { withCreditLock } from '@/lib/distributed-lock'
import path from 'path'
import { mkdir, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * 将像素宽高约简为标准画面比例字符串
 * 例如 1920x1080 → "16:9"，1080x1920 → "9:16"，720x720 → "1:1"
 * 未匹配到标准比例时，用最大公约数约简（如 1280:720 → "16:9"）
 */
function normalizeAspectRatio(width: number, height: number): string {
  // 常见标准比例映射（容差 2%）
  const STANDARD_RATIOS: Array<{ w: number; h: number; label: string }> = [
    { w: 16, h: 9, label: '16:9' },
    { w: 9, h: 16, label: '9:16' },
    { w: 4, h: 3, label: '4:3' },
    { w: 3, h: 4, label: '3:4' },
    { w: 1, h: 1, label: '1:1' },
    { w: 21, h: 9, label: '21:9' },
    { w: 3, h: 2, label: '3:2' },
    { w: 2, h: 3, label: '2:3' },
  ]

  const ratio = width / height
  for (const std of STANDARD_RATIOS) {
    const stdRatio = std.w / std.h
    if (Math.abs(ratio - stdRatio) / stdRatio < 0.02) {
      return std.label
    }
  }

  // 未匹配标准比例，用最大公约数约简
  function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b)
  }
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

/** 时间轴校验输入：仅需排序与时间字段 */
interface TimelineShot {
  orderIndex: number
  startTime: number
  endTime: number
}

/**
 * 校验模型返回的分镜时间轴合法性（不信任模型输出）。
 *
 * 规则：
 * - orderIndex 必须连续升序（从最小值起步长为 1）
 * - startTime/endTime 必须为有限数且非负
 * - 每个分镜 endTime > startTime（时长为正）
 * - 相邻分镜按时间不重叠（容差 0.05s，前一 endTime ≤ 后一 startTime）
 * - 末个分镜 endTime 不超过视频总时长（容差 0.5s）
 *
 * @throws 不合法时抛出带具体原因的错误，交由主流程标记项目 FAILED
 */
function validateTimeline(shots: TimelineShot[], totalDuration: number): void {
  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)
  const EPS_OVERLAP = 0.05
  const EPS_TAIL = 0.5

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]

    if (!Number.isFinite(s.startTime) || !Number.isFinite(s.endTime)) {
      throw new Error(`分镜 ${s.orderIndex} 时间轴非法：startTime/endTime 不是有限数`)
    }
    if (s.startTime < 0) {
      throw new Error(`分镜 ${s.orderIndex} 时间轴非法：startTime(${s.startTime}) < 0`)
    }
    if (s.endTime <= s.startTime) {
      throw new Error(
        `分镜 ${s.orderIndex} 时间轴非法：endTime(${s.endTime}) ≤ startTime(${s.startTime})`
      )
    }
    // 相邻不重叠
    if (i > 0) {
      const prev = sorted[i - 1]
      if (s.startTime + EPS_OVERLAP < prev.endTime) {
        throw new Error(
          `分镜 ${prev.orderIndex}→${s.orderIndex} 时间轴重叠：` +
          `前 endTime(${prev.endTime}) > 后 startTime(${s.startTime})`
        )
      }
    }
  }

  // 末个分镜不超总时长
  const last = sorted[sorted.length - 1]
  if (last.endTime > totalDuration + EPS_TAIL) {
    throw new Error(
      `分镜时间轴超出视频总时长：末个分镜 endTime(${last.endTime}) > 总时长(${totalDuration})`
    )
  }
}

export interface ParseVideoJobData {
  projectId: string
  videoUrl: string
}

/**
 * 分镜组音频切片输入：每组的整体时间范围（组内首 Shot start ~ 末 Shot end）
 */
export interface GroupAudioRange {
  /** 组序号，Project 内从 0 起连续递增 */
  groupIndex: number
  /** 组内首个 Shot 的 startTime（秒） */
  startTime: number
  /** 组内末个 Shot 的 endTime（秒） */
  endTime: number
}

/**
 * 分镜组音频切片结果：逐组返回，便于调用方（任务 6.1）把 audioKey 持久化到 ShotGroup
 */
export interface GroupAudioResult {
  /** 组序号 */
  groupIndex: number
  /**
   * 成功时为上传到 OSS 的对象键 `audio/{projectId}/group_{groupIndex}.mp3`；
   * 失败时为 null（绝不返回伪造的 audioKey）。
   */
  audioKey: string | null
  /** 失败时记录真实错误信息；成功时为 null。 */
  error: string | null
}

/**
 * 按分镜组从视频中切出音频片段并上传到 OSS（Req 4）。
 *
 * 行为约定：
 * - 切片区间 `[group.startTime, group.endTime]`（组内首 Shot start ~ 末 Shot end，Req 4.2）。
 * - 上传 OSS，对象键 `audio/{projectId}/group_{groupIndex}.mp3`，按组组织（Req 4.3、4.5）。
 * - 单组切片/上传失败：记录该组 groupIndex 与真实错误信息并继续处理其余组（失败隔离，Req 4.4），
 *   不抛错中断其余组、不静默吞掉错误、不返回伪造的 audioKey（失败组 audioKey 为 null 并附带 error）。
 *
 * @returns 每组的处理结果数组，与入参 groups 顺序一一对应，供调用方持久化 audioKey 与展示失败状态。
 */
export async function extractGroupAudio(
  videoPath: string,
  projectId: string,
  groups: Array<GroupAudioRange>
): Promise<Array<GroupAudioResult>> {
  const audioDir = path.join(process.cwd(), 'public', 'uploads', 'audio', projectId)
  await mkdir(audioDir, { recursive: true })

  const results: GroupAudioResult[] = []

  for (const group of groups) {
    try {
      const outputPath = path.join(audioDir, `group_${group.groupIndex}.mp3`)
      // 按组整体时间范围切片：起点为组内首 Shot 的 startTime，终点为末 Shot 的 endTime
      await execFileAsync('ffmpeg', [
        '-i', videoPath,
        '-ss', String(group.startTime),
        '-to', String(group.endTime),
        '-vn',
        '-acodec', 'libmp3lame',
        '-q:a', '2',
        '-y',
        outputPath,
      ], { timeout: 30000 })

      // 上传音频到 OSS，按组组织对象键
      const ossAudioKey = `audio/${projectId}/group_${group.groupIndex}.mp3`
      const ossUrl = await uploadFile(ossAudioKey, outputPath)
      console.log(`[parse-video] 音频 group_${group.groupIndex} 已上传到 OSS: ${ossUrl}`)

      // 缺陷 10：上传 OSS 成功后删除本地公开副本，避免 public/uploads 无鉴权暴露私有音频。
      // 仅在真实 OSS 上传（返回 http URL）时删除；开发模式回退本地路径（/uploads/...）时本地为唯一副本，保留。
      if (ossUrl.startsWith('http')) {
        await unlink(outputPath).catch(() => {})
      }

      // 成功：返回真实的 OSS 对象键，供调用方持久化为 ShotGroup.audioKey
      results.push({ groupIndex: group.groupIndex, audioKey: ossAudioKey, error: null })
    } catch (err) {
      // 失败隔离：记录该组的真实错误信息并继续处理其余组（不抛错、不返回伪造 audioKey）
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[parse-video] 提取分镜组${group.groupIndex}音频失败（不阻塞其余组）:`, reason)
      results.push({ groupIndex: group.groupIndex, audioKey: null, error: reason })
    }
  }

  return results
}

/**
 * 分镜缩略图抽取结果：逐个分镜返回
 */
export interface ShotThumbnailResult {
  /** 分镜序号 */
  orderIndex: number
  /** 成功时为 OSS 公网 URL；失败时为 null（不返回伪造 URL） */
  coverUrl: string | null
  /** 失败时记录真实错误信息；成功时为 null */
  error: string | null
}

/**
 * 为每个分镜从视频抽取一帧作为缩略图/场景参考帧，并上传 OSS。
 *
 * 行为约定：
 * - 抽帧位置取 startTime + 0.1s（避开剪切点黑帧），缩放到宽 480 等比。
 * - 上传 OSS，对象键 `cover/{projectId}/shot_{orderIndex}.jpg`。
 * - 单个分镜抽帧/上传失败：记录错误并继续处理其余分镜（失败隔离，不抛错、不写伪造 URL）。
 *
 * 用途：① 编辑器分镜列表缩略图预览；② 无人脸分镜的 coverUrl 作为 Seedance reference_image 场景参考。
 *
 * @returns 每个分镜的处理结果数组，供调用方批量持久化 coverUrl。
 */
export async function extractShotThumbnails(
  videoPath: string,
  projectId: string,
  shots: Array<{ orderIndex: number; startTime: number }>
): Promise<Array<ShotThumbnailResult>> {
  const coverDir = path.join(process.cwd(), 'public', 'uploads', 'cover', projectId)
  await mkdir(coverDir, { recursive: true })

  const results: ShotThumbnailResult[] = []

  for (const shot of shots) {
    try {
      const outputPath = path.join(coverDir, `shot_${shot.orderIndex}.jpg`)
      // 抽帧位置避开剪切点黑帧；-ss 放在 -i 前用快速 seek
      const seekTime = Math.max(0, shot.startTime + 0.1)
      await execFileAsync('ffmpeg', [
        '-ss', String(seekTime),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=480:-2',
        '-q:v', '3',
        '-y',
        outputPath,
      ], { timeout: 15000 })

      const ossCoverKey = `cover/${projectId}/shot_${shot.orderIndex}.jpg`
      const ossUrl = await uploadFile(ossCoverKey, outputPath)

      // 缺陷 10：上传 OSS 成功后删除本地公开副本，避免 public/uploads 无鉴权暴露私有封面/参考帧。
      // 开发模式（无 OSS）回退本地路径时本地为唯一副本，保留。
      if (ossUrl.startsWith('http')) {
        await unlink(outputPath).catch(() => {})
      }

      results.push({ orderIndex: shot.orderIndex, coverUrl: ossUrl, error: null })
    } catch (err) {
      // 失败隔离：记录真实错误并继续（不抛错、不写伪造 URL）
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[parse-video] 分镜 ${shot.orderIndex} 缩略图抽取失败（不阻塞）:`, reason)
      results.push({ orderIndex: shot.orderIndex, coverUrl: null, error: reason })
    }
  }

  return results
}

async function processParseVideo(job: Job<ParseVideoJobData>): Promise<void> {
  const { projectId, videoUrl } = job.data
  console.log(`[parse-video] 开始解析项目 ${projectId}（attempt ${job.attemptsMade + 1}）`)

  // 幂等清理：重试时先删除上一次可能残留的解析数据，避免产生重复分镜/人物/分组
  if (job.attemptsMade > 0) {
    console.log(`[parse-video] 第 ${job.attemptsMade + 1} 次尝试，先清理残留数据`)
    await prisma.shot.deleteMany({ where: { projectId } })
    await prisma.character.deleteMany({ where: { projectId } })
    await prisma.shotGroup.deleteMany({ where: { projectId } })
    await prisma.styleConfig.deleteMany({ where: { projectId } })
  }

  // 追踪临时文件路径，确保 finally 里能清理（无论成功或失败）
  let normalizedPath: string | null = null
  let sourceTempDir: string | null = null

  try {
    // 1. 解析视频路径
    let videoPath: string
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // OSS URL：需要下载到本地供 FFmpeg 处理
      const tempDir = path.join(process.cwd(), 'public', 'uploads', 'temp', projectId)
      await mkdir(tempDir, { recursive: true })
      sourceTempDir = tempDir
      videoPath = path.join(tempDir, `source_${Date.now()}.mp4`)
      console.log(`[parse-video] 从 OSS 下载视频: ${videoUrl.substring(0, 60)}...`)
      const resp = await fetch(videoUrl)
      if (!resp.ok) throw new Error(`下载视频失败: HTTP ${resp.status}`)
      const buffer = Buffer.from(await resp.arrayBuffer())
      const { writeFile: writeFileAsync } = await import('fs/promises')
      await writeFileAsync(videoPath, buffer)
    } else {
      // 本地相对路径
      videoPath = path.join(process.cwd(), 'public', videoUrl)
    }

    // 2. 获取视频元数据
    const metadata = await getVideoMetadata(videoPath)
    console.log(`[parse-video] 视频元数据: ${metadata.duration}s, ${metadata.width}x${metadata.height}, ${metadata.fps}fps`)

    // 2.1 服务端时长硬校验（不信任客户端上报的 duration，以实际元数据为准）
    const MAX_DURATION_SECONDS = 120
    if (metadata.duration > MAX_DURATION_SECONDS) {
      throw new Error(
        `视频时长超限：实际 ${metadata.duration.toFixed(1)}s，最大允许 ${MAX_DURATION_SECONDS}s。` +
        `请裁剪后重新上传。`
      )
    }

    // 2.2 解析前余额预检（消耗任何重外部资源——Normalize/OSS/AI 多模态分析——之前）
    //     以真实元数据时长估算成本，余额不足则拒绝继续（抛 ApiError），绝不进入后续外部
    //     资源消耗、绝不事后兜底扣至 0。实际扣减在步骤 10 成功事务内一次性完成。
    const parseCost = estimateParseCreditCost(metadata.duration)
    const projectOwner = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { userId: true },
    })
    await reserveParseCreditsTx(prisma, projectOwner.userId, parseCost)

    // 3. Normalize 预处理：统一编码格式，消除可变帧率/HEVC 兼容性问题
    normalizedPath = path.join(path.dirname(videoPath), `normalized_${Date.now()}.mp4`)
    console.log(`[parse-video] 开始 Normalize 预处理...`)
    let normalizedOssUrl: string
    try {
      await normalizeVideo(videoPath, normalizedPath)
      console.log(`[parse-video] Normalize 完成`)

      // 上传 normalized 文件到 OSS（仅上传一次，URL 用于后续 AI 视频直传分析）
      const normalizedOssKey = `normalized/${projectId}/normalized_${Date.now()}.mp4`
      normalizedOssUrl = await uploadFile(normalizedOssKey, normalizedPath)
      console.log(`[parse-video] Normalized 文件已上传到 OSS: ${normalizedOssKey}`)

      // 后续本地处理（音频切片）基于 normalized 文件
      videoPath = normalizedPath
    } catch (normError: unknown) {
      const reason = normError instanceof Error ? normError.message : String(normError)
      throw new Error(`视频 Normalize 预处理失败：${reason}`)
    }

    // 4. 调用 AI 视频直传解析（无需抽帧，直接把 OSS 视频 URL 传给多模态模型）
    // 模型能看到完整运动信息+听到音频，输出更精准的分镜脚本和对白
    console.log(`[parse-video] 调用 AI 视频直传分析（${process.env.VISION_MODEL}），视频时长 ${metadata.duration.toFixed(1)}s`)
    let shots
    let parseResult: Awaited<ReturnType<typeof parseVideoDirectly>> | null = null
    try {
      parseResult = await parseVideoDirectly({
        videoUrl: normalizedOssUrl,
        totalDuration: metadata.duration,
      })
      shots = parseResult.shots
    } catch (parseError: unknown) {
      const reason = parseError instanceof Error ? parseError.message : String(parseError)
      throw new Error(`视频解析失败（视频直传分析）：${reason}`)
    }

    // 校验解析结果非空
    if (!Array.isArray(shots) || shots.length === 0) {
      throw new Error('视频解析失败：模型未返回任何分镜数据')
    }

    // 4.1 校验模型返回的时间轴合法性（非负、时长为正、相邻不重叠、不超总时长）
    //     不信任模型输出，非法时直接抛错避免污染分组/音频切片/时序对齐
    validateTimeline(shots, metadata.duration)

    // 5. 写入数据库 - 创建分镜记录（视频直传模式无帧图，coverUrl 暂空）
    for (const shot of shots) {
      await prisma.shot.create({
        data: {
          projectId,
          orderIndex: shot.orderIndex,
          startTime: shot.startTime,
          endTime: shot.endTime,
          scene: shot.scene,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          dialogue: JSON.stringify(shot.dialogue),
          audioDesc: shot.audioDesc,
          prompt: shot.suggestedPrompt,
          coverUrl: null,
          hasFace: shot.hasFace,
        },
      })
    }

    // 5.1 创建人物记录（先内存去重，避免逐个 findFirst 的 N+1 查询）
    const characterMap = new Map<string, string>() // name -> appearance
    for (const shot of shots) {
      for (const char of shot.characters) {
        if (!characterMap.has(char.name)) {
          characterMap.set(char.name, char.appearance)
        }
      }
    }
    for (const [name, appearance] of characterMap) {
      await prisma.character.create({
        data: { projectId, name, appearance },
      })
    }

    // 5.1.1 解析完成即自动为每个有外貌描述的人物生成人物形象（锚定图）
    //       用户后续仍可在人物面板「重新生成形象」。失败隔离：入队失败不阻塞主流程。
    try {
      const { imageGenerateQueue } = await import('@/lib/queue')
      const proj = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { userId: true },
      })
      const createdChars = await prisma.character.findMany({
        where: { projectId, enabled: true, appearance: { not: null } },
        select: { id: true, appearance: true },
      })
      for (const c of createdChars) {
        if (!c.appearance || c.appearance.trim().length === 0) continue
        await imageGenerateQueue.add('generate-character-image', {
          characterId: c.id,
          projectId,
          userId: proj.userId,
          prompt: c.appearance,
        })
      }
      console.log(`[parse-video] 已自动触发 ${createdChars.length} 个人物形象生成`)
    } catch (charGenErr) {
      const reason = charGenErr instanceof Error ? charGenErr.message : String(charGenErr)
      console.warn(`[parse-video] 自动触发人物形象生成失败（不阻塞，用户可手动生成）: ${reason}`)
    }

    // 5.2 为所有分镜抽取真实缩略图帧并回填 coverUrl（失败隔离：单个失败不阻塞主流程）
    //     用途：编辑器分镜列表预览 + 无人脸分镜场景帧作为生成阶段 reference_image。
    //     基于 normalized 本地视频抽帧（videoPath 此时已指向 normalized 文件）。
    const thumbResults = await extractShotThumbnails(
      videoPath,
      projectId,
      shots.map((s) => ({ orderIndex: s.orderIndex, startTime: s.startTime }))
    )
    let thumbFailedCount = 0
    let firstCoverUrl: string | null = null
    for (const result of thumbResults) {
      if (result.coverUrl) {
        await prisma.shot.updateMany({
          where: { projectId, orderIndex: result.orderIndex },
          data: { coverUrl: result.coverUrl },
        })
        // 记录序号最小的成功帧作为项目封面候选
        if (firstCoverUrl === null) {
          firstCoverUrl = result.coverUrl
        }
      } else {
        thumbFailedCount++
      }
    }
    // 设置项目封面（取第一个成功抽取的帧）
    if (firstCoverUrl) {
      await prisma.project.update({
        where: { id: projectId },
        data: { coverUrl: firstCoverUrl },
      })
    }
    console.log(
      `[parse-video] 分镜缩略图抽取完成，成功 ${thumbResults.length - thumbFailedCount}/${thumbResults.length} 个`
    )

    // 6. 计算分镜分组并落库
    //    顺序说明：先创建 Shot（步骤 5 已完成）→ groupShots 计算分组 → 创建 ShotGroup →
    //    用 updateMany 按 orderIndex 回填 Shot.shotGroupId，确保归属关联正确。
    const groupPlans = groupShots(
      shots.map((s) => ({
        orderIndex: s.orderIndex,
        startTime: s.startTime,
        endTime: s.endTime,
      }))
    )
    console.log(`[parse-video] 分镜分组完成，共 ${groupPlans.length} 组`)

    // 6.1 为每个分组创建 ShotGroup 记录，并回填组内各 Shot 的 shotGroupId
    //     记录每组创建后的 id 与时间范围，供后续音频切片与 audioKey 持久化使用
    const groupRecords: Array<{
      id: string
      groupIndex: number
      startTime: number
      endTime: number
    }> = []

    // 人物名 → id 映射（用于把每组实际出现的人物写入「分镜组↔人物」关联表，作为默认选中）
    const projectChars = await prisma.character.findMany({
      where: { projectId },
      select: { id: true, name: true },
    })
    const charNameToId = new Map(projectChars.map((c) => [c.name, c.id]))

    for (const plan of groupPlans) {
      // 创建 ShotGroup（genStatus 默认 PENDING，audioKey/genVideoUrl 暂为空）
      const group = await prisma.shotGroup.create({
        data: {
          projectId,
          groupIndex: plan.groupIndex,
          genDuration: plan.genDuration,
          startTime: plan.startTime,
          endTime: plan.endTime,
        },
      })

      // 按 orderIndex 将组内 Shot 归属到该 ShotGroup（回填 shotGroupId）
      await prisma.shot.updateMany({
        where: {
          projectId,
          orderIndex: { in: plan.shotOrderIndexes },
        },
        data: { shotGroupId: group.id },
      })

      groupRecords.push({
        id: group.id,
        groupIndex: plan.groupIndex,
        startTime: plan.startTime,
        endTime: plan.endTime,
      })

      // 写入「分镜组↔人物」关联：默认 = 该组镜头中实际出现的人物（用户后续可在前端增删）
      const groupCharNames = new Set<string>()
      for (const s of shots) {
        if (plan.shotOrderIndexes.includes(s.orderIndex)) {
          for (const ch of s.characters) groupCharNames.add(ch.name)
        }
      }
      const groupCharLinks = [...groupCharNames]
        .map((name) => charNameToId.get(name))
        .filter((id): id is string => !!id)
        .map((characterId) => ({ shotGroupId: group.id, characterId }))
      if (groupCharLinks.length > 0) {
        await prisma.shotGroupCharacter.createMany({ data: groupCharLinks })
      }
    }

    // 7. （已废弃）此前在解析阶段为第一组生成 Seedream 重绘锚定首帧作 Seedance first_frame。
    //    现已全面放弃 first_frame：人物一致性改由「确认形象」时生成的全片唯一人物锚定资产
    //    （asset:// 虚拟人像）在每组生成时作 reference_image 承载，故此处不再生成首帧。

    // 8. 按分镜组切片音频并上传 OSS（失败隔离：单组失败不阻塞其余组与主流程）
    //    extractGroupAudio 逐组返回结果，成功组持久化真实 audioKey，失败组记录错误且不写伪造数据。
    const audioResults = await extractGroupAudio(
      videoPath,
      projectId,
      groupRecords.map((g) => ({
        groupIndex: g.groupIndex,
        startTime: g.startTime,
        endTime: g.endTime,
      }))
    )

    // 8.1 将每组返回的 audioKey 持久化到对应 ShotGroup.audioKey；失败组保持为空并记录真实错误
    const groupIdByIndex = new Map(groupRecords.map((g) => [g.groupIndex, g.id]))
    let audioFailedCount = 0
    for (const result of audioResults) {
      const groupId = groupIdByIndex.get(result.groupIndex)
      if (!groupId) continue
      if (result.audioKey) {
        await prisma.shotGroup.update({
          where: { id: groupId },
          data: { audioKey: result.audioKey },
        })
      } else {
        // 失败组不写伪造 audioKey；记录真实失败原因（不阻塞项目进入 EDITABLE，Req 4.4）
        audioFailedCount++
        console.warn(
          `[parse-video] 分镜组 ${result.groupIndex} 音频未持久化（切片/上传失败）: ${result.error}`
        )
      }
    }
    console.log(
      `[parse-video] 音频按组切片完成，成功 ${audioResults.length - audioFailedCount}/${audioResults.length} 组`
    )

    // 9. 保存全局一致性设定到 StyleConfig（结构化 + 扁平双写）
    //    structuredStyle：前端分字段编辑用；customDescription：向后兼容 mergeTimelineScript 读取
    const globalSettings = parseResult?.globalSettings
    if (globalSettings) {
      // 结构化 JSON
      const structuredStyle: import('@/types/style').StructuredStyle = {
        artStyle: globalSettings.artStyle || '',
        colorTone: globalSettings.colorTone || '',
        characters: (globalSettings.characters || []).map(c => ({
          name: c.name,
          appearance: c.appearance,
          props: c.props || undefined,
        })),
        subtitleDeclaration: globalSettings.subtitleDeclaration || undefined,
      }

      // 扁平文本（向后兼容）
      const styleDescription = [
        globalSettings.artStyle,
        globalSettings.colorTone,
        globalSettings.subtitleDeclaration,
        globalSettings.characters?.map(c => `${c.name}：${c.appearance}${c.props ? '，' + c.props : ''}`).join('；'),
      ].filter(Boolean).join('。')

      await prisma.styleConfig.upsert({
        where: { projectId },
        create: {
          projectId,
          customDescription: styleDescription,
          structuredStyle: JSON.stringify(structuredStyle),
        },
        update: {
          customDescription: styleDescription,
          structuredStyle: JSON.stringify(structuredStyle),
        },
      })
      console.log(`[parse-video] 全局一致性设定已保存（结构化 + 扁平 ${styleDescription.length}字）`)
    }

    // 10. 解析成功：在同一事务内扣除解析积分 + 置项目为可编辑（即使部分音频组失败也允许进入 EDITABLE）
    //     扣费与状态更新原子化：事务提交即任务完成（不重试），保证扣费恰好一次。
    //     parseCost 在步骤 2.2 已按真实元数据时长估算（入口已预检余额）。
    //     关键积分写（缺陷 11）：整笔「扣费 + 置 EDITABLE」经 Redis 全局锁【跨进程】串行化，
    //     与 Worker / 应用进程其它积分写互斥，消除 libSQL/SQLite 并发写锁竞争与读-改-写丢失更新。
    await withCreditLock(() => prisma.$transaction(async (tx) => {
      // 查询项目所属用户（job data 不含 userId）
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { userId: true },
      })

      // 扣除解析积分：事务内二次校验余额，不允许欠费、不兜底扣至 0
      await chargeParseCreditsTx(tx, project.userId, projectId, parseCost)

      // 置项目为可编辑
      await tx.project.update({
        where: { id: projectId },
        data: {
          status: 'EDITABLE',
          duration: metadata.duration,
          aspectRatio: normalizeAspectRatio(metadata.width, metadata.height),
        },
      })
    }), 'parseCharge')
    console.log(`[parse-video] 解析积分已扣除：${parseCost} 积分`)

    console.log(
      `[parse-video] 项目 ${projectId} 解析完成，共 ${shots.length} 个分镜、${groupPlans.length} 个分镜组`
    )

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '视频解析失败'
    console.error(`[parse-video] 项目 ${projectId} 解析失败:`, errorMsg)

    // 更新项目状态为失败
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'FAILED',
        errorMsg,
      },
    })

    throw error // 让 BullMQ 处理重试逻辑
  } finally {
    // 无论成功或失败，统一清理本地临时文件
    if (normalizedPath) {
      await unlink(normalizedPath).catch(() => {})
    }
    if (sourceTempDir) {
      try {
        const { rm } = await import('fs/promises')
        await rm(sourceTempDir, { recursive: true, force: true })
      } catch {
        // 清理失败不影响主流程
      }
    }
  }
}

// 创建 Worker 实例
const connection = redis as unknown as ConnectionOptions

const worker = new Worker<ParseVideoJobData>(
  'video-parse',
  processParseVideo,
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 2,
      duration: 60000,
    },
  }
)

worker.on('completed', (job) => {
  console.log(`[parse-video] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  console.error(`[parse-video] 任务 ${job?.id} 失败:`, err.message)
})

export default worker
export { processParseVideo }
