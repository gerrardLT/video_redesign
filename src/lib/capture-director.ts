/**
 * 拍摄指导与质量检测服务（Capture Director）
 *
 * 职责：
 * 1. 检测上传素材的质量（分辨率、时长、方向、亮度、音轨等）
 * 2. 根据各维度权重计算综合质量评分
 * 3. 标记致命问题（分辨率过低、时长不足、文件过大）
 * 4. 输出中文日常用语的 warning 提示
 *
 * FFmpeg 命令使用 child_process.execFile（不用 shell 执行），超时 10s。
 * 超时或崩溃返回 inconclusive 结果（Req 6.7）。
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'

import { QUALITY_WEIGHTS, QUALITY_THRESHOLDS } from '@/constants/merchant'
import type { QualityInspectionResult, QualityDimensionResult, ShotTaskType } from '@/types/merchant'

const execFileAsync = promisify(execFile)

/** FFmpeg 处理超时（毫秒）— Req 6.1 要求 10 秒内完成 */
const FFMPEG_TIMEOUT_MS = 10_000

// ========================
// 内部辅助类型
// ========================

interface FFprobeStreamInfo {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
  r_frame_rate?: string
  channels?: number
  sample_rate?: string
}

interface FFprobeResult {
  streams?: FFprobeStreamInfo[]
  format?: {
    duration?: string
    size?: string
    nb_streams?: number
  }
}

// ========================
// 主入口函数
// ========================

/**
 * 检测上传素材质量
 *
 * 流程：
 * 1. 用 ffprobe 提取元数据（duration, width, height, codec, audio streams）
 * 2. 计算 fileSize（fs.stat）
 * 3. 用 ffmpeg signalstats 检测亮度
 * 4. 逐维度评分：每维度满分为其权重值，通过得满分，不通过得 0
 * 5. 总分 = 各维度得分之和
 * 6. passed = qualityScore >= 60 && !critical
 * 7. critical = resolution短边 < 480 || duration < 1 || fileSize > 300MB
 *
 * @param input.filePath  本地临时文件路径
 * @param input.mimeType  文件 MIME 类型
 * @param input.shotTask  关联的拍摄任务信息
 */
export async function inspectRawAsset(input: {
  filePath: string
  mimeType: string
  shotTask: { durationSec: number; type: ShotTaskType; required: boolean }
}): Promise<QualityInspectionResult> {
  const { filePath, shotTask } = input

  try {
    // 并行获取元数据、文件大小、亮度
    const [probeData, fileSizeBytes, avgBrightness] = await Promise.all([
      extractMetadata(filePath),
      getFileSize(filePath),
      detectBrightness(filePath),
    ])

    // 解析元数据
    const videoStream = probeData.streams?.find(s => s.codec_type === 'video')
    const audioStream = probeData.streams?.find(s => s.codec_type === 'audio')
    const width = videoStream?.width ?? 0
    const height = videoStream?.height ?? 0
    const duration = parseFloat(probeData.format?.duration ?? videoStream?.duration ?? '0')
    const hasAudio = !!audioStream

    // 计算短边
    const shortEdge = Math.min(width, height)

    // 逐维度评估
    const orientationResult = evaluateOrientation(width, height)
    const resolutionResult = evaluateResolution(shortEdge)
    const durationResult = evaluateDuration(duration, shotTask.durationSec)
    const fileSizeResult = evaluateFileSize(fileSizeBytes)
    const brightnessResult = evaluateBrightness(avgBrightness)
    const audioResult = evaluateAudio(hasAudio, shotTask.type)

    // 计算总分
    const qualityScore =
      (orientationResult.pass ? QUALITY_WEIGHTS.orientation : 0) +
      (resolutionResult.pass ? QUALITY_WEIGHTS.resolution : 0) +
      (durationResult.pass ? QUALITY_WEIGHTS.duration : 0) +
      (fileSizeResult.pass ? QUALITY_WEIGHTS.fileSize : 0) +
      (brightnessResult.pass ? QUALITY_WEIGHTS.brightness : 0) +
      (audioResult.pass ? QUALITY_WEIGHTS.audio : 0)

    // 判定致命条件
    const critical =
      shortEdge < QUALITY_THRESHOLDS.criticalResolutionShortEdge ||
      duration < QUALITY_THRESHOLDS.minDuration ||
      fileSizeBytes > QUALITY_THRESHOLDS.maxFileSize

    // 判定是否通过
    const passed = qualityScore >= QUALITY_THRESHOLDS.qualityPassScore && !critical

    // 收集警告
    const warnings: string[] = []
    if (!orientationResult.pass && orientationResult.message) {
      warnings.push(orientationResult.message)
    }
    if (!resolutionResult.pass && resolutionResult.message) {
      warnings.push(resolutionResult.message)
    }
    if (!durationResult.pass && durationResult.message) {
      warnings.push(durationResult.message)
    }
    if (!fileSizeResult.pass && fileSizeResult.message) {
      warnings.push(fileSizeResult.message)
    }
    if (!brightnessResult.pass && brightnessResult.message) {
      warnings.push(brightnessResult.message)
    }
    if (!audioResult.pass && audioResult.message) {
      warnings.push(audioResult.message)
    }

    return {
      qualityScore,
      passed,
      critical,
      report: {
        orientation: orientationResult,
        resolution: resolutionResult,
        duration: durationResult,
        fileSize: fileSizeResult,
        brightness: brightnessResult,
        audio: audioResult,
      },
      warnings,
    }
  } catch (error) {
    // 超时或崩溃返回 inconclusive 结果（Req 6.7）
    const reason = error instanceof Error ? error.message : '未知错误'
    return buildInconclusiveResult(reason)
  }
}

// ========================
// FFmpeg/FFprobe 命令调用
// ========================

/**
 * 用 ffprobe 提取视频元数据
 * 命令: ffprobe -v quiet -print_format json -show_streams -show_format {file}
 */
async function extractMetadata(filePath: string): Promise<FFprobeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { timeout: FFMPEG_TIMEOUT_MS })

  return JSON.parse(stdout) as FFprobeResult
}

/**
 * 获取文件大小（字节）
 */
async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath)
  return stats.size
}

/**
 * 用 ffmpeg signalstats 检测平均亮度
 * 命令: ffmpeg -i {file} -vf "fps=1,signalstats" -f null -
 * 从 stderr 中提取 YAVG 值取平均
 */
async function detectBrightness(filePath: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-vf', 'fps=1,signalstats',
      '-f', 'null',
      '-',
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })

    // 从 stderr 解析所有 YAVG 值
    const yavgMatches = stderr.matchAll(/YAVG:([\d.]+)/g)
    const values: number[] = []
    for (const match of yavgMatches) {
      const val = parseFloat(match[1])
      if (Number.isFinite(val)) {
        values.push(val)
      }
    }

    if (values.length === 0) {
      // 无法检测亮度，给予默认通过值
      return 128
    }

    // 取所有采样帧的平均亮度
    return values.reduce((sum, v) => sum + v, 0) / values.length
  } catch {
    // 亮度检测失败不阻断，给予默认通过值
    return 128
  }
}

// ========================
// 各维度评估函数
// ========================

/** 评估画面方向：height > width 为竖屏通过 */
function evaluateOrientation(width: number, height: number): QualityDimensionResult {
  const isVertical = height > width
  const value = isVertical ? '竖屏' : '横屏'

  if (isVertical) {
    return { value, pass: true }
  }
  return {
    value,
    pass: false,
    message: '请竖着拍，手机竖起来再录一次',
  }
}

/** 评估分辨率：短边 ≥ 720px 通过，< 480px 致命 */
function evaluateResolution(shortEdge: number): QualityDimensionResult {
  const value = `${shortEdge}px`

  if (shortEdge >= QUALITY_THRESHOLDS.minResolutionShortEdge) {
    return { value, pass: true }
  }

  if (shortEdge < QUALITY_THRESHOLDS.criticalResolutionShortEdge) {
    return {
      value,
      pass: false,
      message: '画质太低了，请把手机相机设置调到最高清再拍',
    }
  }

  return {
    value,
    pass: false,
    message: '画质不够清晰，建议调高相机分辨率再拍一次',
  }
}

/** 评估时长：shotTask.durationSec ±50% 为通过，< 1s 致命 */
function evaluateDuration(actualDuration: number, targetDuration: number): QualityDimensionResult {
  const value = actualDuration

  if (actualDuration < QUALITY_THRESHOLDS.minDuration) {
    return {
      value,
      pass: false,
      message: '视频太短了，至少要拍 1 秒以上',
    }
  }

  const minDuration = targetDuration * 0.5
  const maxDuration = targetDuration * 1.5

  if (actualDuration >= minDuration && actualDuration <= maxDuration) {
    return { value, pass: true }
  }

  if (actualDuration < minDuration) {
    return {
      value,
      pass: false,
      message: `拍的时间太短了，建议拍 ${targetDuration} 秒左右`,
    }
  }

  return {
    value,
    pass: false,
    message: `拍的时间太长了，建议控制在 ${targetDuration} 秒左右`,
  }
}

/** 评估文件大小：1B ~ 300MB 通过，> 300MB 致命 */
function evaluateFileSize(sizeBytes: number): QualityDimensionResult {
  const value = sizeBytes

  if (sizeBytes > QUALITY_THRESHOLDS.maxFileSize) {
    return {
      value,
      pass: false,
      message: '文件太大了，超过 300MB 没办法处理，建议缩短时长或降低画质',
    }
  }

  if (sizeBytes >= 1) {
    return { value, pass: true }
  }

  return {
    value,
    pass: false,
    message: '文件是空的，请重新拍一个',
  }
}

/** 评估平均亮度：> 15 通过 */
function evaluateBrightness(avgBrightness: number): QualityDimensionResult {
  const value = avgBrightness

  if (avgBrightness > QUALITY_THRESHOLDS.minBrightness) {
    return { value, pass: true }
  }

  return {
    value,
    pass: false,
    message: '画面太暗了，找个光线好的地方再拍一次',
  }
}

/** 评估音轨：有音轨通过；OWNER_TALKING 类型必须有音轨 */
function evaluateAudio(hasAudio: boolean, shotType: ShotTaskType): QualityDimensionResult {
  const value = hasAudio

  if (hasAudio) {
    return { value, pass: true }
  }

  // OWNER_TALKING 类型必须有音轨
  if (shotType === 'OWNER_TALKING') {
    return {
      value,
      pass: false,
      message: '这个镜头需要你说话，没录到声音，请开麦重新录一次',
    }
  }

  // 其他类型有音轨加分，无音轨不通过但不致命
  return {
    value,
    pass: false,
    message: '没录到声音，建议开启麦克风录制',
  }
}

// ========================
// Inconclusive 结果构建
// ========================

/**
 * 构建 inconclusive 结果 — 超时或 FFmpeg 崩溃时返回（Req 6.7）
 */
function buildInconclusiveResult(reason: string): QualityInspectionResult {
  const inconclusiveDimension: QualityDimensionResult = {
    value: '检测失败',
    pass: false,
    message: '检测过程出了问题，请重新上传试试',
  }

  return {
    qualityScore: 0,
    passed: false,
    critical: false,
    report: {
      orientation: inconclusiveDimension,
      resolution: inconclusiveDimension,
      duration: inconclusiveDimension,
      fileSize: inconclusiveDimension,
      brightness: inconclusiveDimension,
      audio: inconclusiveDimension,
    },
    warnings: [`质量检测未完成：${reason}，请重新上传试试`],
  }
}
