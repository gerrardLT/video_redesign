/**
 * FFmpeg 命令封装
 * 提供视频抽帧、音频抽取、元数据获取功能
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { mkdir, readdir } from 'fs/promises'

const execFileAsync = promisify(execFile)

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps: number
}

export interface ExtractFramesResult {
  frames: Array<{ path: string; timestamp: number; isSceneChange: boolean }> // 带时间戳和场景标记的帧
  count: number
}

/**
 * 从视频中提取关键帧：场景主导 + 长镜补偿（方案 3）
 *
 * 策略：
 * 1. FFmpeg scene detection 找出所有场景切换点（带精确 pts_time）
 * 2. 每个场景至少保留首帧；场景时长 >3s 的在内部按间隔补帧
 * 3. 总帧数控制在 maxFrames 以内
 * 4. 每帧返回精确时间戳
 *
 * 如果场景检测失败或结果不足，回退到均匀采样。
 *
 * @param videoPath 视频文件绝对路径
 * @param outputDir 帧图片输出目录
 * @param intervalSeconds 长镜头内部补帧间隔（秒），默认 2
 * @param options 可选参数
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 2,
  options?: {
    /** 场景变化阈值 0-1，默认 0.32 */
    sceneThreshold?: number
    /** 场景内补帧的最小场景时长（秒），默认 3 */
    intrasceneMinDuration?: number
    /** 最大帧数上限，默认 20 */
    maxFrames?: number
  }
): Promise<ExtractFramesResult> {
  await mkdir(outputDir, { recursive: true })

  const threshold = options?.sceneThreshold ?? 0.32
  const intrasceneMin = options?.intrasceneMinDuration ?? 3
  const maxFrames = options?.maxFrames ?? 20

  // ====== Step 1: 场景检测，获取切换点时间戳 ======
  let sceneTimestamps: number[] = []
  try {
    const metadataFile = path.join(outputDir, '_scene_meta.txt')
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-filter_complex', `select='gt(scene,${threshold})',metadata=print:file=${metadataFile}`,
      '-an', '-f', 'null', '-',
    ], { timeout: 60000 })

    // 解析 metadata 文件提取 pts_time
    const { readFile: readFileAsync } = await import('fs/promises')
    const metaContent = await readFileAsync(metadataFile, 'utf-8').catch(() => '')
    const ptsMatches = metaContent.matchAll(/pts_time:([\d.]+)/g)
    for (const match of ptsMatches) {
      sceneTimestamps.push(parseFloat(match[1]))
    }
    // 始终包含 0s 作为第一个切换点
    if (sceneTimestamps.length === 0 || sceneTimestamps[0] > 0.5) {
      sceneTimestamps.unshift(0)
    }
    sceneTimestamps.sort((a, b) => a - b)
  } catch {
    // 场景检测失败，后续走回退逻辑
    console.warn('[ffmpeg] 场景检测失败，回退到均匀采样')
    sceneTimestamps = []
  }

  // ====== Step 2: 获取视频总时长 ======
  let totalDuration = 0
  try {
    const meta = await getVideoMetadata(videoPath)
    totalDuration = meta.duration
  } catch {
    totalDuration = 120 // 兜底
  }

  // ====== Step 3: 计算要提取的时间点列表 ======
  let targetTimestamps: Array<{ timestamp: number; isSceneChange: boolean }> = []

  if (sceneTimestamps.length >= 2) {
    // 场景检测成功：场景主导 + 长镜补偿
    for (let i = 0; i < sceneTimestamps.length; i++) {
      const sceneStart = sceneTimestamps[i]
      const sceneEnd = i < sceneTimestamps.length - 1 ? sceneTimestamps[i + 1] : totalDuration
      const sceneDuration = sceneEnd - sceneStart

      // 场景首帧（标记为场景切换）
      targetTimestamps.push({ timestamp: sceneStart, isSceneChange: true })

      // 长镜头内部补帧（场景时长 > intrasceneMin 时）
      if (sceneDuration > intrasceneMin) {
        const numIntraFrames = Math.floor(sceneDuration / intervalSeconds) - 1
        for (let j = 1; j <= numIntraFrames && j * intervalSeconds + sceneStart < sceneEnd - 0.5; j++) {
          targetTimestamps.push({
            timestamp: sceneStart + j * intervalSeconds,
            isSceneChange: false,
          })
        }
      }
    }
  } else {
    // 回退：纯均匀采样（场景检测失败或静态视频）
    const numFrames = Math.min(maxFrames, Math.ceil(totalDuration / intervalSeconds))
    for (let i = 0; i < numFrames; i++) {
      targetTimestamps.push({
        timestamp: i * intervalSeconds,
        isSceneChange: i === 0,
      })
    }
  }

  // 去重（时间戳相差 <0.5s 的合并）并按时间排序
  targetTimestamps.sort((a, b) => a.timestamp - b.timestamp)
  const deduped: Array<{ timestamp: number; isSceneChange: boolean }> = []
  for (const t of targetTimestamps) {
    if (deduped.length === 0 || t.timestamp - deduped[deduped.length - 1].timestamp >= 0.5) {
      deduped.push(t)
    } else if (t.isSceneChange) {
      // 如果新帧是场景切换点，优先保留它（替换附近的非场景帧）
      deduped[deduped.length - 1] = t
    }
  }
  targetTimestamps = deduped.slice(0, maxFrames)

  // ====== Step 4: 按时间点逐帧提取 ======
  const frames: Array<{ path: string; timestamp: number; isSceneChange: boolean }> = []

  for (let i = 0; i < targetTimestamps.length; i++) {
    const { timestamp, isSceneChange } = targetTimestamps[i]
    const outputPath = path.join(outputDir, `frame_${String(i).padStart(4, '0')}.jpg`)

    try {
      await execFileAsync('ffmpeg', [
        '-ss', String(timestamp),
        '-i', videoPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ], { timeout: 10000 })

      frames.push({ path: outputPath, timestamp, isSceneChange })
    } catch {
      // 单帧提取失败跳过，不中断
      console.warn(`[ffmpeg] 提取 @${timestamp.toFixed(1)}s 帧失败，跳过`)
    }
  }

  if (frames.length === 0) {
    throw new Error('抽帧失败：未能提取任何帧')
  }

  return { frames, count: frames.length }
}

/**
 * 从视频中抽取音频流
 * @param videoPath 视频文件绝对路径
 * @param outputPath 音频文件输出路径（支持 .mp3 / .wav）
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string
): Promise<string> {
  const ext = path.extname(outputPath).toLowerCase()
  const codecArgs = ext === '.wav'
    ? ['-acodec', 'pcm_s16le']
    : ['-acodec', 'libmp3lame', '-q:a', '4']

  try {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vn',
      ...codecArgs,
      '-y',
      outputPath,
    ])
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知 FFmpeg 错误'
    throw new Error(`音频抽取失败: ${message}`)
  }

  return outputPath
}

/**
 * 获取视频元数据（时长、分辨率、帧率）
 * @param videoPath 视频文件绝对路径
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      videoPath,
    ])

    const data = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string
        width?: number
        height?: number
        r_frame_rate?: string
      }>
      format?: {
        duration?: string
      }
    }

    const videoStream = data.streams?.find(s => s.codec_type === 'video')

    // 解析帧率字符串（如 "30/1" 或 "24000/1001"）
    let fps = 0
    if (videoStream?.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/')
      if (parts.length === 2) {
        const numerator = parseFloat(parts[0])
        const denominator = parseFloat(parts[1])
        fps = denominator !== 0 ? numerator / denominator : 0
      } else {
        fps = parseFloat(parts[0]) || 0
      }
    }

    return {
      duration: parseFloat(data.format?.duration || '0'),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: Math.round(fps * 100) / 100,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知 ffprobe 错误'
    throw new Error(`获取视频元数据失败: ${message}`)
  }
}

/**
 * 检测视频中的真实剪辑点（场景切换时间戳）
 *
 * 使用 FFmpeg scene detection filter 检测画面突变点。
 * 返回时间戳数组（秒），每个时间戳代表一个真实的剪辑/转场发生点。
 * 如果返回空数组，说明视频是「一镜到底」（无剪辑点）。
 *
 * @param videoPath 视频文件绝对路径
 * @param threshold 场景变化阈值 0-1，默认使用环境变量 SCENE_THRESHOLD 或 0.32
 * @returns 剪辑点时间戳数组（秒），不含视频起点 0
 */
export async function detectSceneCuts(
  videoPath: string,
  threshold?: number
): Promise<number[]> {
  const sceneThreshold = threshold ?? parseFloat(process.env.SCENE_THRESHOLD || '0.32')
  console.log(`[ffmpeg] 开始场景剪辑点检测 - threshold: ${sceneThreshold}, file: ${videoPath}`)

  try {
    // 使用 showinfo filter 配合 scene 检测，输出到 stderr
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-filter:v', `select='gt(scene,${sceneThreshold})',showinfo`,
      '-an', '-f', 'null', '-',
    ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 })

    // 从 stderr 中解析 pts_time
    const timestamps: number[] = []
    const ptsMatches = stderr.matchAll(/pts_time:([\d.]+)/g)
    for (const match of ptsMatches) {
      const t = parseFloat(match[1])
      if (Number.isFinite(t) && t > 0.5) {
        timestamps.push(Math.round(t * 100) / 100)
      }
    }

    // 去重（相隔 <0.5s 的合并）
    const deduped: number[] = []
    for (const t of timestamps.sort((a, b) => a - b)) {
      if (deduped.length === 0 || t - deduped[deduped.length - 1] >= 0.5) {
        deduped.push(t)
      }
    }

    console.log(`[ffmpeg] 场景检测完成 - 检测到 ${deduped.length} 个剪辑点${deduped.length > 0 ? ': ' + deduped.map(t => t.toFixed(2) + 's').join(', ') : '（一镜到底）'}`)
    return deduped
  } catch (error) {
    // 场景检测失败不阻塞主流程，返回空数组（等同于一镜到底）
    console.warn('[ffmpeg] 场景剪辑点检测失败，视为一镜到底:', error instanceof Error ? error.message : String(error))
    return []
  }
}

/**
 * 视频 Normalize 预处理：统一编码为 h264/yuv420p，消除可变帧率/HEVC 兼容性问题
 * @param inputPath 原始视频路径
 * @param outputPath 输出 normalized 视频路径
 */
export async function normalizeVideo(inputPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-r', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 300000 }) // 5分钟超时
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知 FFmpeg 错误'
    throw new Error(`视频 Normalize 失败: ${message}`)
  }
}

/**
 * 从视频中提取关键帧（带质量过滤）
 * 基于 extractFrames 的场景主导 + 长镜补偿策略，等效于带质量过滤的抽帧
 *
 * @param videoPath 视频文件绝对路径
 * @param outputDir 帧图片输出目录
 * @param intervalSeconds 长镜头内部补帧间隔（秒）
 * @param options 可选参数
 */
export async function extractFramesWithQualityFilter(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number,
  options?: {
    maxFrames?: number
    sceneThreshold?: number
  }
): Promise<ExtractFramesResult> {
  return extractFrames(videoPath, outputDir, intervalSeconds, {
    maxFrames: options?.maxFrames ?? 20,
    sceneThreshold: options?.sceneThreshold ?? 0.32,
  })
}
