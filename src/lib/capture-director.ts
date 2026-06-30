/**
 * 拍摄指导与质量检测服务（Capture Director）
 *
 * 职责：
 * 1. 检测上传素材的质量（分辨率、时长、方向、亮度、音轨等）
 * 2. 根据各维度权重计算综合质量评分
 * 3. 标记致命问题（分辨率过低、时长不足、文件过大）
 * 4. 输出中文日常用语的 warning 提示
 * 5. 拍摄前可视化引导（buildCaptureGuide）：把构图/清单/量化阈值结构化输出，让小白老板拍之前就知道达标条件（需求 3.1-3.3, 3.6）
 * 6. 质检失败后的重拍建议（buildReshootAdvice）：仅针对未通过维度产出具体重拍话术，反哺下一次拍摄（需求 3.4）
 * 7. 镜头参考图生成（generateShotReferenceImage）：复用 Flux 文生图，按门店画像+镜头脚本生成对照参考画面，消耗积分（需求 3.5）
 *
 * FFmpeg 命令使用 child_process.execFile（不用 shell 执行），超时 10s。
 * 超时或崩溃返回 inconclusive 结果（Req 6.7）。
 */

import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { promisify } from 'util'
import { stat } from 'fs/promises'

import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/api-error'
import { getBalance } from '@/lib/credit-service'
import {
  reserveMerchantCredits,
  chargeMerchantCredits,
  refundMerchantCredits,
} from '@/lib/merchant-billing-service'
import { generateFirstFrame } from '@/lib/flux'
import {
  QUALITY_WEIGHTS,
  QUALITY_THRESHOLDS,
  CREDIT_COST_SHOT_REFERENCE_IMAGE,
} from '@/constants/merchant'
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

// ========================
// 拍摄前可视化引导（需求 3.1, 3.2, 3.3, 3.6）
// ========================

/**
 * buildCaptureGuide 入参所需的 ShotTask 字段子集。
 *
 * 仅取构建引导必要字段，避免与 Prisma 完整模型耦合；调用方（API 层）按需装配。
 */
export interface ShotTaskWithGuide {
  /** 镜头类型，用于推导默认构图与是否需口播音轨 */
  type: ShotTaskType
  /** 镜头标题（日常用语） */
  title: string
  /** 拍摄说明（日常用语） */
  instruction: string
  /** 该镜头设定的目标时长（秒），决定时长达标区间 */
  durationSec: number
  /** 取景指导：{ angle, movement, tips }，可空 */
  framingGuide?: Record<string, unknown> | null
  /** 质量要求：{ needsAudio, minBrightness }，可空 */
  qualityRules?: Record<string, unknown> | null
  /** 已生成的参考图/示例片段 URL（若有），由调用方填充；无则为空数组 */
  referenceUrls?: string[]
}

/** 拍摄前可视化引导结构（前端据此绘制） */
export interface CaptureGuide {
  /** 构图示意：竖屏框 + 主体位置（结构化，前端绘制） */
  framing: { aspect: '9:16'; subjectPosition: string; movement: string }
  /** 参考图/示例片段 URL（若已生成） */
  referenceUrls: string[]
  /** 关键要点清单（日常语言，小白默认全展开） */
  checklist: string[]
  /** 硬性质检阈值（量化、可判定）—— 需求 3.3，固定取值 */
  qualityThresholds: {
    /** 竖屏 9:16：宽高比 0.5625，允许 ±2% 偏差 */
    aspectRatio: { target: 0.5625; tolerancePct: 2 }
    /** 短边分辨率 ≥720p */
    minShortSidePx: 720
    /** 时长达标区间（秒），来源于该 ShotTask 设定的目标时长 */
    durationSec: { min: number; max: number }
    /** 亮度直方图均值 0-255，≥60 */
    minAvgBrightness: 60
    /** 是否需口播音轨 */
    needsAudio: boolean
  }
  /** 用通俗语言转述的达标条件（不暴露技术术语） */
  plainLanguageTips: string[]
}

/**
 * 各镜头类型的默认构图与运镜（日常用语，不暴露技术术语）。
 * framingGuide 缺省时回退到这里，保证小白老板拿到具体可照做的指引。
 */
const SHOT_TYPE_FRAMING: Record<ShotTaskType, { subjectPosition: string; movement: string }> = {
  STOREFRONT: { subjectPosition: '把门头招牌放在画面正中间，能看清店名', movement: '从门口慢慢往前靠近' },
  PRODUCT_CLOSEUP: { subjectPosition: '产品放正中间，占到画面的三分之二', movement: '镜头慢慢推近产品' },
  COOKING_PROCESS: { subjectPosition: '锅灶和手上的动作放在画面中间', movement: '跟着翻炒/出锅动作小幅移动' },
  STAFF_ACTION: { subjectPosition: '把员工的动作放在画面中间', movement: '镜头端稳，轻微跟随就好' },
  CUSTOMER_REACTION: { subjectPosition: '顾客的表情放在画面上半部分', movement: '镜头端稳别晃' },
  OWNER_TALKING: { subjectPosition: '老板上半身放画面中间，眼睛看着镜头', movement: '镜头固定，别晃动' },
  ENVIRONMENT: { subjectPosition: '把店里的环境尽量拍全', movement: '镜头缓缓平移扫过店内' },
  OFFER_DISPLAY: { subjectPosition: '优惠价格牌放正中间，数字要清楚', movement: '镜头固定对准价格' },
  CTA_SCREEN: { subjectPosition: '二维码或联系方式放画面中间', movement: '镜头固定别晃' },
  AI_GENERATED_FILLER: { subjectPosition: '主体放画面中间', movement: '镜头平稳' },
}

/** 时长达标区间相对目标时长的容差比例，与 evaluateDuration（±50%）保持一致 */
const DURATION_TOLERANCE = 0.5

/**
 * 从 framingGuide JSON 中安全读取字符串字段，缺失/类型不符返回 undefined。
 */
function readGuideString(guide: Record<string, unknown> | null | undefined, key: string): string | undefined {
  if (!guide) return undefined
  const val = guide[key]
  return typeof val === 'string' && val.trim() ? val.trim() : undefined
}

/**
 * 生成某 ShotTask 的拍摄前可视化引导（需求 3.1, 3.2, 3.3, 3.6）。
 *
 * - 将 framingGuide 结构化为可视化构图（竖屏框 + 主体位置 + 运镜），缺省按镜头类型给默认；
 * - 明示固定量化质检阈值（可解释）：宽高比 0.5625(±2%)、短边 ≥720、亮度均值 ≥60；
 *   时长区间来源于该 ShotTask 设定的目标时长（±50%，与质检 evaluateDuration 口径一致）；
 * - 是否需口播音轨：qualityRules.needsAudio 优先，缺省时 OWNER_TALKING 类型需要音轨；
 * - checklist / plainLanguageTips 用日常语言转述，小白老板默认全展开、不暴露技术术语。
 *
 * 纯计算，不消耗积分。
 */
export function buildCaptureGuide(input: { shotTask: ShotTaskWithGuide }): CaptureGuide {
  const { shotTask } = input
  const defaults = SHOT_TYPE_FRAMING[shotTask.type] ?? SHOT_TYPE_FRAMING.AI_GENERATED_FILLER

  // 构图：framingGuide 优先，缺省按镜头类型回退
  const subjectPosition =
    readGuideString(shotTask.framingGuide, 'angle') ||
    readGuideString(shotTask.framingGuide, 'tips') ||
    defaults.subjectPosition
  const movement =
    readGuideString(shotTask.framingGuide, 'movement') || defaults.movement

  // 是否需口播音轨：qualityRules.needsAudio 优先；缺省时老板口播类镜头需要音轨
  const qualityRules = shotTask.qualityRules
  const needsAudioRaw = qualityRules ? qualityRules['needsAudio'] : undefined
  const needsAudio =
    typeof needsAudioRaw === 'boolean' ? needsAudioRaw : shotTask.type === 'OWNER_TALKING'

  // 时长达标区间：来源于该 ShotTask 设定的目标时长（±50%，与质检口径一致）
  const target = shotTask.durationSec
  const durationMin = Math.round(target * (1 - DURATION_TOLERANCE) * 10) / 10
  const durationMax = Math.round(target * (1 + DURATION_TOLERANCE) * 10) / 10

  // 关键要点清单（日常语言，小白默认全展开）
  const checklist: string[] = [
    `${subjectPosition}`,
    `运镜：${movement}`,
    '手机竖着拍，画面要竖的',
    '找个亮堂的地方，别让画面发暗',
    `时长拍 ${target} 秒左右（${durationMin}~${durationMax} 秒之间都行）`,
    needsAudio ? '记得开麦克风，要录上你说话的声音' : '这个镜头不录声音也可以',
  ]
  if (shotTask.instruction?.trim()) {
    checklist.push(`拍摄要点：${shotTask.instruction.trim()}`)
  }

  // 用通俗语言转述达标条件（不暴露技术术语：不出现「宽高比/分辨率/亮度直方图」等）
  const plainLanguageTips: string[] = [
    '手机竖起来拍，别横过来',
    '相机调到最清晰再拍（手机选 1080p 或 720p 都行），画面别糊',
    `这个镜头拍 ${target} 秒左右就行，太短太长都不合适`,
    '挑个光线好的位置，画面要亮堂、看得清',
    needsAudio ? '开着麦克风，把你说的话录清楚' : '声音不是必须的，画面拍好就行',
  ]

  return {
    framing: { aspect: '9:16', subjectPosition, movement },
    referenceUrls: shotTask.referenceUrls ?? [],
    checklist,
    qualityThresholds: {
      aspectRatio: { target: 0.5625, tolerancePct: 2 },
      minShortSidePx: 720,
      durationSec: { min: durationMin, max: durationMax },
      minAvgBrightness: 60,
      needsAudio,
    },
    plainLanguageTips,
  }
}

// ========================
// 质检失败重拍建议（需求 3.4）
// ========================

/** 单条重拍建议 */
export interface ReshootAdvice {
  /** 失败维度（仅覆盖可通过重拍纠正的 5 个维度，文件过大非重拍问题故不含 fileSize） */
  dimension: 'orientation' | 'resolution' | 'duration' | 'brightness' | 'audio'
  /** 失败时的实测值（字符串化，供前端展示） */
  failedValue: string
  /** 具体重拍建议（日常用语，可反哺下一次拍摄） */
  advice: string
}

/** buildReshootAdvice 覆盖的维度（与 ReshootAdvice.dimension 一致，不含 fileSize） */
const RESHOOT_DIMENSIONS: ReshootAdvice['dimension'][] = [
  'orientation',
  'resolution',
  'duration',
  'brightness',
  'audio',
]

/**
 * 质检失败时针对失败维度产出具体重拍建议（需求 3.4，可反哺）。
 *
 * 仅为 `pass=false` 的维度产出建议：返回建议覆盖的维度集合恰等于 report 中
 * （5 个可重拍维度内）pass=false 的维度集合——不为通过维度产出建议、不遗漏失败维度（Property 13）。
 * 文件过大（fileSize）不是「重拍」能解决的问题（应降画质/缩时长），故不在重拍建议范围内。
 *
 * @param input.report     既有 inspectRawAsset 的 QualityInspectionResult['report']
 * @param input.thresholds 拍摄引导的量化阈值（用于建议话术中的达标参照）
 */
export function buildReshootAdvice(input: {
  report: QualityInspectionResult['report']
  thresholds: CaptureGuide['qualityThresholds']
}): ReshootAdvice[] {
  const { report, thresholds } = input
  const advices: ReshootAdvice[] = []

  for (const dimension of RESHOOT_DIMENSIONS) {
    const result = report[dimension]
    // 仅对未通过维度产出建议
    if (!result || result.pass) continue

    const failedValue = String(result.value)
    advices.push({
      dimension,
      failedValue,
      advice: buildAdviceText(dimension, thresholds),
    })
  }

  return advices
}

/**
 * 按失败维度生成具体重拍话术（日常用语，结合量化阈值给出可照做的纠正方向）。
 */
function buildAdviceText(
  dimension: ReshootAdvice['dimension'],
  thresholds: CaptureGuide['qualityThresholds']
): string {
  switch (dimension) {
    case 'orientation':
      return '画面拍横了，请把手机竖起来再录一次，竖屏的画面才好用'
    case 'resolution':
      return '画面不够清晰，请把手机相机调到最高清（1080p 或 720p）再拍一次'
    case 'duration':
      return `时长不合适，这个镜头建议拍 ${thresholds.durationSec.min}~${thresholds.durationSec.max} 秒，太短太长都不行`
    case 'brightness':
      return '光线偏暗，建议靠近窗边或者开灯，让画面更亮堂一些再重拍'
    case 'audio':
      return '没录到说话声，这个镜头需要你开口介绍，请打开麦克风重新录一次'
  }
}

// ========================
// 镜头参考图生成（需求 3.5）—— 复用 Flux 文生图，消耗积分
// ========================

/**
 * 基于 StoreProfile + 镜头脚本生成该镜头的参考画面（需求 3.5）。
 *
 * 复用既有 Flux 文生图能力（generateFirstFrame，竖屏 9:16），产物转存自有 OSS。
 * 消耗积分，统一走 credit-service 计费链路：
 *   1. 余额预检（需求 0.7）：余额 < 单价时在预检阶段显式拒绝，不进入任何 reserve/扣减；
 *   2. RESERVE 冻结固定单价（经 withCreditLock 串行化，需求 0.8）；
 *   3. 生成成功 → CHARGE 实扣；生成失败 → 幂等全额 REFUND，错误抛出不静默（需求 0.4）。
 *
 * 计费关联键采用「CONTENT_BRIEF + 每次调用唯一 bizRefId」，使每次生成独立计费，
 * 不与该 brief 的视频渲染冻结键冲突、也不会因幂等导致重复生成漏扣。
 *
 * @param input.shotTaskId 拍摄任务 ID
 * @param input.userId     操作用户 ID（计费主体）
 * @returns 转存到自有 OSS 后的参考图 URL
 * @throws ApiError('INSUFFICIENT_CREDITS') 余额不足；其它错误（如文生图失败）原样抛出
 */
export async function generateShotReferenceImage(input: {
  shotTaskId: string
  userId: string
}): Promise<{ referenceUrl: string }> {
  const { shotTaskId, userId } = input
  const cost = CREDIT_COST_SHOT_REFERENCE_IMAGE

  // 读取镜头脚本 + 所属 brief + 门店 + 画像（参考图提示词的来源）
  const shotTask = await prisma.shotTask.findUniqueOrThrow({
    where: { id: shotTaskId },
    include: {
      contentBrief: {
        include: {
          store: { include: { profile: true } },
        },
      },
    },
  })

  const store = shotTask.contentBrief.store
  const profile = store.profile
  const storeId = store.id

  // 余额预检（需求 0.7）：不足在预检阶段显式拒绝，绝不先扣后退
  const balance = await getBalance(userId)
  if (balance < cost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：生成镜头参考图需 ${cost} 积分，当前余额 ${balance}`,
      402
    )
  }

  // 每次调用唯一计费键，确保可重复生成各自独立计费，且不与该 brief 渲染冻结键冲突
  const bizRefId = `SHOT_REF:${shotTaskId}:${randomUUID()}`

  // RESERVE 冻结（经 withCreditLock 串行化，需求 0.8）
  await reserveMerchantCredits({
    userId,
    bizRefType: 'CONTENT_BRIEF',
    bizRefId,
    amount: cost,
    remark: `[SHOT_REFERENCE] 生成镜头参考图冻结 ${cost} 积分`,
  })

  try {
    // 拼装参考图提示词：门店画像（风格/定位）+ 镜头脚本 + 主打产品/卖点
    const prompt = buildShotReferencePrompt({
      shotTitle: shotTask.title,
      shotInstruction: shotTask.instruction,
      storeName: store.name,
      mainProducts: toStringArray(store.mainProducts),
      mainSellingPoints: toStringArray(store.mainSellingPoints),
      visualStyle: profile?.visualStyle ?? null,
      contentPositioning: profile?.contentPositioning ?? null,
    })

    // 复用 Flux 文生图（竖屏 9:16），产物转存自有 OSS
    const { imageUrl } = await generateFirstFrame(
      prompt,
      '9:16',
      `merchant/${storeId}/shot-references`
    )

    // 生成成功 → CHARGE 实扣（多冻结差额自动退回，净扣 = cost）
    await prisma.$transaction(async (tx) => {
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId,
        actualAmount: cost,
      })
    })

    return { referenceUrl: imageUrl }
  } catch (error) {
    // 生成失败 → 幂等全额退款；退款本身失败仅记日志，不掩盖原始错误
    try {
      await refundMerchantCredits({ userId, bizRefType: 'CONTENT_BRIEF', bizRefId })
    } catch (refundErr) {
      console.error('[capture-director] 参考图生成失败后退款失败:', refundErr)
    }
    throw error
  }
}

/**
 * 将 Prisma Json 字段（预期为 string[]）安全转为字符串数组，非数组返回空数组。
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * 拼装镜头参考图的文生图提示词（门店画像 + 镜头脚本，竖屏适配）。
 */
function buildShotReferencePrompt(params: {
  shotTitle: string
  shotInstruction: string
  storeName: string
  mainProducts: string[]
  mainSellingPoints: string[]
  visualStyle: string | null
  contentPositioning: string | null
}): string {
  const parts: string[] = []
  if (params.visualStyle) parts.push(`画面风格：${params.visualStyle}`)
  if (params.contentPositioning) parts.push(`内容定位：${params.contentPositioning}`)
  parts.push(`镜头内容：${params.shotTitle}——${params.shotInstruction}`)
  parts.push(`门店：${params.storeName}`)
  if (params.mainProducts.length) parts.push(`主打产品：${params.mainProducts.join('、')}`)
  if (params.mainSellingPoints.length) parts.push(`卖点：${params.mainSellingPoints.join('、')}`)
  parts.push('竖屏 9:16 构图，真实、高清，适合本地生活短视频拍摄参照')
  return parts.join('。')
}
