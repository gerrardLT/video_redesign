/**
 * 视频合并 Worker
 * 处理 video-merge 队列任务
 *
 * 流程：下载各分镜视频 → FFmpeg concat 合并 → 输出本地文件 → 更新数据库
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { setExpiry } from '@/lib/asset-lifecycle-service'
import { uploadFile, getPublicUrl, isOSSConfigured } from '@/lib/storage'
import { logger } from '@/lib/logger'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, unlink, readdir } from 'fs/promises'
import path from 'path'
import type { ConnectionOptions } from 'bullmq'

const execFileAsync = promisify(execFile)

interface VideoMergeJobData {
  projectId: string
  userId: string
  shotVideoUrls: Array<{
    orderIndex: number
    videoUrl: string
    /** 该组原始时长（秒）。生成片段若被 Seedance 拉伸，按此裁切对齐时序。可选（老数据缺省时不裁切） */
    targetDuration?: number
    /** 提交 Seedance 的生成时长（秒），用于判断是否发生拉伸。可选 */
    genDuration?: number
  }>
  outputAspectRatio: string
  outputResolution: string
}

const connection = redis as unknown as ConnectionOptions

// ========================
// 辅助函数
// ========================

/**
 * 上传合并视频到 OSS（Req 3）
 * - 对象键：exported/{userId}/{projectId}/merged_{timestamp}.mp4
 * - 单次超时 120s，重试 2 次，间隔 3s
 */
async function uploadMergedVideoToOSS(
  filePath: string,
  userId: string,
  projectId: string
): Promise<string> {
  const maxRetries = 2
  const retryInterval = 3000
  const ossKey = `exported/${userId}/${projectId}/merged_${Date.now()}.mp4`

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const ossUrl = await uploadFile(ossKey, filePath)
      return ossUrl
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (attempt <= maxRetries) {
        console.warn(`[merge-video] 上传 OSS 第 ${attempt} 次失败（${reason}），${retryInterval / 1000}s 后重试...`)
        await new Promise(resolve => setTimeout(resolve, retryInterval))
      } else {
        throw new Error(`合并视频上传 OSS 全部 ${maxRetries + 1} 次尝试失败: ${reason}`)
      }
    }
  }

  throw new Error('上传合并视频到 OSS 失败（不应到达此处）')
}

/**
 * 检测视频文件是否包含音频流
 */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
      videoPath,
    ], { timeout: 5000 })
    return stdout.trim().includes('audio')
  } catch { return false }
}

/**
 * 下载远程视频到本地临时目录
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  // 如果是本地路径（以 / 开头但不是 http），直接跳过下载
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // 本地文件，不需要下载（parse 阶段本地上传的情况）
    return
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`下载视频失败: HTTP ${response.status} - ${url.substring(0, 80)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(outputPath, buffer)
}

/**
 * 获取视频的本地路径
 * 如果是远程 URL 则下载，如果是本地路径则直接返回
 */
async function resolveVideoPath(url: string, tempDir: string, index: number): Promise<string> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const localPath = path.join(tempDir, `input_${index}.mp4`)
    await downloadVideo(url, localPath)
    return localPath
  }
  // 本地路径：相对于 public 目录
  return path.join(process.cwd(), 'public', url)
}

/**
 * 按生成时长裁切片段（trim-on-merge）。
 *
 * 仅当生成片段被 Seedance 因 4s 下限拉伸时裁切：targetDuration（原始组时长）明显小于
 * genDuration（提交给 Seedance 的时长），说明发生了拉伸。
 * 裁切目标为 genDuration（而非 targetDuration），因为生成的有效内容覆盖 genDuration 时长。
 *
 * @returns 裁切后文件路径；无需裁切时返回原 inputPath
 */
async function trimClipIfNeeded(
  inputPath: string,
  tempDir: string,
  index: number,
  targetDuration?: number,
  genDuration?: number
): Promise<string> {
  // 无有效参数 / genDuration 未知 → 不裁切
  if (
    genDuration === undefined ||
    !Number.isFinite(genDuration) ||
    genDuration <= 0.5
  ) {
    return inputPath
  }
  // targetDuration 未知或已等于/小于 genDuration → 不裁切（未发生拉伸）
  if (
    targetDuration === undefined ||
    !Number.isFinite(targetDuration) ||
    targetDuration >= genDuration - 0.1
  ) {
    return inputPath
  }

  // 发生了拉伸：裁切到 genDuration（提交给 Seedance 的时长），保留完整生成内容
  const trimmedPath = path.join(tempDir, `trimmed_${index}.mp4`)
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-t', String(genDuration),
      '-c', 'copy',
      '-y',
      trimmedPath,
    ], { timeout: 60000 })
    return trimmedPath
  } catch {
    // -c copy 在非关键帧边界可能失败，回退到重编码裁切
    try {
      await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-t', String(genDuration),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-y',
        trimmedPath,
      ], { timeout: 120000 })
      return trimmedPath
    } catch (err) {
      // 裁切失败：记录并回退为不裁切（不阻塞合并；时序对齐退化但不丢内容）
      console.warn(`[merge-video] 片段 ${index} 裁切失败，回退为不裁切:`, err instanceof Error ? err.message : String(err))
      return inputPath
    }
  }
}

/**
 * 合并输入的单个分镜段：本地视频路径 + 组序号（= orderIndex，用于按组定位 audioKey/原始时间范围）。
 */
interface MergeSegment {
  videoPath: string
  groupIndex: number
}

/**
 * 单段音轨来源决策结果。
 *
 * 成片音轨采用【单一确定优先级】，逐段独立决策、自上而下取第一个可用源（缺陷 8）：
 *   1) 生成片段自带音轨（Seedance generate_audio TTS 配音）——最高优先级；
 *   2) 该组 audioKey 原声（解析阶段按组切片并上传 OSS 的音频）；
 *   3) 从原始整段视频按该组时间范围 [startTime,endTime] 提取的原声。
 * 三源不再叠加混音（已移除"无音频时整段原声叠加"旧路径），仅按优先级取其一，消除串味/错位。
 */
interface SegmentAudioPlan {
  /**
   * - 'embedded'：用片段自带音轨（优先级 1）
   * - 'file'：用外部音频文件 audioPath（优先级 2 组 audioKey 原声 / 优先级 3 原视频整段提取）
   * - 'silence'：该段无任何真实音源，用静音补齐维持时序（最后兜底，绝不伪造语音、绝不静默丢弃既有音轨）
   */
  source: 'embedded' | 'file' | 'silence'
  /** source==='file' 时的本地音频文件路径 */
  audioPath?: string
}

/**
 * 用 ffprobe 读取媒体时长（秒）；读取失败返回 0（调用方据此降级为不强制对齐）。
 */
async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { timeout: 5000 })
    const d = parseFloat(stdout.trim())
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch {
    return 0
  }
}

/**
 * 将 OSS 公网 URL 或本地 /uploads 路径解析为可供 FFmpeg 读取的本地文件路径。
 * - http(s) URL：下载到 destPath；
 * - 本地相对路径（/uploads/...）：直接映射到 public 目录。
 */
async function resolveMediaUrlToLocal(url: string, destPath: string): Promise<string> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    await downloadVideo(url, destPath)
    return destPath
  }
  return path.join(process.cwd(), 'public', url)
}

/**
 * 逐段解析音轨来源（单一优先级：自带 TTS 配音 > 组 audioKey 原声 > 原视频整段按时间范围提取）。
 *
 * 仅当上一优先级不可用时才下探，避免无谓下载：
 * - 生成片段已含音轨（Seedance generate_audio TTS）→ 直接用自带音轨，不加载任何外部音源；
 * - 片段无音轨且该组有 audioKey → 取组原声音频文件（优先级 2）；
 * - 仍无 → 从原视频整段按 [startTime,endTime] 提取该段原声（优先级 3）；
 * - 都不可用 → 标记静音补齐（仅维持音画时序，绝不伪造语音、绝不静默丢弃既有音轨）。
 *
 * 解析出的外部音频临时文件写入 tempDir，由调用方在合并结束后统一清理。
 */
async function resolveSegmentAudioPlans(
  segments: MergeSegment[],
  projectId: string,
  tempDir: string
): Promise<SegmentAudioPlan[]> {
  // 预取各段是否自带音轨（优先级 1 命中判断）
  const embeddedFlags = await Promise.all(segments.map((s) => hasAudioStream(s.videoPath)))

  // 仅当存在缺少自带音轨的段时，才加载组音频元数据与原视频
  const needExternal = embeddedFlags.some((has) => !has)
  let groupMetaByIndex = new Map<number, { audioKey: string | null; startTime: number; endTime: number }>()
  let originalVideoPath: string | null = null
  let originalHasAudio = false

  if (needExternal) {
    const groups = await prisma.shotGroup.findMany({
      where: { projectId },
      select: { groupIndex: true, audioKey: true, startTime: true, endTime: true },
    })
    groupMetaByIndex = new Map(
      groups.map((g) => [g.groupIndex, { audioKey: g.audioKey, startTime: g.startTime, endTime: g.endTime }])
    )

    // 仅当存在「无 audioKey」的缺音段时，才需回退到原视频整段提取（优先级 3）
    const anyNeedsOriginal = segments.some(
      (s, i) => !embeddedFlags[i] && !groupMetaByIndex.get(s.groupIndex)?.audioKey
    )
    if (anyNeedsOriginal) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { videoUrl: true },
      })
      if (project?.videoUrl) {
        originalVideoPath = await resolveMediaUrlToLocal(
          project.videoUrl,
          path.join(tempDir, `original_${Date.now()}.mp4`)
        )
        originalHasAudio = await hasAudioStream(originalVideoPath)
      }
    }
  }

  const plans: SegmentAudioPlan[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    // 优先级 1：片段自带 Seedance TTS 配音
    if (embeddedFlags[i]) {
      plans.push({ source: 'embedded' })
      continue
    }

    const meta = groupMetaByIndex.get(seg.groupIndex)

    // 优先级 2：组 audioKey 原声
    if (meta?.audioKey) {
      try {
        const audioUrl = getPublicUrl(meta.audioKey)
        const localAudio = await resolveMediaUrlToLocal(
          audioUrl,
          path.join(tempDir, `seg_audio_${seg.groupIndex}.mp3`)
        )
        plans.push({ source: 'file', audioPath: localAudio })
        continue
      } catch (err) {
        console.warn(
          `[merge-video] 组 ${seg.groupIndex} audioKey 原声获取失败，下探原视频提取:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // 优先级 3：从原视频整段按该组时间范围提取原声
    if (originalVideoPath && originalHasAudio && meta) {
      try {
        const extracted = path.join(tempDir, `seg_orig_audio_${seg.groupIndex}.aac`)
        await execFileAsync('ffmpeg', [
          '-i', originalVideoPath,
          '-ss', String(meta.startTime),
          '-to', String(meta.endTime),
          '-vn', '-acodec', 'aac', '-b:a', '128k',
          '-y', extracted,
        ], { timeout: 60000 })
        plans.push({ source: 'file', audioPath: extracted })
        continue
      } catch (err) {
        console.warn(
          `[merge-video] 组 ${seg.groupIndex} 原视频音频提取失败，使用静音补齐:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // 最后兜底：静音补齐（仅维持音画时序）
    plans.push({ source: 'silence' })
  }

  return plans
}

/**
 * 使用 FFmpeg concat filter 合并多个分镜段。
 *
 * 视频：逐段缩放 + pad 到统一分辨率后顺序拼接。
 * 音频：按【单一确定优先级】逐段决定音源（自带 Seedance TTS 配音 > 组 audioKey 原声 >
 *   原视频整段按时间范围提取，详见 resolveSegmentAudioPlans），不再三源叠加混音。
 * 音画同步对齐规则：每段所选音轨一律按该段视频时长对齐——超出截断、不足以静音补齐（apad+atrim），
 *   并统一重采样到 44100/stereo/fltp，使逐段 A/V 一一对应，拼接后整体不串味、不错位。
 */
async function ffmpegConcat(
  segments: MergeSegment[],
  outputPath: string,
  aspectRatio: string,
  resolution: string,
  projectId: string,
  tempDir: string
): Promise<void> {
  if (segments.length === 0) {
    throw new Error('没有可合并的视频文件')
  }

  // 解析目标分辨率
  const { width, height } = parseResolution(resolution, aspectRatio)

  // 逐段确定音源（单一优先级）与各段视频时长（音画对齐基准）
  const audioPlans = await resolveSegmentAudioPlans(segments, projectId, tempDir)
  const durations = await Promise.all(segments.map((s) => getMediaDuration(s.videoPath)))

  // 输入：先全部视频输入（索引 0..N-1），再追加 source==='file' 的外部音频输入
  const inputArgs: string[] = []
  for (const seg of segments) {
    inputArgs.push('-i', seg.videoPath)
  }
  const fileAudioInputIndex: Array<number | null> = []
  let nextInputIndex = segments.length
  for (const plan of audioPlans) {
    if (plan.source === 'file' && plan.audioPath) {
      inputArgs.push('-i', plan.audioPath)
      fileAudioInputIndex.push(nextInputIndex)
      nextInputIndex++
    } else {
      fileAudioInputIndex.push(null)
    }
  }

  // 统一音频格式，确保 concat 各段流规格一致
  const AUDIO_FORMAT = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'

  const filterParts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    // 视频：缩放 + pad 到统一分辨率
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v${i}]`
    )

    // 音频：按该段视频时长对齐（apad 补齐 + atrim 截断），再重置时间戳
    const di = durations[i] > 0 ? durations[i] : null
    const alignTail = di ? `,apad,atrim=0:${di.toFixed(3)},asetpts=N/SR/TB` : `,asetpts=N/SR/TB`
    const plan = audioPlans[i]

    if (plan.source === 'embedded') {
      filterParts.push(`[${i}:a]${AUDIO_FORMAT}${alignTail}[a${i}]`)
    } else if (plan.source === 'file') {
      const ai = fileAudioInputIndex[i]!
      filterParts.push(`[${ai}:a]${AUDIO_FORMAT}${alignTail}[a${i}]`)
    } else {
      // 静音补齐：anullsrc 生成与该段视频等长的静音轨（仅维持时序）
      const dur = (di ?? 1).toFixed(3)
      filterParts.push(
        `anullsrc=channel_layout=stereo:sample_rate=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `atrim=0:${dur},asetpts=N/SR/TB[a${i}]`
      )
    }
  }

  const concatV = segments.map((_, i) => `[v${i}]`).join('')
  const concatA = segments.map((_, i) => `[a${i}]`).join('')
  const filterComplex = [
    ...filterParts,
    `${concatV}concat=n=${segments.length}:v=1:a=0[outv]`,
    `${concatA}concat=n=${segments.length}:v=0:a=1[outa]`,
  ].join(';')

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ]

  try {
    await execFileAsync('ffmpeg', args, { timeout: 5 * 60 * 1000 })
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string }
    throw new Error(
      `FFmpeg 合并失败: ${err.message || '未知错误'}\n` +
      `stderr: ${(err.stderr || '').substring(0, 500)}`
    )
  }
}

/**
 * 解析分辨率参数
 */
function parseResolution(resolution: string, aspectRatio: string): { width: number; height: number } {
  // resolution 格式: "720p" / "1080p"
  // aspectRatio 格式: "16:9" / "9:16" / "720:1280"

  let targetHeight = 720
  if (resolution === '1080p') targetHeight = 1080
  else if (resolution === '480p') targetHeight = 480

  // 解析宽高比
  const [w, h] = aspectRatio.split(':').map(Number)
  if (w && h) {
    if (w > h) {
      // 横屏 16:9
      return { width: Math.round(targetHeight * w / h), height: targetHeight }
    } else {
      // 竖屏 9:16
      return { width: Math.round(targetHeight * h / w), height: targetHeight }
    }
  }

  // 默认 16:9
  return { width: Math.round(targetHeight * 16 / 9), height: targetHeight }
}

/**
 * 清理临时文件
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    const files = await readdir(tempDir)
    for (const file of files) {
      await unlink(path.join(tempDir, file)).catch(() => {})
    }
    const { rmdir } = await import('fs/promises')
    await rmdir(tempDir).catch(() => {})
  } catch {
    // 清理失败不影响主流程
  }
}

// ========================
// Worker 主逻辑
// ========================

async function processMergeVideo(job: Job<VideoMergeJobData>) {
  const { projectId, userId, shotVideoUrls, outputAspectRatio, outputResolution } = job.data

  // 幂等防重：如果项目已为 EXPORTED，说明合并已完成（可能被重复入队），直接跳过
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  })
  if (project?.status === 'EXPORTED') {
    console.log(`[merge-video] 项目 ${projectId} 已为 EXPORTED，幂等跳过`)
    return
  }

  // 按 orderIndex 排序
  const sortedShots = [...shotVideoUrls].sort((a, b) => a.orderIndex - b.orderIndex)

  console.log(`[merge-video] 开始合并项目 ${projectId}:`, {
    shotCount: sortedShots.length,
    aspectRatio: outputAspectRatio,
    resolution: outputResolution,
  })

  // 创建临时工作目录
  const tempDir = path.join(process.cwd(), 'public', 'uploads', 'temp', `merge-${projectId}-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  // 追踪本地合并产物路径，确保上传 OSS 后在 finally 清理本地公开副本（缺陷 10）
  let mergedOutputPath: string | null = null

  try {
    // 1. 下载/解析所有分镜视频到本地
    console.log(`[merge-video] 下载 ${sortedShots.length} 个分镜视频...`)

    // 前置检查：确认分段视频的 Asset 未被过期清理（极端情况下 14 天后合并才执行）
    const segmentUrls = sortedShots.map((s) => s.videoUrl).filter((u) => u.startsWith('http'))
    if (segmentUrls.length > 0) {
      const expiredAssets = await prisma.asset.findMany({
        where: {
          projectId,
          url: { in: segmentUrls },
          status: 'EXPIRED',
        },
        select: { url: true },
      })
      if (expiredAssets.length > 0) {
        throw new Error(
          `合并失败：${expiredAssets.length} 个分段视频已过期被清理，无法合并。` +
          `请重新生成后再导出。`
        )
      }
    }

    const segments: MergeSegment[] = []

    for (let i = 0; i < sortedShots.length; i++) {
      const shot = sortedShots[i]
      await job.updateProgress(Math.round((i / sortedShots.length) * 40))

      const localPath = await resolveVideoPath(shot.videoUrl, tempDir, i)
      // trim-on-merge：生成片段被 Seedance 拉伸时，按原始时长裁切对齐时序
      const finalPath = await trimClipIfNeeded(
        localPath,
        tempDir,
        i,
        shot.targetDuration,
        shot.genDuration
      )
      // groupIndex = orderIndex：用于在 ffmpegConcat 中按组定位 audioKey/原始时间范围（音轨优先级决策）
      segments.push({ videoPath: finalPath, groupIndex: shot.orderIndex })
      console.log(`[merge-video]   分镜${i + 1}: ${shot.videoUrl.substring(0, 60)}... → ${path.basename(finalPath)}`)
    }

    await job.updateProgress(40)

    // 2. FFmpeg 合并
    console.log(`[merge-video] 开始 FFmpeg 合并...`)
    const outputDir = path.join(process.cwd(), 'public', 'uploads', 'merged', userId, projectId)
    await mkdir(outputDir, { recursive: true })

    const outputFileName = `merged_${Date.now()}.mp4`
    const outputPath = path.join(outputDir, outputFileName)
    mergedOutputPath = outputPath

    await ffmpegConcat(segments, outputPath, outputAspectRatio, outputResolution, projectId, tempDir)
    await job.updateProgress(85)

    console.log(`[merge-video] FFmpeg 合并完成: ${outputPath}`)

    // 3. 上传合并视频到 OSS（Req 3）
    const ossVideoUrl = await uploadMergedVideoToOSS(outputPath, userId, projectId)
    console.log(`[merge-video] 合并视频已上传到 OSS: ${ossVideoUrl}`)

    // 4. 在事务中创建 Asset + 更新项目状态（Req 3.2）
    try {
      const { statSync } = await import('fs')
      const fileSize = statSync(outputPath).size

      await prisma.$transaction(async (tx) => {
        // 更新项目状态为已导出
        await tx.project.update({
          where: { id: projectId },
          data: { status: 'EXPORTED' },
        })

        // 创建合并导出 Asset（url 为 OSS URL）
        const asset = await tx.asset.create({
          data: {
            projectId,
            userId,
            type: 'AI_GENERATED',
            url: ossVideoUrl,
            fileName: `project-${projectId}-merged.mp4`,
            fileSize,
            status: 'UPLOADED',
            sortOrder: 0,
          },
        })

        // 设置 14 天过期（事务外执行，不影响主事务）
        // 因为 setExpiry 内部有自己的事务，在外部调用
        return asset
      })

      // 在事务外设置过期
      const asset = await prisma.asset.findFirst({
        where: { projectId, userId, url: ossVideoUrl },
        orderBy: { createdAt: 'desc' },
      })
      if (asset) {
        await setExpiry(asset.id, 14).catch((expiryError) => {
          logger.error('合并导出后设置资产过期时间失败', {
            projectId,
            error: expiryError instanceof Error ? expiryError.message : String(expiryError),
          })
        })
      }
    } catch (txError) {
      const reason = txError instanceof Error ? txError.message : String(txError)
      throw new Error(`合并导出事务失败: ${reason}`)
    }

    await job.updateProgress(100)
    console.log(`[merge-video] 项目 ${projectId} 合并导出完成: ${ossVideoUrl}`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '合并失败'
    console.error(`[merge-video] 项目 ${projectId} 合并失败:`, errorMessage)

    // 更新项目状态为 MERGE_FAILED（区别于生成 FAILED，允许用户重新触发合并而不需要重新生成）
    // 各组的生成视频（14 天过期 Asset）仍然有效，用户可在过期前只重试合并
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'MERGE_FAILED',
        errorMsg: `视频合并失败（各段生成视频仍有效，可重试合并）: ${errorMessage}`,
      },
    })

    throw error
  } finally {
    // 清理临时文件
    await cleanupTempDir(tempDir)

    // 缺陷 10：清理本地合并产物公开副本（已上传 OSS，Asset.url 指向 OSS）。
    // 仅当真实上传 OSS（mergedOutputPath 对应的 ossVideoUrl 为 http）时删除；开发模式无 OSS 时不在此删除唯一副本。
    if (mergedOutputPath && isOSSConfigured()) {
      await unlink(mergedOutputPath).catch(() => {})
    }
  }
}

// ========================
// 创建 Worker 实例
// ========================

export const mergeVideoWorker = new Worker(
  'video-merge',
  processMergeVideo,
  {
    connection,
    concurrency: 1, // 合并操作资源密集，一次只处理一个
  }
)

mergeVideoWorker.on('completed', (job) => {
  console.log(`[merge-video] Job ${job.id} 完成`)
})

mergeVideoWorker.on('failed', (job, err) => {
  console.error(`[merge-video] Job ${job?.id} 失败:`, err.message)
})
