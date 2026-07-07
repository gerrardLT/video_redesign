/**
 * 渲染管线共享模块
 *
 * 从 local-render-service.ts 提取的 FFmpeg 合成、字幕生成、Seedance 片段生成等
 * 共享逻辑，供 MANUAL（商家拍摄上传）和 AUTO（一键出片 AI 全自动）两种渲染模式复用。
 *
 * 包含：
 * - 类型定义（ClipSegment, VariantAssembly, RenderOutput, RenderAdvancedParams）
 * - 常量（VARIANT_SHOT_ORDER, VARIANT_TITLES, RENDER_RESOLUTION 等）
 * - 素材编排工具（sortShotTasksByVariant, buildFillerPrompt, generateFillerClip, buildSubtitles）
 * - FFmpeg 合成（compositeVideo, compositeMultipleClips）
 * - ASS 字幕生成（generateAssFile, getAssStyle, formatAssTime, buildAssFilter）
 * - 视频元数据（getOutputMetadata）
 * - 高级参数解析（resolveAdvancedParams）
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { writeFile, readFile } from 'fs/promises'

import { downloadToTemp } from '../shared/storage'
import { createSeedanceTask, getSeedanceTaskStatus } from './seedance'
import { ApiError } from '../shared/api-error'
import type { MerchantContext } from '../merchant/merchant-context-builder'
import { MAX_FILLER_DURATION_SEC } from '@/constants/merchant'
import type { VideoVariantType } from '@/types/merchant'

const execFileAsync = promisify(execFile)

// ========================
// 类型定义
// ========================

/** 单个素材片段（已下载到本地临时目录） */
export interface ClipSegment {
  /** 本地临时文件路径 */
  localPath: string
  /** 时长（秒） */
  durationSec: number
  /** 是否为 AI 生成的补充片段 */
  isAiGenerated: boolean
  /** 对应的 ShotTask 类型 */
  shotType: string
}

/** 视频版本的素材编排结果 */
export interface VariantAssembly {
  type: VideoVariantType
  clips: ClipSegment[]
  subtitles: Array<{ text: string; startSec: number; endSec: number }>
}

/** 渲染产物 */
export interface RenderOutput {
  variantId: string
  type: VideoVariantType
  videoBuffer: Buffer
  coverBuffer: Buffer
  durationSec: number
  width: number
  height: number
  subtitles: Array<{ text: string; startSec: number; endSec: number }>
  renderParams: Record<string, unknown>
  generationLog: Record<string, unknown>[]
}

/**
 * 运营型用户高级可调参数（需求 4.6）。
 *
 * 小白老板默认一键路径无需任何参数；仅运营型用户主动展开抽屉时填写。
 */
export interface RenderAdvancedParams {
  /** 渲染风格：字幕样式预设，取值 PROMOTION/ATMOSPHERE/OWNER_TALKING 之一 */
  style?: string
  /** AI 补充片段目标时长（秒），须在 1 至 MAX_FILLER_DURATION_SEC 之间 */
  durationSec?: number
  /** 镜头编排模板：取值 PROMOTION/ATMOSPHERE/OWNER_TALKING 之一，决定镜头排序顺序 */
  templateId?: string
}

/**
 * 高级参数解析结果：将外部传入的 RenderAdvancedParams 校验并落地为渲染管线可用的具体取值。
 */
export interface ResolvedAdvancedParams {
  /** 镜头排序模板对应的版本类型 */
  orderType: VideoVariantType
  /** 字幕样式预设对应的版本类型 */
  styleType: VideoVariantType
  /** AI 补充片段时长上限（秒） */
  fillerDurationCapSec: number
  /** 本次实际生效的高级参数（仅含调用方真正提供的项，用于写入 renderParams 标注） */
  applied: RenderAdvancedParams
}

// ========================
// 常量
// ========================

/**
 * 各版本的 ShotTaskType 编排顺序
 * - PROMOTION: 钩子(价格) → 产品 → 优惠 → CTA | 大字价格 | 快切
 * - ATMOSPHERE: 环境 → 产品 → 制作过程 → 氛围 | 轻文案 | 慢移
 * - OWNER_TALKING: 口播(人) → 产品 → 推荐 → CTA | 字幕跟随 | 自然
 */
export const VARIANT_SHOT_ORDER: Record<VideoVariantType, string[]> = {
  PROMOTION: ['OFFER_DISPLAY', 'PRODUCT_CLOSEUP', 'STOREFRONT', 'CTA_SCREEN'],
  ATMOSPHERE: ['ENVIRONMENT', 'PRODUCT_CLOSEUP', 'COOKING_PROCESS', 'STOREFRONT'],
  OWNER_TALKING: ['OWNER_TALKING', 'PRODUCT_CLOSEUP', 'STAFF_ACTION', 'CTA_SCREEN'],
  TRUST: ['STOREFRONT', 'STAFF_ACTION', 'PRODUCT_CLOSEUP', 'CTA_SCREEN'],
  PRODUCT: ['PRODUCT_CLOSEUP', 'COOKING_PROCESS', 'OFFER_DISPLAY', 'CTA_SCREEN'],
}

/** 版本标题映射 */
export const VARIANT_TITLES: Record<VideoVariantType, string> = {
  PROMOTION: '促销引流版',
  ATMOSPHERE: '氛围种草版',
  OWNER_TALKING: '老板口播版',
  TRUST: '信任背书版',
  PRODUCT: '产品展示版',
}

/**
 * 渲染目标分辨率：固定输出 720p（720x1280 竖屏），
 * 成本估算时透传给 estimateGroupCreditCost。
 */
export const RENDER_RESOLUTION = '720p'

/**
 * 高级参数取值的合法集合：风格 / 模板均复用既有三种版本预设。
 */
export const VALID_RENDER_STYLES: VideoVariantType[] = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING']

// ========================
// 高级参数解析
// ========================

/**
 * 校验并解析高级参数（需求 4.6, 4.7）。
 *
 * 非法取值（未知风格/模板、超范围时长）一律显式抛 ApiError，绝不静默忽略或回退。
 */
export function resolveAdvancedParams(
  variantType: VideoVariantType,
  advancedParams?: RenderAdvancedParams
): ResolvedAdvancedParams {
  const applied: RenderAdvancedParams = {}
  let orderType = variantType
  let styleType = variantType
  let fillerDurationCapSec = MAX_FILLER_DURATION_SEC

  if (advancedParams) {
    if (advancedParams.style !== undefined) {
      if (!VALID_RENDER_STYLES.includes(advancedParams.style as VideoVariantType)) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `不支持的渲染风格：${advancedParams.style}（仅支持 ${VALID_RENDER_STYLES.join('/')}）`,
          400
        )
      }
      styleType = advancedParams.style as VideoVariantType
      applied.style = advancedParams.style
    }

    if (advancedParams.templateId !== undefined) {
      if (!VALID_RENDER_STYLES.includes(advancedParams.templateId as VideoVariantType)) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `不支持的编排模板：${advancedParams.templateId}（仅支持 ${VALID_RENDER_STYLES.join('/')}）`,
          400
        )
      }
      orderType = advancedParams.templateId as VideoVariantType
      applied.templateId = advancedParams.templateId
    }

    if (advancedParams.durationSec !== undefined) {
      if (
        !Number.isFinite(advancedParams.durationSec) ||
        advancedParams.durationSec < 1 ||
        advancedParams.durationSec > MAX_FILLER_DURATION_SEC
      ) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `不支持的时长参数：${advancedParams.durationSec}（须在 1-${MAX_FILLER_DURATION_SEC} 秒内）`,
          400
        )
      }
      fillerDurationCapSec = advancedParams.durationSec
      applied.durationSec = advancedParams.durationSec
    }
  }

  return { orderType, styleType, fillerDurationCapSec, applied }
}

// ========================
// 素材编排工具
// ========================

/**
 * 按版本策略排列 ShotTasks
 * 优先级：在版本策略顺序中出现的类型排前面，其余按原始 order 排列
 */
export function sortShotTasksByVariant<T extends { type: string; order: number }>(
  tasks: T[],
  shotOrder: string[]
): T[] {
  return [...tasks].sort((a, b) => {
    const aIdx = shotOrder.indexOf(a.type)
    const bIdx = shotOrder.indexOf(b.type)
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    if (aIdx !== -1) return -1
    if (bIdx !== -1) return 1
    return a.order - b.order
  })
}

/**
 * 为缺失的可选镜头构建 Seedance 生成提示词
 * 当有商家画像上下文时，自动注入门店信息到 prompt 前缀
 */
export function buildFillerPrompt(
  shotType: string,
  instruction: string,
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null },
  merchantCtx?: MerchantContext | null
): string {
  const context = brief.mainMessage || brief.hook || '门店日常'
  const typeDescriptions: Record<string, string> = {
    ENVIRONMENT: '拍摄门店环境氛围，暖色调光线，顾客入座场景',
    PRODUCT_CLOSEUP: '产品特写镜头，近距离展示食物细节和摆盘',
    COOKING_PROCESS: '制作过程展示，厨师操作、食材翻炒冒气',
    STOREFRONT: '门头外观展示，门口招牌和人流',
    OFFER_DISPLAY: '优惠信息展示画面，价格标签和套餐组合',
    CTA_SCREEN: '行动号召画面，门店二维码或联系方式展示',
    STAFF_ACTION: '员工服务场景，上菜或制作饮品',
  }

  const typeDesc = typeDescriptions[shotType] || instruction
  const basePrompt = `${typeDesc}。场景：${context}。竖屏 9:16 画面，高清画质。`

  if (merchantCtx?.promptPrefix) {
    return `${merchantCtx.promptPrefix}\n${basePrompt}`
  }
  return basePrompt
}

// ========================
// Seedance 片段生成
// ========================

/**
 * 调用 Seedance 2.0 生成补充视频片段
 *
 * 创建任务后轮询等待完成，下载生成结果到本地临时文件。
 */
export async function generateFillerClip(params: {
  prompt: string
  duration: number
  tempDir: string
  clipId: string
}): Promise<string> {
  const { prompt, duration, tempDir, clipId } = params

  const { taskId } = await createSeedanceTask({
    prompt,
    duration,
    aspectRatio: '9:16',
    resolution: '720p',
  })

  const pollDeadline = Date.now() + 180_000
  const pollInterval = 5_000

  while (Date.now() < pollDeadline) {
    await sleep(pollInterval)

    const status = await getSeedanceTaskStatus(taskId)

    if (status.status === 'succeeded' && status.videoUrl) {
      const localPath = path.join(tempDir, `${clipId}.mp4`)
      await downloadToTemp(status.videoUrl, localPath)
      return localPath
    }

    if (status.status === 'failed') {
      throw new Error(
        `Seedance 补充片段生成失败: ${status.error?.message || '未知错误'}`
      )
    }
  }

  throw new Error(`Seedance 补充片段生成超时（180s）: taskId=${taskId}`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ========================
// 字幕生成
// ========================

/**
 * 根据版本类型构建字幕序列
 */
export function buildSubtitles(
  variantType: VideoVariantType,
  clips: ClipSegment[],
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null }
): Array<{ text: string; startSec: number; endSec: number }> {
  const subtitles: Array<{ text: string; startSec: number; endSec: number }> = []
  let currentTime = 0

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const startSec = currentTime
    const endSec = currentTime + clip.durationSec

    let text = ''
    switch (variantType) {
      case 'PROMOTION':
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        else if (brief.mainMessage) text = brief.mainMessage
        break
      case 'ATMOSPHERE':
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        break
      case 'OWNER_TALKING':
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        else if (brief.mainMessage) text = brief.mainMessage
        break
    }

    if (text) {
      subtitles.push({ text, startSec: Math.round(startSec * 100) / 100, endSec: Math.round(endSec * 100) / 100 })
    }

    currentTime = endSec - (i < clips.length - 1 ? 0.5 : 0)
  }

  return subtitles
}

// ========================
// FFmpeg 视频合成
// ========================

/**
 * 使用 FFmpeg 合成最终视频
 *
 * 功能：
 * - 统一编码为 H.264 / AAC / 9:16 / 720p+
 * - 片段间 0.5s crossfade 转场
 * - ASS 字幕叠加
 * - 从第 1 秒提取封面帧
 */
export async function compositeVideo(params: {
  variantId: string
  assembly: VariantAssembly
  tempDir: string
  /** 字幕样式预设覆盖（高级参数 style）；缺省时按 assembly.type 选用默认样式 */
  subtitleStyleType?: VideoVariantType
}): Promise<RenderOutput> {
  const { variantId, assembly, tempDir } = params
  const { clips, subtitles, type } = assembly
  const subtitleStyleType = params.subtitleStyleType ?? type

  if (clips.length === 0) {
    throw new Error(`渲染失败：版本 ${type} 无可用素材片段`)
  }

  const outputPath = path.join(tempDir, `${variantId}_output.mp4`)
  const coverPath = path.join(tempDir, `${variantId}_cover.jpg`)
  const assPath = path.join(tempDir, `${variantId}_subs.ass`)

  await generateAssFile(assPath, subtitles, subtitleStyleType)

  if (clips.length === 1) {
    await execFileAsync('ffmpeg', [
      '-i', clips[0].localPath,
      '-vf', `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${buildAssFilter(assPath)}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { timeout: 300_000 })
  } else {
    await compositeMultipleClips(clips, assPath, outputPath, tempDir)
  }

  // 提取封面帧（第 1 秒）
  await execFileAsync('ffmpeg', [
    '-ss', '1',
    '-i', outputPath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y', coverPath,
  ], { timeout: 30_000 })

  const videoBuffer = await readFile(outputPath)
  const coverBuffer = await readFile(coverPath)
  const metadata = await getOutputMetadata(outputPath)

  return {
    variantId,
    type,
    videoBuffer,
    coverBuffer,
    durationSec: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    subtitles,
    renderParams: {
      codec: 'libx264',
      preset: 'medium',
      crf: 23,
      audioCodec: 'aac',
      audioBitrate: '128k',
      resolution: '720x1280',
      crossfadeDuration: 0.5,
      inputClips: clips.length,
    },
    generationLog: [],
  }
}

/**
 * 合成多个片段：使用 xfade 视频转场 + acrossfade 音频转场
 */
async function compositeMultipleClips(
  clips: ClipSegment[],
  assPath: string,
  outputPath: string,
  tempDir: string
): Promise<void> {
  const normalizedPaths: string[] = []
  for (let i = 0; i < clips.length; i++) {
    const normPath = path.join(tempDir, `norm_${i}.mp4`)
    await execFileAsync('ffmpeg', [
      '-i', clips[i].localPath,
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-r', '24',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      '-y', normPath,
    ], { timeout: 120_000 })
    normalizedPaths.push(normPath)
  }

  const crossfadeDuration = 0.5
  const inputArgs: string[] = []
  for (const p of normalizedPaths) {
    inputArgs.push('-i', p)
  }

  const durations: number[] = []
  for (const p of normalizedPaths) {
    const meta = await getOutputMetadata(p)
    durations.push(meta.duration)
  }

  let videoFilter = ''
  let audioFilter = ''
  let cumulativeOffset = 0

  if (clips.length === 2) {
    cumulativeOffset = durations[0] - crossfadeDuration
    videoFilter = `[0:v][1:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(2)}[vout]`
    audioFilter = `[0:a][1:a]acrossfade=d=${crossfadeDuration}[aout]`
  } else {
    const vLabels: string[] = []
    const aLabels: string[] = []

    cumulativeOffset = durations[0] - crossfadeDuration
    videoFilter = `[0:v][1:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(2)}[v01]`
    audioFilter = `[0:a][1:a]acrossfade=d=${crossfadeDuration}[a01]`
    vLabels.push('v01')
    aLabels.push('a01')

    for (let i = 2; i < clips.length; i++) {
      const prevVLabel = vLabels[vLabels.length - 1]
      const prevALabel = aLabels[aLabels.length - 1]
      cumulativeOffset += durations[i] - crossfadeDuration
      const newVLabel = i === clips.length - 1 ? 'vout' : `v${String(i - 1).padStart(2, '0')}${i}`
      const newALabel = i === clips.length - 1 ? 'aout' : `a${String(i - 1).padStart(2, '0')}${i}`

      videoFilter += `; [${prevVLabel}][${i}:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(2)}[${newVLabel}]`
      audioFilter += `; [${prevALabel}][${i}:a]acrossfade=d=${crossfadeDuration}[${newALabel}]`
      vLabels.push(newVLabel)
      aLabels.push(newALabel)
    }
  }

  const intermediateOutput = path.join(tempDir, 'intermediate.mp4')
  const filterComplex = `${videoFilter}; ${audioFilter}`

  await execFileAsync('ffmpeg', [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', intermediateOutput,
  ], { timeout: 300_000 })

  await execFileAsync('ffmpeg', [
    '-i', intermediateOutput,
    '-vf', buildAssFilter(assPath),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outputPath,
  ], { timeout: 120_000 })
}

/**
 * 转义 ASS 字幕文件路径，供 ffmpeg -vf 滤镜安全引用。
 */
function buildAssFilter(assPath: string): string {
  const escaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:')
  return `ass='${escaped}'`
}

// ========================
// ASS 字幕生成
// ========================

/**
 * 生成 ASS 格式字幕文件
 */
async function generateAssFile(
  assPath: string,
  subtitles: Array<{ text: string; startSec: number; endSec: number }>,
  variantType: VideoVariantType
): Promise<void> {
  const styleConfig = getAssStyle(variantType)

  const header = `[Script Info]
Title: Local Video Subtitles
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${styleConfig}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const events = subtitles.map((sub) => {
    const start = formatAssTime(sub.startSec)
    const end = formatAssTime(sub.endSec)
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${sub.text}`
  }).join('\n')

  await writeFile(assPath, header + events, 'utf-8')
}

/**
 * 获取版本对应的 ASS 字幕样式
 */
function getAssStyle(variantType: VideoVariantType): string {
  switch (variantType) {
    case 'PROMOTION':
      return 'Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,60,1'
    case 'ATMOSPHERE':
      return 'Microsoft YaHei,32,&H80FFFFFF,&H000000FF,&H00000000,&H40000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,40,1'
    case 'OWNER_TALKING':
      return 'Microsoft YaHei,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,50,1'
    default:
      return 'Microsoft YaHei,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,50,1'
  }
}

/**
 * 将秒数转换为 ASS 时间格式 H:MM:SS.CC
 */
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.round((seconds % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// ========================
// 工具函数
// ========================

/**
 * 获取输出视频的元数据（时长、分辨率）
 */
export async function getOutputMetadata(filePath: string): Promise<{
  duration: number
  width: number
  height: number
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { timeout: 30_000 })

  const data = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>
    format?: { duration?: string }
  }

  const videoStream = data.streams?.find(s => s.codec_type === 'video')
  return {
    duration: parseFloat(data.format?.duration || '0'),
    width: videoStream?.width || 720,
    height: videoStream?.height || 1280,
  }
}
