/**
 * 视频合并 Worker
 * 处理 video-merge 队列任务
 *
 * 流程：下载各分镜视频 → 收集段信息 → 计算转场计划 → FFmpeg concat 合并（含转场 filter）→ 输出本地文件 → 更新数据库
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { setExpiry } from '@/lib/shared/asset-lifecycle-service'
import { uploadFile, getPublicUrl, isOSSConfigured } from '@/lib/shared/storage'
import { logger } from '@/lib/shared/logger'
import { publishStateChange, publishCompleted, publishFailed } from '@/lib/shared/progress-publisher'
import { computeTransitionPlan, buildTransitionFilters, type SegmentInfo } from '@/lib/video/transition-engine'
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
  /** 导出超分目标分辨率（由 Export API 传入），为 720p/1080p 时合并后入队超分 Worker */
  targetResolution?: '480p' | '720p' | '1080p'
  /** 冻结的超分积分数（480p 时为 0） */
  reservedCredits?: number
  /** 视频总时长（秒） */
  videoDuration?: number
  // HappyHorse 分段合并专用
  /** 生成引擎标识，happyhorse 时走无转场直接拼接 */
  engine?: 'seedance' | 'happyhorse'
  /** HappyHorse 各段生成结果视频 URL（已按顺序排列） */
  segmentVideoUrls?: string[]
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
 * 成片音轨采用【单一确定优先级】，逐段独立决策、自上而下取第一个可用源：
 *   ① 该组 audioKey 原声（解析阶段按组切片的音频，各组不同）——最高优先级；
 *   ② 生成片段自带音轨（Seedance generate_audio TTS 配音）；
 *   ③ 从原始整段视频按该组时间范围 [startTime,endTime] 提取的原声。
 * 三源不再叠加混音，仅按优先级取其一，消除串味/错位；各组 audioKey 真实作用于成片。
 */
interface SegmentAudioPlan {
  /**
   * - 'file'：用外部音频文件 audioPath（优先级 ① 组 audioKey 原声 / 优先级 ③ 原视频整段提取）
   * - 'embedded'：用片段自带音轨（优先级 ②）
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
 * 逐段解析音轨来源（单一优先级：组 audioKey 原声 > 自带 TTS 配音 > 原视频整段按时间范围提取）。
 *
 * 仅当上一优先级不可用时才下探，避免无谓下载：
 * - ① 该组有 audioKey 原声 → 取组原声音频文件（各组真实不同的原声，最高优先级）；
 * - ② 片段已含音轨（Seedance generate_audio TTS）→ 用自带音轨；
 * - ③ 从原视频整段按 [startTime,endTime] 提取该段原声；
 * - ④ 都不可用 → 标记静音补齐（仅维持音画时序，绝不伪造语音、绝不静默丢弃既有音轨）。
 *
 * 解析出的外部音频临时文件写入 tempDir，由调用方在合并结束后统一清理。
 */
async function resolveSegmentAudioPlans(
  segments: MergeSegment[],
  projectId: string,
  tempDir: string
): Promise<SegmentAudioPlan[]> {
  // 预取各段是否自带音轨（优先级 ② 命中判断）
  const embeddedFlags = await Promise.all(segments.map((s) => hasAudioStream(s.videoPath)))

  // 始终加载组音频元数据：audioKey 为最高优先级（①），需优先判断
  const groups = await prisma.shotGroup.findMany({
    where: { projectId },
    select: { groupIndex: true, audioKey: true, startTime: true, endTime: true },
  })
  const groupMetaByIndex = new Map(
    groups.map((g) => [g.groupIndex, { audioKey: g.audioKey, startTime: g.startTime, endTime: g.endTime }])
  )

  // 仅当存在「无 audioKey 且无自带音轨」的段时，才需回退到原视频整段提取（优先级 ③）
  let originalVideoPath: string | null = null
  let originalHasAudio = false

  const anyNeedsOriginal = segments.some(
    (s, i) => !groupMetaByIndex.get(s.groupIndex)?.audioKey && !embeddedFlags[i]
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

  const plans: SegmentAudioPlan[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const meta = groupMetaByIndex.get(seg.groupIndex)

    // 优先级 ①：组 audioKey 原声（各组真实不同，使成片体现各组原声差异）
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
          `[merge-video] 组 ${seg.groupIndex} audioKey 原声获取失败，下探自带音轨/原视频提取:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // 优先级 ②：片段自带 Seedance TTS 配音
    if (embeddedFlags[i]) {
      plans.push({ source: 'embedded' })
      continue
    }

    // 优先级 ③：从原视频整段按该组时间范围提取原声
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

    // 最后兜底 ④：静音补齐（仅维持音画时序）
    plans.push({ source: 'silence' })
  }

  return plans
}

/**
 * 使用 FFmpeg concat filter 合并多个分镜段。
 *
 * 视频：逐段缩放 + pad 到统一分辨率后顺序拼接。
 * 音频：按【单一确定优先级】逐段决定音源（① 组 audioKey 原声 > ② 自带 Seedance TTS 配音 >
 *   ③ 原视频整段按时间范围提取，详见 resolveSegmentAudioPlans），不再三源叠加混音。
 * 音画同步对齐规则：每段所选音轨一律按该段视频时长对齐——超出截断、不足以静音补齐（apad+atrim），
 *   并统一重采样到 44100/stereo/fltp，使逐段 A/V 一一对应，拼接后整体不串味、不错位。
 *
 * 转场增强（Transition Engine 集成）：
 * 合并前收集各段 SegmentInfo（ffprobe 时长 + scene 字段），调用 computeTransitionPlan +
 * buildTransitionFilters 生成 xfade/acrossfade filter。FFmpeg xfade 执行失败时回退到
 * 无转场的 concat 合并（现有逻辑），ffprobe 获取时长失败时该段 duration 设为 0，跳过相关转场。
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

  // 收集转场所需的 SegmentInfo（时长 + 场景）
  const segmentInfos = await collectSegmentInfos(segments, projectId)

  // 计算转场计划
  const transitionPlan = computeTransitionPlan(segmentInfos)
  const { videoFilter: transitionVideoFilter, audioFilter: transitionAudioFilter } =
    buildTransitionFilters(segmentInfos, transitionPlan)

  // 如果有有效的转场 filter，尝试使用带转场的合并
  if (transitionVideoFilter && transitionAudioFilter) {
    try {
      await ffmpegConcatWithTransitions(
        segments, outputPath, aspectRatio, resolution, projectId, tempDir,
        transitionVideoFilter, transitionAudioFilter
      )
      console.log(`[merge-video] 带转场合并成功（${transitionPlan.transitions.filter(t => t.type !== 'none').length} 个转场）`)
      return
    } catch (transitionError) {
      console.warn(
        `[merge-video] 带转场合并失败，回退到无转场 concat:`,
        transitionError instanceof Error ? transitionError.message : String(transitionError)
      )
      // 回退到无转场合并
    }
  }

  // 无转场或转场失败：使用原有 concat filter 逻辑
  await ffmpegConcatFallback(segments, outputPath, aspectRatio, resolution, projectId, tempDir)
}

/**
 * 收集各段的 SegmentInfo（ffprobe 时长 + DB scene 字段）
 * ffprobe 失败时 duration 设为 0，跳过相关转场
 */
async function collectSegmentInfos(segments: MergeSegment[], projectId: string): Promise<SegmentInfo[]> {
  // 批量查询各组的 scene 字段
  const groups = await prisma.shotGroup.findMany({
    where: { projectId },
    include: {
      shots: {
        orderBy: { orderIndex: 'asc' },
        take: 1,
        select: { scene: true },
      },
    },
  })
  const sceneByGroupIndex = new Map(
    groups.map((g) => [g.groupIndex, g.shots[0]?.scene ?? null])
  )

  // 获取各段视频时长
  const infos: SegmentInfo[] = []
  for (const seg of segments) {
    const duration = await getMediaDuration(seg.videoPath)
    const scene = sceneByGroupIndex.get(seg.groupIndex) ?? null
    infos.push({ groupIndex: seg.groupIndex, duration, scene })
  }
  return infos
}

/**
 * 带转场的 FFmpeg 合并（使用 xfade + acrossfade filter）
 */
async function ffmpegConcatWithTransitions(
  segments: MergeSegment[],
  outputPath: string,
  aspectRatio: string,
  resolution: string,
  projectId: string,
  tempDir: string,
  transitionVideoFilter: string,
  transitionAudioFilter: string
): Promise<void> {
  const { width, height } = parseResolution(resolution, aspectRatio)

  // 输入参数
  const inputArgs: string[] = []
  for (const seg of segments) {
    inputArgs.push('-i', seg.videoPath)
  }

  // 视频预处理：先统一缩放各段，再串联 xfade
  const scaleParts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    scaleParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[sv${i}]`
    )
  }

  // 替换 xfade filter 中的输入标签为缩放后标签
  let modifiedVideoFilter = transitionVideoFilter
  for (let i = 0; i < segments.length; i++) {
    modifiedVideoFilter = modifiedVideoFilter.replace(`[${i}:v]`, `[sv${i}]`)
  }

  const filterComplex = [...scaleParts, modifiedVideoFilter, transitionAudioFilter].join(';')

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

  await execFileAsync('ffmpeg', args, { timeout: 5 * 60 * 1000 })
}

/**
 * 无转场 FFmpeg concat 合并（原有逻辑，作为回退方案）
 */
async function ffmpegConcatFallback(
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
  const { projectId, userId, shotVideoUrls, outputAspectRatio } = job.data
  // 合并阶段统一使用 480p 输出（超分场景由后续 Upscale Worker 处理分辨率提升）
  const mergeResolution = '480p'

  // 幂等防重：如果项目已为 EXPORTED 且已有导出视频 URL，说明合并已完成（可能被重复入队）
  // 此时需确保 exportStatus 为 COMPLETED（修复：export API 重入队后 Worker 跳过但 exportStatus 卡在 MERGING）
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, exportStatus: true, exportVideoUrl: true },
  })
  if (project?.status === 'EXPORTED' && project.exportVideoUrl) {
    // 确保 exportStatus 为 COMPLETED（修复卡 MERGING 的脏状态）
    if (project.exportStatus !== 'COMPLETED') {
      await prisma.project.update({
        where: { id: projectId },
        data: { exportStatus: 'COMPLETED' },
      })
    }
    console.log(`[merge-video] 项目 ${projectId} 已有导出视频，幂等跳过`)
    void publishCompleted(userId, 'merge', projectId)
    return
  }

  // 按 orderIndex 排序
  const sortedShots = [...shotVideoUrls].sort((a, b) => a.orderIndex - b.orderIndex)

  console.log(`[merge-video] 开始合并项目 ${projectId}:`, {
    shotCount: sortedShots.length,
    aspectRatio: outputAspectRatio,
    resolution: mergeResolution,
  })
  void publishStateChange(userId, 'merge', projectId, 'started', 0)

  // === HappyHorse 分段合并分支：无转场，FFmpeg concat 直接拼接 ===
  if (job.data.engine === 'happyhorse' && job.data.segmentVideoUrls) {
    console.log(`[merge-video] HappyHorse 分段合并模式 - ${job.data.segmentVideoUrls.length} 段`)
    const hhTempDir = path.join(process.cwd(), 'public', 'uploads', 'temp', `hh-merge-${projectId}-${Date.now()}`)
    await mkdir(hhTempDir, { recursive: true })

    try {
      // 下载各段视频到临时目录
      const segPaths: string[] = []
      for (let i = 0; i < job.data.segmentVideoUrls.length; i++) {
        const segUrl = job.data.segmentVideoUrls[i]
        const segPath = path.join(hhTempDir, `seg_${i}.mp4`)
        await downloadVideo(segUrl, segPath)
        segPaths.push(segPath)
        await job.updateProgress(Math.round((i / job.data.segmentVideoUrls.length) * 50))
      }

      // FFmpeg concat 无损拼接（不加转场）
      const { mergeSegments } = await import('@/lib/video/segment-service')
      const hhOutputPath = path.join(hhTempDir, `merged_${Date.now()}.mp4`)
      await mergeSegments(segPaths, hhOutputPath)
      await job.updateProgress(80)

      // 上传到 OSS
      const ossVideoUrl = await uploadMergedVideoToOSS(hhOutputPath, userId, projectId)
      console.log(`[merge-video] HappyHorse 合并视频已上传到 OSS: ${ossVideoUrl}`)

      // 创建 Asset + 更新项目状态
      const { statSync } = await import('fs')
      const fileSize = statSync(hhOutputPath).size

      await prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: projectId },
          data: {
            status: 'EXPORTED',
            exportStatus: 'COMPLETED',
            exportVideoUrl: ossVideoUrl,
            exportError: null,
          },
        })
        const asset = await tx.asset.create({
          data: {
            userId,
            projectId,
            type: 'AI_GENERATED',
            url: ossVideoUrl,
            fileName: `happyhorse_merged_${projectId}.mp4`,
            fileSize,
            status: 'UPLOADED',
          },
        })
        // 14 天过期
        await setExpiry(asset.id)
      })

      // 更新最终结果到最后一个 GenerationJob
      const lastJob = await prisma.generationJob.findFirst({
        where: { projectId, engine: 'happyhorse', status: 'SUCCEEDED' },
        orderBy: { segmentIndex: 'desc' },
        select: { id: true },
      })
      if (lastJob) {
        await prisma.generationJob.update({
          where: { id: lastJob.id },
          data: { resultVideoUrl: ossVideoUrl },
        })
      }

      await job.updateProgress(100)
      void publishCompleted(userId, 'merge', projectId)
      console.log(`[merge-video] HappyHorse 合并完成: ${ossVideoUrl}`)
      return
    } finally {
      await cleanupTempDir(hhTempDir)
    }
  }
  // === 以下为 Seedance 原有合并逻辑 ===
  void publishStateChange(userId, 'merge', projectId, 'started', 0)

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
    void publishStateChange(userId, 'merge', projectId, 'merging', 40)
    const outputDir = path.join(process.cwd(), 'public', 'uploads', 'merged', userId, projectId)
    await mkdir(outputDir, { recursive: true })

    const outputFileName = `merged_${Date.now()}.mp4`
    const outputPath = path.join(outputDir, outputFileName)
    mergedOutputPath = outputPath

    await ffmpegConcat(segments, outputPath, outputAspectRatio, mergeResolution, projectId, tempDir)
    await job.updateProgress(85)

    console.log(`[merge-video] FFmpeg 合并完成: ${outputPath}`)

    // 2.5 背景音乐替换：检查 Project.bgmKey，若存在则用 FFmpeg 替换原音轨
    const projectForBgm = await prisma.project.findUnique({
      where: { id: projectId },
      select: { bgmKey: true, engine: true },
    })
    if (projectForBgm?.bgmKey && projectForBgm.engine === 'seedance') {
      console.log(`[merge-video] 检测到自定义背景音乐，替换原音轨: ${projectForBgm.bgmKey}`)
      const bgmLocalPath = path.join(tempDir, `bgm_${Date.now()}.mp3`)
      // 下载 BGM 到临时目录
      await resolveMediaUrlToLocal(
        (await import('@/lib/shared/storage')).getPublicUrl(projectForBgm.bgmKey),
        bgmLocalPath
      )
      // 替换音轨：保留视频流，用 BGM 替换音频流
      const bgmOutputPath = path.join(tempDir, `merged_bgm_${Date.now()}.mp4`)
      await new Promise<void>((resolve, reject) => {
        const proc = (require('child_process') as typeof import('child_process')).execFile(
          'ffmpeg',
          [
            '-y',
            '-i', outputPath,
            '-i', bgmLocalPath,
            '-map', '0:v',
            '-map', '1:a',
            '-c:v', 'copy',
            '-shortest',
            bgmOutputPath,
          ],
          { timeout: 120000 },
          (err) => { if (err) reject(err); else resolve() }
        )
        proc.on('error', reject)
      })
      // 用替换后的视频覆盖原输出
      const { copyFile } = await import('fs/promises')
      await copyFile(bgmOutputPath, outputPath)
      console.log(`[merge-video] 背景音乐替换完成`)
    }

    // 3. 上传合并视频到 OSS（Req 3）
    void publishStateChange(userId, 'merge', projectId, 'uploading', 85)
    const ossVideoUrl = await uploadMergedVideoToOSS(outputPath, userId, projectId)
    console.log(`[merge-video] 合并视频已上传到 OSS: ${ossVideoUrl}`)

    // 4. 导出超分分支决策：根据 targetResolution 决定后续流程
    const targetRes = job.data.targetResolution

    if (targetRes === '720p' || targetRes === '1080p') {
      // 超分流程：入队 videoUpscaleQueue，更新 exportStatus 为 UPSCALING
      const { videoUpscaleQueue } = await import('@/lib/shared/queue')
      await videoUpscaleQueue.add('upscale-video', {
        projectId,
        userId,
        mergedVideoOssUrl: ossVideoUrl,
        targetResolution: targetRes,
        reservedCredits: job.data.reservedCredits || 0,
        videoDuration: job.data.videoDuration || 0,
      })

      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'EXPORTED',
          exportStatus: 'UPSCALING',
        },
      })

      // 查询首个生成成功组的 genCoverUrl 更新封面
      const firstSucceededGroup = await prisma.shotGroup.findFirst({
        where: { projectId, genStatus: 'SUCCEEDED', genCoverUrl: { not: null } },
        orderBy: { groupIndex: 'asc' },
        select: { genCoverUrl: true },
      })
      if (firstSucceededGroup?.genCoverUrl) {
        await prisma.project.update({
          where: { id: projectId },
          data: { coverUrl: firstSucceededGroup.genCoverUrl },
        })
      }

      await job.updateProgress(100)
      console.log(`[merge-video] 项目 ${projectId} 合并完成，已入队超分任务 (${targetRes})`)
      void publishCompleted(userId, 'merge', projectId)

      return
    }

    // 非超分流程（480p 或无 targetResolution）：保持原有逻辑
    // 5. 在事务中创建 Asset + 更新项目状态（Req 3.2）
    // 合并成功后，将项目展示封面更新为首个生成成功组的 genCoverUrl（生成视频抽帧封面），
    // 使导出后的项目封面对应生成内容而非原始视频帧（Bug 2 修复 — Req 2.7）
    try {
      const { statSync } = await import('fs')
      const fileSize = statSync(outputPath).size

      // 查询首个生成成功组的 genCoverUrl 作为项目展示封面
      const firstSucceededGroup = await prisma.shotGroup.findFirst({
        where: { projectId, genStatus: 'SUCCEEDED', genCoverUrl: { not: null } },
        orderBy: { groupIndex: 'asc' },
        select: { genCoverUrl: true },
      })

      await prisma.$transaction(async (tx) => {
        // 更新项目状态为已导出 + 导出状态为完成，同时更新展示封面为生成视频封面
        await tx.project.update({
          where: { id: projectId },
          data: {
            status: 'EXPORTED',
            exportStatus: 'COMPLETED',
            exportVideoUrl: ossVideoUrl,
            exportError: null,
            ...(firstSucceededGroup?.genCoverUrl ? { coverUrl: firstSucceededGroup.genCoverUrl } : {}),
          },
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
    void publishCompleted(userId, 'merge', projectId)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '合并失败'
    console.error(`[merge-video] 项目 ${projectId} 合并失败:`, errorMessage)
    void publishFailed(userId, 'merge', projectId, errorMessage)

    // 合并失败时更新导出状态为 FAILED（720p/1080p 超分均免费，无需退还积分）
    const targetRes = job.data.targetResolution
    if (targetRes === '720p' || targetRes === '1080p') {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          exportStatus: 'FAILED',
          exportError: `视频合并失败: ${errorMessage}`,
        },
      })
    }

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
