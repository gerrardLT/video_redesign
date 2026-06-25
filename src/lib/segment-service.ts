/**
 * 视频分段服务
 * 负责将超过 15 秒的视频按场景切割点智能分段，用于 HappyHorse V-Edit 长视频处理。
 *
 * 核心算法：
 * 1. FFmpeg 场景检测获取所有切割候选点
 * 2. 贪心选择：从当前位置起，找到距离 15 秒最近的场景切割点作为下一个切割位置
 * 3. 若 15 秒窗口内无场景切割点，强制在 15 秒处切割
 * 4. 最后一段若 < 3 秒，并入前一段（避免生成过短片段被 API 拒绝）
 *
 * HappyHorse V-Edit 限制：
 * - 单次输入视频时长: 3-60 秒
 * - 单次输出视频时长: min(input, 15) 秒
 * - 故分段目标为每段 ≤ 15 秒且 ≥ 3 秒
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

/** HappyHorse V-Edit 单次输入最大时长 */
const MAX_SEGMENT_DURATION = 15

/** HappyHorse V-Edit 最小输入时长 */
const MIN_SEGMENT_DURATION = 3

/** 默认场景检测阈值（0-1，越小越敏感） */
const DEFAULT_SCENE_THRESHOLD = 0.3

/** 单个视频分段信息 */
export interface VideoSegment {
  /** 分段序号（0-based） */
  index: number
  /** 起始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 分段时长（秒） */
  duration: number
  /** 分段视频临时文件路径（裁切后赋值） */
  filePath?: string
}

/**
 * 使用 FFmpeg 场景检测获取视频中的场景切割候选点
 *
 * @param videoPath 视频文件路径
 * @param threshold 场景检测阈值（0-1，越小越敏感）
 * @returns 场景切割时间点列表（秒）
 */
export async function detectSceneCutPoints(
  videoPath: string,
  threshold: number = DEFAULT_SCENE_THRESHOLD
): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'frame=pts_time',
      '-of', 'csv=p=0',
      '-f', 'lavfi',
      `movie=${videoPath.replace(/\\/g, '/')},select='gt(scene\\,${threshold})'`,
    ])

    const cutPoints = stdout
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => parseFloat(line.trim()))
      .filter(t => !isNaN(t) && t > 0)
      .sort((a, b) => a - b)

    console.log(`[segment-service] 检测到 ${cutPoints.length} 个场景切割点`)
    return cutPoints
  } catch (error) {
    console.warn(`[segment-service] FFmpeg 场景检测失败，回退到均匀切割:`, error)
    return [] // 返回空数组，后续逻辑会回退到强制 15 秒切割
  }
}

/**
 * 智能分段：基于场景切割点将长视频分为 ≤15 秒且 ≥3 秒的片段
 *
 * 算法逻辑：
 * 1. 贪心选择：从当前位置起，寻找 (current, current + 15] 范围内最靠近 current+15 的切割点
 * 2. 若窗口内无切割点，强制在 current + 15 处切割
 * 3. 最后一段若 < 3 秒，并入前一段
 *
 * @param totalDuration 视频总时长（秒）
 * @param sceneCutPoints 场景切割候选点列表（已排序）
 * @returns 分段列表
 */
export function computeSegments(
  totalDuration: number,
  sceneCutPoints: number[]
): VideoSegment[] {
  // 短视频或无法有效分段的视频（≤ 18s）直接单段返回
  // HappyHorse API 支持 3-60 秒输入，只是单次输出上限 15 秒
  // 当 totalDuration ≤ 15+3=18 时，任何分段都会产生 < 3 秒的片段，不如直接单段
  if (totalDuration <= MAX_SEGMENT_DURATION + MIN_SEGMENT_DURATION) {
    return [{ index: 0, startTime: 0, endTime: totalDuration, duration: totalDuration }]
  }

  const segments: VideoSegment[] = []
  let currentPos = 0

  while (currentPos < totalDuration) {
    const remaining = totalDuration - currentPos

    // 剩余部分 ≤ 15 秒，直接作为最后一段
    if (remaining <= MAX_SEGMENT_DURATION) {
      segments.push({
        index: segments.length,
        startTime: currentPos,
        endTime: totalDuration,
        duration: remaining,
      })
      break
    }

    const maxEnd = currentPos + MAX_SEGMENT_DURATION

    // 特殊处理：remaining 在 (15, 18] 之间时，无法在 maxEnd 处切（余下 < 3 会并入导致超 15）
    // 此时在 remaining 的中点附近寻找切割点，确保两段都 >= 3
    if (remaining > MAX_SEGMENT_DURATION && remaining <= MAX_SEGMENT_DURATION + MIN_SEGMENT_DURATION) {
      const midPoint = currentPos + remaining / 2
      // 在中点附近寻找场景切割点
      const midCandidates = sceneCutPoints.filter(
        p => p > currentPos + MIN_SEGMENT_DURATION &&
             p < totalDuration - MIN_SEGMENT_DURATION
      )
      let cutAt = midPoint // 默认中点切
      if (midCandidates.length > 0) {
        cutAt = midCandidates.reduce((closest, p) =>
          Math.abs(p - midPoint) < Math.abs(closest - midPoint) ? p : closest
        )
      }
      // 确保两段都 >= MIN_SEGMENT_DURATION
      if (cutAt - currentPos < MIN_SEGMENT_DURATION) cutAt = currentPos + MIN_SEGMENT_DURATION
      if (totalDuration - cutAt < MIN_SEGMENT_DURATION) cutAt = totalDuration - MIN_SEGMENT_DURATION

      segments.push({
        index: segments.length,
        startTime: currentPos,
        endTime: cutAt,
        duration: cutAt - currentPos,
      })
      segments.push({
        index: segments.length,
        startTime: cutAt,
        endTime: totalDuration,
        duration: totalDuration - cutAt,
      })
      break
    }

    // 在 (currentPos, maxEnd] 范围内寻找合适的切割点
    // 切割点必须满足：产生的当前段 ≥ MIN_SEGMENT_DURATION，且剩余 ≥ MIN_SEGMENT_DURATION
    const candidatePoints = sceneCutPoints.filter(
      p => p > currentPos + MIN_SEGMENT_DURATION &&
           p <= maxEnd &&
           (totalDuration - p) >= MIN_SEGMENT_DURATION
    )

    let cutAt: number
    if (candidatePoints.length > 0) {
      // 选择距离 maxEnd 最近的切割点（尽量让每段接近 15 秒）
      cutAt = candidatePoints.reduce((closest, p) =>
        Math.abs(p - maxEnd) < Math.abs(closest - maxEnd) ? p : closest
      )
    } else {
      // 窗口内无合适切割点，强制在 maxEnd 处切割
      cutAt = maxEnd
    }

    // 切割后若剩余 < MIN_SEGMENT_DURATION，直接拉到 totalDuration（并入当前段）
    if (totalDuration - cutAt < MIN_SEGMENT_DURATION) {
      segments.push({
        index: segments.length,
        startTime: currentPos,
        endTime: totalDuration,
        duration: totalDuration - currentPos,
      })
      break
    }

    segments.push({
      index: segments.length,
      startTime: currentPos,
      endTime: cutAt,
      duration: cutAt - currentPos,
    })

    currentPos = cutAt
  }

  // 最后一段若 < 3 秒，并入前一段
  if (segments.length >= 2) {
    const lastSegment = segments[segments.length - 1]
    if (lastSegment.duration < MIN_SEGMENT_DURATION) {
      segments.pop()
      const mergedLast = segments[segments.length - 1]
      mergedLast.endTime = lastSegment.endTime
      mergedLast.duration = mergedLast.endTime - mergedLast.startTime
    }
  }

  // 重建 index
  segments.forEach((seg, i) => { seg.index = i })

  return segments
}

/**
 * 智能分段入口：检测场景 + 计算分段
 *
 * @param videoPath 视频文件本地路径（已下载到临时目录）
 * @param totalDuration 视频总时长（秒）
 * @param options 可选参数
 * @returns 分段列表
 */
export async function segmentVideo(
  videoPath: string,
  totalDuration: number,
  options?: { sceneThreshold?: number }
): Promise<VideoSegment[]> {
  console.log(`[segment-service] 开始分段 - 总时长: ${totalDuration}s, 阈值: ${options?.sceneThreshold || DEFAULT_SCENE_THRESHOLD}`)

  // 检测场景切割点
  const sceneCutPoints = await detectSceneCutPoints(
    videoPath,
    options?.sceneThreshold || DEFAULT_SCENE_THRESHOLD
  )

  // 计算分段
  const segments = computeSegments(totalDuration, sceneCutPoints)

  console.log(`[segment-service] 分段完成 - ${segments.length} 段: [${segments.map(s => `${s.duration.toFixed(1)}s`).join(', ')}]`)
  return segments
}

/**
 * 按分段列表将视频裁切为多个临时文件
 * 使用 FFmpeg -ss/-to 精确裁切，-c copy 不重新编码
 *
 * @param videoPath 原视频文件本地路径
 * @param segments 分段列表
 * @param outputDir 输出目录路径
 * @returns 更新了 filePath 的分段列表
 */
export async function cutVideoSegments(
  videoPath: string,
  segments: VideoSegment[],
  outputDir: string
): Promise<VideoSegment[]> {
  // 确保输出目录存在
  await fs.mkdir(outputDir, { recursive: true })

  const results: VideoSegment[] = []

  for (const segment of segments) {
    const outputPath = path.join(outputDir, `segment_${segment.index}.mp4`)

    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', segment.startTime.toString(),
      '-to', segment.endTime.toString(),
      '-i', videoPath,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputPath,
    ])

    results.push({
      ...segment,
      filePath: outputPath,
    })

    console.log(`[segment-service] 裁切分段 ${segment.index}/${segments.length - 1}: [${segment.startTime.toFixed(1)}s - ${segment.endTime.toFixed(1)}s] → ${outputPath}`)
  }

  return results
}

/**
 * 将多个生成后的视频段合并为完整视频
 * 使用 FFmpeg concat demuxer 无损拼接
 *
 * @param segmentPaths 各段视频文件路径（按顺序）
 * @param outputPath 输出合并视频路径
 */
export async function mergeSegments(
  segmentPaths: string[],
  outputPath: string
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error('[segment-service] mergeSegments: 分段列表为空')
  }

  if (segmentPaths.length === 1) {
    // 只有一段，直接复制
    await fs.copyFile(segmentPaths[0], outputPath)
    return
  }

  // 生成 concat 文件列表
  const concatDir = path.dirname(outputPath)
  const concatListPath = path.join(concatDir, `concat_list_${Date.now()}.txt`)

  const concatContent = segmentPaths
    .map(p => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n')

  await fs.writeFile(concatListPath, concatContent, 'utf-8')

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      outputPath,
    ])

    console.log(`[segment-service] 合并完成 - ${segmentPaths.length} 段 → ${outputPath}`)
  } finally {
    // 清理临时 concat 文件
    await fs.unlink(concatListPath).catch(() => {})
  }
}
