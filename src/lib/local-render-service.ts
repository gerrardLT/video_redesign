/**
 * 本地视频渲染服务
 *
 * 将商家拍摄的素材组合渲染为 3 种风格的视频版本（PROMOTION / ATMOSPHERE / OWNER_TALKING）。
 * 渲染流程：
 * 1. 读取 ContentBrief + ShotTasks + RawAssets
 * 2. 按版本类型编排素材顺序
 * 3. 对缺失的可选镜头调用 Seedance 生成补充片段（每版本最多 3 个，每个 ≤ 5s）
 * 4. FFmpeg 合成（H.264/AAC/9:16/720p+，0.5s crossfade，ASS 字幕，封面帧）
 * 5. 上传 OSS
 * 6. 创建 VideoVariant 记录
 *
 * 额度与锁集成：
 * - credit-service: RESERVE → CHARGE / REFUND
 * - distributed-lock: 防重复渲染（TTL 720s）
 * - progress-publisher: SSE 实时进度
 *
 * 超时控制：整体 600s 计时器，超时后 refund + FAILED
 */

import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'
import os from 'os'

import { prisma } from './db'
import { reserveCredits, chargeCredits, refundCredits } from './credit-service'
import { acquireLock, releaseLock } from './distributed-lock'
import { uploadBuffer, getSignedObjectUrl, downloadToTemp } from './storage'
import { createSeedanceTask, getSeedanceTaskStatus } from './seedance'
import * as progressPublisher from './progress-publisher'
import {
  RENDER_TIMEOUT_MS,
  RENDER_LOCK_TTL_MS,
  MAX_FILLER_CLIPS_PER_VARIANT,
  MAX_FILLER_DURATION_SEC,
} from '@/constants/merchant'

import type { VideoVariantType } from '@/types/merchant'

const execFileAsync = promisify(execFile)

// ========================
// 类型定义
// ========================

/** 单个素材片段（已下载到本地临时目录） */
interface ClipSegment {
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
interface VariantAssembly {
  type: VideoVariantType
  clips: ClipSegment[]
  subtitles: Array<{ text: string; startSec: number; endSec: number }>
}

/** 渲染产物 */
interface RenderOutput {
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

// ========================
// 三种版本的素材编排策略
// ========================

/**
 * 各版本的 ShotTaskType 编排顺序
 * - PROMOTION: 钩子(价格) → 产品 → 优惠 → CTA | 大字价格 | 快切
 * - ATMOSPHERE: 环境 → 产品 → 制作过程 → 氛围 | 轻文案 | 慢移
 * - OWNER_TALKING: 口播(人) → 产品 → 推荐 → CTA | 字幕跟随 | 自然
 */
const VARIANT_SHOT_ORDER: Record<VideoVariantType, string[]> = {
  PROMOTION: [
    'OFFER_DISPLAY', 'PRODUCT_CLOSEUP', 'STOREFRONT', 'CTA_SCREEN',
  ],
  ATMOSPHERE: [
    'ENVIRONMENT', 'PRODUCT_CLOSEUP', 'COOKING_PROCESS', 'STOREFRONT',
  ],
  OWNER_TALKING: [
    'OWNER_TALKING', 'PRODUCT_CLOSEUP', 'STAFF_ACTION', 'CTA_SCREEN',
  ],
}

/** 版本标题映射 */
const VARIANT_TITLES: Record<VideoVariantType, string> = {
  PROMOTION: '促销引流版',
  ATMOSPHERE: '氛围种草版',
  OWNER_TALKING: '老板口播版',
}

// ========================
// 主入口
// ========================

/**
 * 渲染本地视频版本
 *
 * 根据 ContentBrief 和关联素材，生成 3 种风格的视频版本。
 * 含完整的额度管理、分布式锁、超时控制和临时文件清理。
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.userId 操作用户 ID
 * @returns 创建的 3 个 VideoVariant 记录
 * @throws 错误不静默，抛出让 BullMQ 重试
 */
export async function renderLocalVideoVariants(input: {
  contentBriefId: string
  userId: string
}): Promise<Array<{ id: string; type: string; ossKey: string | null }>> {
  const { contentBriefId, userId } = input
  const lockKey = `render:brief:${contentBriefId}`
  const lockValue = randomUUID()
  const tempDir = path.join(os.tmpdir(), `render-${contentBriefId}-${Date.now()}`)

  // 超时计时器
  let timeoutReached = false
  const timeoutTimer = setTimeout(() => { timeoutReached = true }, RENDER_TIMEOUT_MS)

  // results 声明在 try 外部，以便 catch 块访问已成功的 variant 数量进行精确退款
  let results: Array<{ id: string; type: string; ossKey: string | null }> = []
  // renderCost 在 try 外部声明，catch 中计算退款金额需要用到
  const renderCost = 3 // 3 个版本各 1 积分

  try {
    // Step 1: 获取分布式锁，防止重复渲染（TTL 720s，与 RENDER_LOCK_TTL_MS 对应）
    const lockAcquired = await acquireLock(lockKey, lockValue)
    if (!lockAcquired) {
      throw new Error(
        `渲染锁获取失败：ContentBrief ${contentBriefId} 正在被其他进程渲染（锁 TTL ${RENDER_LOCK_TTL_MS / 1000}s）`
      )
    }

    // Step 2: 幂等冻结积分（RESERVE）
    // 使用 contentBriefId 作为 jobId 关联积分流水
    // 幂等语义：如果该 contentBriefId 已有活跃的 reserve（状态已为 RENDERING），跳过重复冻结

    const currentBrief = await prisma.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      select: { status: true },
    })

    if (currentBrief.status === 'RENDERING') {
      // 已经是 RENDERING 状态，说明之前的 reserve 已执行成功，跳过重复冻结
      console.info(`[local-render] ContentBrief ${contentBriefId} 已处于 RENDERING 状态，跳过重复 reserve`)
    } else {
      try {
        await reserveCredits(userId, contentBriefId, renderCost)
      } catch (reserveError) {
        // 区分「已存在 reserve」和「余额不足」的错误
        const errMsg = reserveError instanceof Error ? reserveError.message : String(reserveError)
        if (errMsg.includes('已存在') || errMsg.includes('ALREADY_RESERVED') || errMsg.includes('duplicate')) {
          // 幂等：已有未结算的 reserve，跳过
          console.info(`[local-render] ContentBrief ${contentBriefId} 已存在活跃 reserve，跳过重复冻结`)
        } else {
          // 余额不足或其他错误，直接抛出
          throw reserveError
        }
      }

      // Step 3: 更新状态为 RENDERING
      await prisma.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'RENDERING' },
      })
    }

    // 发布进度事件
    await progressPublisher.publishStateChange(
      userId, 'generation', contentBriefId, 'RENDERING', 10
    )

    // Step 4: 读取 ContentBrief + ShotTasks + RawAssets
    const brief = await prisma.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      include: {
        shotTasks: {
          include: { rawAssets: true },
          orderBy: { order: 'asc' },
        },
        store: true,
      },
    })

    // 创建临时工作目录
    await mkdir(tempDir, { recursive: true })

    // Step 5: 对 3 种版本分别编排和渲染
    const variantTypes: VideoVariantType[] = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING']
    // results 声明提到外层以便 catch 块访问，用于精确退款计算
    results = []
    const generationLogs: Record<string, unknown>[] = []

    for (let vi = 0; vi < variantTypes.length; vi++) {
      const variantType = variantTypes[vi]

      // 超时检查
      if (timeoutReached) {
        throw new Error(`渲染超时（${RENDER_TIMEOUT_MS / 1000}s）：ContentBrief ${contentBriefId}`)
      }

      // 发布渲染进度
      const progress = 10 + Math.round(((vi + 0.5) / variantTypes.length) * 80)
      await progressPublisher.publishStateChange(
        userId, 'generation', contentBriefId, `RENDERING_${variantType}`, progress
      )

      // 5a: 编排素材序列
      const assembly = await assembleVariantClips({
        variantType,
        shotTasks: brief.shotTasks,
        tempDir,
        contentBriefId,
        brief,
        generationLogs,
      })

      // 超时检查
      if (timeoutReached) {
        throw new Error(`渲染超时（${RENDER_TIMEOUT_MS / 1000}s）：ContentBrief ${contentBriefId}`)
      }

      // 5b: FFmpeg 合成
      const variantId = randomUUID()
      const renderOutput = await compositeVideo({
        variantId,
        assembly,
        tempDir,
      })

      // 5c: 上传到 OSS
      const storeId = brief.storeId
      const videoOssKey = `merchant/${storeId}/variants/${variantId}.mp4`
      const coverOssKey = `merchant/${storeId}/variants/${variantId}_cover.jpg`

      await uploadBuffer(videoOssKey, renderOutput.videoBuffer)
      await uploadBuffer(coverOssKey, renderOutput.coverBuffer)

      // 5d: 创建 VideoVariant 记录
      const variant = await prisma.videoVariant.create({
        data: {
          id: variantId,
          contentBriefId,
          type: variantType,
          title: VARIANT_TITLES[variantType],
          ossKey: videoOssKey,
          coverOssKey,
          durationSec: renderOutput.durationSec,
          width: renderOutput.width,
          height: renderOutput.height,
          subtitles: renderOutput.subtitles,
          renderParams: renderOutput.renderParams,
          generationLog: generationLogs,
        },
      })

      results.push({
        id: variant.id,
        type: variant.type,
        ossKey: variant.ossKey,
      })
    }

    // Step 6: 正式扣费（CHARGE）
    await chargeCredits(userId, contentBriefId, renderCost)

    // Step 7: 更新状态为 GENERATED
    await prisma.contentBrief.update({
      where: { id: contentBriefId },
      data: { status: 'GENERATED' },
    })

    // 发布完成事件
    await progressPublisher.publishCompleted(userId, 'generation', contentBriefId)

    return results

  } catch (error) {
    // 渲染失败：根据实际成功的 variant 数量精确退款
    // results 在 catch 前可能已有部分成功的 variant
    const successfulVariants = results.length
    const refundAmount = renderCost - successfulVariants // 只退还未成功的部分
    try {
      if (refundAmount > 0) {
        await refundCredits(userId, contentBriefId, refundAmount)
      }
    } catch (refundErr) {
      console.error('[local-render] 退还积分失败:', refundErr)
    }

    try {
      await prisma.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'FAILED' },
      })
    } catch (statusErr) {
      console.error('[local-render] 更新 FAILED 状态失败:', statusErr)
    }

    // 发布失败事件
    const reason = error instanceof Error ? error.message : String(error)
    await progressPublisher.publishFailed(userId, 'generation', contentBriefId, reason)

    console.error('[local-render] 渲染失败:', {
      contentBriefId,
      variantType: 'ALL',
      reason,
    })

    // 错误不静默，抛出让 BullMQ 重试
    throw error
  } finally {
    // 清理：释放锁 + 清除超时计时器 + 删除临时文件
    clearTimeout(timeoutTimer)

    try {
      await releaseLock(lockKey, lockValue)
    } catch (lockErr) {
      console.warn('[local-render] 释放锁失败:', lockErr)
    }

    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch (cleanErr) {
      console.warn('[local-render] 清理临时目录失败:', cleanErr)
    }
  }
}

// ========================
// 素材编排
// ========================

/**
 * 为单个版本类型编排素材序列
 *
 * 按版本策略排列已有素材，对缺失的可选镜头调用 Seedance 生成补充片段。
 */
async function assembleVariantClips(params: {
  variantType: VideoVariantType
  shotTasks: Array<{
    id: string
    type: string
    order: number
    required: boolean
    durationSec: number
    title: string
    instruction: string
    examplePrompt: string | null
    rawAssets: Array<{
      id: string
      ossKey: string
      durationSec: number | null
      type: string
    }>
  }>
  tempDir: string
  contentBriefId: string
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null }
  generationLogs: Record<string, unknown>[]
}): Promise<VariantAssembly> {
  const { variantType, shotTasks, tempDir, brief, generationLogs } = params
  const shotOrder = VARIANT_SHOT_ORDER[variantType]
  const clips: ClipSegment[] = []
  let fillerCount = 0

  // 按版本策略顺序排列 ShotTasks
  const orderedTasks = sortShotTasksByVariant(shotTasks, shotOrder)

  for (const task of orderedTasks) {
    const hasAsset = task.rawAssets.length > 0

    if (hasAsset) {
      // 使用已上传的素材
      const asset = task.rawAssets[0]
      const localPath = path.join(tempDir, `clip_${task.id}.mp4`)
      const signedUrl = getSignedObjectUrl(asset.ossKey, 600)
      await downloadToTemp(signedUrl, localPath)

      clips.push({
        localPath,
        durationSec: asset.durationSec ?? task.durationSec,
        isAiGenerated: false,
        shotType: task.type,
      })
    } else if (!task.required && fillerCount < MAX_FILLER_CLIPS_PER_VARIANT) {
      // 可选镜头缺失：调用 Seedance 生成补充片段
      const fillerDuration = Math.min(task.durationSec, MAX_FILLER_DURATION_SEC)
      const prompt = task.examplePrompt
        || buildFillerPrompt(task.type, task.instruction, brief)

      try {
        const fillerPath = await generateFillerClip({
          prompt,
          duration: fillerDuration,
          tempDir,
          clipId: `filler_${variantType}_${task.id}`,
        })

        clips.push({
          localPath: fillerPath,
          durationSec: fillerDuration,
          isAiGenerated: true,
          shotType: task.type,
        })

        fillerCount++
        generationLogs.push({
          variantType,
          shotTaskId: task.id,
          shotType: task.type,
          prompt,
          duration: fillerDuration,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        // Seedance 补充片段生成失败：记录日志但不阻塞渲染（该镜头为可选）
        console.warn(`[local-render] Seedance 补充片段生成失败 (${task.type}):`, err)
        generationLogs.push({
          variantType,
          shotTaskId: task.id,
          shotType: task.type,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        })
      }
    }
    // required=true 但无素材：不生成补充（前端已保证必拍任务有素材才能触发渲染）
  }

  // 构建字幕序列
  const subtitles = buildSubtitles(variantType, clips, brief)

  return { type: variantType, clips, subtitles }
}

/**
 * 按版本策略排列 ShotTasks
 * 优先级：在版本策略顺序中出现的类型排前面，其余按原始 order 排列
 */
function sortShotTasksByVariant<T extends { type: string; order: number }>(
  tasks: T[],
  shotOrder: string[]
): T[] {
  return [...tasks].sort((a, b) => {
    const aIdx = shotOrder.indexOf(a.type)
    const bIdx = shotOrder.indexOf(b.type)
    // 在策略顺序中的排前面
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    if (aIdx !== -1) return -1
    if (bIdx !== -1) return 1
    // 都不在策略中：按原始顺序
    return a.order - b.order
  })
}

/**
 * 为缺失的可选镜头构建 Seedance 生成提示词
 */
function buildFillerPrompt(
  shotType: string,
  instruction: string,
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null }
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
  return `${typeDesc}。场景：${context}。竖屏 9:16 画面，高清画质。`
}

// ========================
// Seedance 补充片段生成
// ========================

/**
 * 调用 Seedance 2.0 生成补充视频片段
 *
 * 创建任务后轮询等待完成，下载生成结果到本地临时文件。
 */
async function generateFillerClip(params: {
  prompt: string
  duration: number
  tempDir: string
  clipId: string
}): Promise<string> {
  const { prompt, duration, tempDir, clipId } = params

  // 创建 Seedance 生成任务
  const { taskId } = await createSeedanceTask({
    prompt,
    duration,
    aspectRatio: '9:16',
    resolution: '720p',
  })

  // 轮询等待完成（最长 180s）
  const pollDeadline = Date.now() + 180_000
  const pollInterval = 5_000

  while (Date.now() < pollDeadline) {
    await sleep(pollInterval)

    const status = await getSeedanceTaskStatus(taskId)

    if (status.status === 'succeeded' && status.videoUrl) {
      // 下载到本地
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ========================
// 字幕生成
// ========================

/**
 * 根据版本类型构建字幕序列
 */
function buildSubtitles(
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
        // 大字价格 + 利益点
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        else if (brief.mainMessage) text = brief.mainMessage
        break
      case 'ATMOSPHERE':
        // 轻文案：只在首尾加字幕
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        break
      case 'OWNER_TALKING':
        // 字幕跟随：每段都加字幕
        if (i === 0 && brief.hook) text = brief.hook
        else if (i === clips.length - 1 && brief.suggestedCta) text = brief.suggestedCta
        else if (brief.mainMessage) text = brief.mainMessage
        break
    }

    if (text) {
      subtitles.push({ text, startSec: Math.round(startSec * 100) / 100, endSec: Math.round(endSec * 100) / 100 })
    }

    // 考虑 crossfade 重叠 0.5s
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
async function compositeVideo(params: {
  variantId: string
  assembly: VariantAssembly
  tempDir: string
}): Promise<RenderOutput> {
  const { variantId, assembly, tempDir } = params
  const { clips, subtitles, type } = assembly

  if (clips.length === 0) {
    throw new Error(`渲染失败：版本 ${type} 无可用素材片段`)
  }

  const outputPath = path.join(tempDir, `${variantId}_output.mp4`)
  const coverPath = path.join(tempDir, `${variantId}_cover.jpg`)
  const assPath = path.join(tempDir, `${variantId}_subs.ass`)

  // 生成 ASS 字幕文件
  await generateAssFile(assPath, subtitles, type)

  // 构建 FFmpeg 合成命令
  if (clips.length === 1) {
    // 单片段：直接转码 + 字幕叠加
    await execFileAsync('ffmpeg', [
      '-i', clips[0].localPath,
      '-vf', `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,ass=${assPath}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { timeout: 300_000 })
  } else {
    // 多片段：xfade + acrossfade 合成
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

  // 读取输出文件
  const videoBuffer = await readFile(outputPath)
  const coverBuffer = await readFile(coverPath)

  // 获取输出视频元数据
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
 *
 * FFmpeg 合成命令模板（design.md）：
 * ffmpeg -i input1.mp4 -i input2.mp4 -i input3.mp4 \
 *   -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset={t1}[v01]; ..."
 *   -map "[vout]" -map "[aout]" -vf "ass=subtitles.ass" ...
 */
async function compositeMultipleClips(
  clips: ClipSegment[],
  assPath: string,
  outputPath: string,
  tempDir: string
): Promise<void> {
  // 先将每个片段归一化为统一格式（720x1280, 24fps, h264）以确保 xfade 兼容
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

  // 构建 filter_complex 表达式
  const crossfadeDuration = 0.5
  const inputArgs: string[] = []
  for (const p of normalizedPaths) {
    inputArgs.push('-i', p)
  }

  // 计算各片段实际时长（从归一化后的文件读取）
  const durations: number[] = []
  for (const p of normalizedPaths) {
    const meta = await getOutputMetadata(p)
    durations.push(meta.duration)
  }

  // 构建 xfade 链式视频滤镜
  let videoFilter = ''
  let audioFilter = ''
  let cumulativeOffset = 0

  if (clips.length === 2) {
    // 2 个片段：单次 xfade
    cumulativeOffset = durations[0] - crossfadeDuration
    videoFilter = `[0:v][1:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(2)}[vout]`
    audioFilter = `[0:a][1:a]acrossfade=d=${crossfadeDuration}[aout]`
  } else {
    // 3+ 个片段：链式 xfade
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
      // 累加偏移量：前一段累积时长 + 当前段时长 - crossfade 重叠
      cumulativeOffset += durations[i] - crossfadeDuration
      const newVLabel = i === clips.length - 1 ? 'vout' : `v${String(i - 1).padStart(2, '0')}${i}`
      const newALabel = i === clips.length - 1 ? 'aout' : `a${String(i - 1).padStart(2, '0')}${i}`

      videoFilter += `; [${prevVLabel}][${i}:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(2)}[${newVLabel}]`
      audioFilter += `; [${prevALabel}][${i}:a]acrossfade=d=${crossfadeDuration}[${newALabel}]`
      vLabels.push(newVLabel)
      aLabels.push(newALabel)
    }
  }

  // 合成中间文件（不含字幕）
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

  // 叠加字幕
  await execFileAsync('ffmpeg', [
    '-i', intermediateOutput,
    '-vf', `ass=${assPath}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outputPath,
  ], { timeout: 120_000 })
}

// ========================
// ASS 字幕生成
// ========================

/**
 * 生成 ASS 格式字幕文件
 *
 * 根据版本类型选择不同字幕风格：
 * - PROMOTION: 大字白色加粗描边
 * - ATMOSPHERE: 小字轻量半透明
 * - OWNER_TALKING: 标准字幕底部居中
 */
async function generateAssFile(
  assPath: string,
  subtitles: Array<{ text: string; startSec: number; endSec: number }>,
  variantType: VideoVariantType
): Promise<void> {
  // ASS 样式配置
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
      // 大字白色加粗 + 黑色描边 — 底部居中
      return 'Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,60,1'
    case 'ATMOSPHERE':
      // 轻量小字半透明 — 底部居中
      return 'Microsoft YaHei,32,&H80FFFFFF,&H000000FF,&H00000000,&H40000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,40,1'
    case 'OWNER_TALKING':
      // 标准字幕白底黑字 — 底部居中
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
async function getOutputMetadata(filePath: string): Promise<{
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
