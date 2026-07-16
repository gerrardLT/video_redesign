/**
 * AI 自动渲染服务（一键出片）
 *
 * 实现"零素材全 AI 生成"渲染流程：
 * - 无需商家拍摄上传素材，全部镜头由 Seedance 2.0 文生视频生成
 * - 对 3 种版本（PROMOTION / ATMOSPHERE / OWNER_TALKING）分别生成全部 ShotTask 对应的视频片段
 * - 共享 render-pipeline.ts 的 FFmpeg 合成管线（字幕、封面、crossfade、上传）
 * - 与 MANUAL 模式共享计费链路（RESERVE→CHARGE/REFUND）
 *
 * 关键差异（vs MANUAL 模式 renderLocalVideoVariants）：
 * - 移除 MAX_FILLER_CLIPS_PER_VARIANT 上限（AUTO 模式下所有镜头均 AI 生成）
 * - 移除 hasAsset 分支（AUTO 模式无上传素材）
 * - 超时放宽到 900s（AUTO 模式需要更多 Seedance 调用）
 * - Prompt 优先使用 ShotTask.examplePrompt（playbook-engine 已填充）
 */

import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, rm } from 'fs/promises'
import os from 'os'

import { prisma } from '../shared/db'
import { acquireLock, releaseLock } from '../shared/distributed-lock'
import { uploadBuffer } from '../shared/storage'
import * as progressPublisher from '../shared/progress-publisher'
import { estimateGroupCreditCost } from '../shared/credit-service'
import {
  chargeMerchantCredits,
  refundMerchantCredits,
} from './merchant-billing-service'
import { buildMerchantContext, type MerchantContext } from './merchant-context-builder'
import {
  type ClipSegment,
  type VariantAssembly,
  VARIANT_SHOT_ORDER,
  VARIANT_TITLES,
  compositeVideo,
  buildSubtitles,
  sortShotTasksByVariant,
  buildFillerPrompt,
  generateFillerClip,
  sleep,
} from '../video/render-pipeline'
import { assertBriefTransition } from './content-brief-state-machine'

import type { VideoVariantType } from '@/types/merchant'
import type { ContentBriefStatus } from '@/generated/prisma'
import { Prisma } from '@/generated/prisma'
import { toJson } from '@/lib/shared/prisma-json-helpers'

// ========================
// 常量
// ========================

/** AUTO 模式超时（毫秒）：全部 Seedance 生成需要更多时间 */
const AUTO_RENDER_TIMEOUT_MS = 900_000

/** Seedance 轮询间隔（毫秒） */
const AUTO_POLL_INTERVAL_MS = 5_000

// ========================
// 主入口
// ========================

/**
 * AI 一键出片：全 AI 生成渲染流程
 *
 * 读取 ContentBrief + ShotTasks，对 3 种版本的全部镜头调用 Seedance 生成，
 * 再经 FFmpeg 合成管线输出最终视频。
 *
 * 前提：入口 auto-render/route.ts 已完成：
 * - renderMode = "AUTO" 标记
 * - 积分预检 + RESERVE 冻结
 * - 入队 render-local-video
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.userId 操作用户 ID
 * @returns 创建的 3 个 VideoVariant 记录
 */
export async function aiAutoRender(input: {
  contentBriefId: string
  userId: string
}): Promise<Array<{ id: string; type: string; ossKey: string | null }>> {
  const { contentBriefId, userId } = input
  const lockKey = `render:brief:${contentBriefId}`
  const lockValue = randomUUID()
  const tempDir = path.join(os.tmpdir(), `auto-render-${contentBriefId}-${Date.now()}`)

  let timeoutReached = false
  const timeoutTimer = setTimeout(() => { timeoutReached = true }, AUTO_RENDER_TIMEOUT_MS)

  let results: Array<{ id: string; type: string; ossKey: string | null }> = []

  try {
    // Step 1: 获取分布式锁
    const lockAcquired = await acquireLock(lockKey, lockValue)
    if (!lockAcquired) {
      throw new Error(
        `渲染锁获取失败：ContentBrief ${contentBriefId} 正在被其他进程渲染（一键出片模式）`
      )
    }

    // Step 2: 置 RENDERING 状态（状态机守卫）
    const currentBrief = await prisma.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      select: { status: true },
    })

    if (currentBrief.status === 'RENDERING') {
      console.info(`[auto-render] ContentBrief ${contentBriefId} 已处于 RENDERING 状态`)
    } else {
      assertBriefTransition(currentBrief.status as ContentBriefStatus, 'RENDERING')
      await prisma.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'RENDERING' },
      })
    }

    // 记录一键出片触发时间
    await prisma.contentBrief.update({
      where: { id: contentBriefId },
      data: { autoGenStartedAt: new Date() },
    })

    await progressPublisher.publishStateChange(
      userId, 'generation', contentBriefId, 'RENDERING', 5
    )

    // Step 3: 读取 ContentBrief + ShotTasks（AUTO 模式无需 RawAssets）
    const brief = await prisma.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      include: {
        shotTasks: {
          orderBy: { order: 'asc' },
        },
        store: true,
      },
    })

    await mkdir(tempDir, { recursive: true })

    // 构建商家画像上下文
    const merchantCtx = await buildMerchantContext(brief.storeId).catch((err) => {
      console.warn('[auto-render] 构建商家画像上下文失败（不影响主流程）:', err instanceof Error ? err.message : String(err))
      return null
    })

    // Step 4: 对 3 种版本分别生成全部镜头 + FFmpeg 合成
    const variantTypes: VideoVariantType[] = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING']
    results = []
    const renderedDurations: number[] = []

    for (let vi = 0; vi < variantTypes.length; vi++) {
      const variantType = variantTypes[vi]
      // 每版本独立日志数组，避免跨版本污染
      const generationLogs: Record<string, unknown>[] = []

      if (timeoutReached) {
        throw new Error(`一键出片超时（${AUTO_RENDER_TIMEOUT_MS / 1000}s）：ContentBrief ${contentBriefId}`)
      }

      const progress = 5 + Math.round(((vi + 0.5) / variantTypes.length) * 85)
      await progressPublisher.publishStateChange(
        userId, 'generation', contentBriefId, `RENDERING_${variantType}`, progress
      )

      // 4a: AUTO 模式素材编排——全部镜头 AI 生成
      const assembly = await assembleAutoVariantClips({
        variantType,
        shotTasks: brief.shotTasks,
        tempDir,
        brief,
        merchantCtx,
        generationLogs,
      })

      if (timeoutReached) {
        throw new Error(`一键出片超时（${AUTO_RENDER_TIMEOUT_MS / 1000}s）：ContentBrief ${contentBriefId}`)
      }

      // 4b: FFmpeg 合成
      const variantId = randomUUID()
      const renderOutput = await compositeVideo({
        variantId,
        assembly,
        tempDir,
      })

      // 4c: 上传 OSS
      const storeId = brief.storeId
      const videoOssKey = `merchant/${storeId}/variants/${variantId}.mp4`
      const coverOssKey = `merchant/${storeId}/variants/${variantId}_cover.jpg`

      await uploadBuffer(videoOssKey, renderOutput.videoBuffer)
      await uploadBuffer(coverOssKey, renderOutput.coverBuffer)

      // 4d: 创建 VideoVariant 记录
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
          renderParams: toJson(renderOutput.renderParams),
          generationLog: toJson(generationLogs),
        },
      })

      results.push({ id: variant.id, type: variant.type, ossKey: variant.ossKey })
      renderedDurations.push(renderOutput.durationSec)
    }

    // Step 5: 渲染成功——置 GENERATED + CHARGE 实扣积分
    const actualAmount = renderedDurations.reduce(
      (sum, durationSec) => sum + estimateGroupCreditCost(durationSec, '720p'),
      0
    )

    await prisma.$transaction(async (tx) => {
      await tx.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'GENERATED' },
      })
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: contentBriefId,
        actualAmount,
      })
    })

    await progressPublisher.publishCompleted(userId, 'generation', contentBriefId)

    return results

  } catch (error) {
    // 渲染失败：置 FAILED + REFUND
    try {
      await prisma.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'FAILED' },
      })
    } catch (statusErr) {
      console.error('[auto-render] 更新 FAILED 状态失败:', statusErr)
    }

    try {
      await refundMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: contentBriefId,
      })
    } catch (refundErr) {
      console.error('[auto-render] 退还冻结积分失败:', refundErr)
    }

    const reason = error instanceof Error ? error.message : String(error)
    await progressPublisher.publishFailed(userId, 'generation', contentBriefId, reason)

    console.error('[auto-render] 一键出片渲染失败:', {
      contentBriefId,
      variantType: 'ALL',
      reason,
    })

    throw error
  } finally {
    clearTimeout(timeoutTimer)

    try {
      await releaseLock(lockKey, lockValue)
    } catch (lockErr) {
      console.warn('[auto-render] 释放锁失败:', lockErr)
    }

    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch (cleanErr) {
      console.warn('[auto-render] 清理临时目录失败:', cleanErr)
    }
  }
}

// ========================
// AUTO 模式素材编排
// ========================

/**
 * AUTO 模式素材编排：全部镜头均 AI 生成，无 hasAsset 分支，无 filler 上限。
 *
 * Prompt 策略：
 * 1. 优先使用 ShotTask.examplePrompt（playbook-engine 已填充）
 * 2. 降级使用 buildAutoPrompt()（基于镜头类型 + brief 上下文 + 商家画像）
 * 3. 最终降级使用 buildFillerPrompt()（render-pipeline 中的基础 prompt 构建）
 */
async function assembleAutoVariantClips(params: {
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
  }>
  tempDir: string
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null }
  merchantCtx?: MerchantContext | null
  generationLogs: Record<string, unknown>[]
}): Promise<VariantAssembly> {
  const { variantType, shotTasks, tempDir, brief, generationLogs } = params
  const shotOrder = VARIANT_SHOT_ORDER[variantType]
  const clips: ClipSegment[] = []

  const orderedTasks = sortShotTasksByVariant(shotTasks, shotOrder)

  for (const task of orderedTasks) {
    // AUTO 模式：所有镜头均 AI 生成（不区分 required/optional、有无素材）
    const prompt = task.examplePrompt
      || buildAutoPrompt(task.type, task.instruction, brief, params.merchantCtx)

    try {
      const clipPath = await generateFillerClip({
        prompt,
        duration: task.durationSec,
        tempDir,
        clipId: `auto_${variantType}_${task.id}`,
      })

      clips.push({
        localPath: clipPath,
        durationSec: task.durationSec,
        isAiGenerated: true,
        shotType: task.type,
      })

      generationLogs.push({
        variantType,
        shotTaskId: task.id,
        shotType: task.type,
        prompt,
        duration: task.durationSec,
        mode: 'AUTO',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      // AUTO 模式下生成失败：记录日志，跳过该镜头（不阻塞渲染）
      console.warn(`[auto-render] Seedance 生成失败 (${variantType}/${task.type}):`, err)
      generationLogs.push({
        variantType,
        shotTaskId: task.id,
        shotType: task.type,
        error: err instanceof Error ? err.message : String(err),
        mode: 'AUTO',
        timestamp: new Date().toISOString(),
      })
    }
  }

  const subtitles = buildSubtitles(variantType, clips, brief)
  return { type: variantType, clips, subtitles }
}

// ========================
// AUTO 模式 Prompt 生成
// ========================

/**
 * AUTO 模式专用 Prompt 构建：在 buildFillerPrompt 基础上增强上下文注入。
 *
 * 增强维度：
 * - 注入 brief.hook（开头钩子文案）
 * - 注入 brief.mainMessage（核心信息）
 * - 注入 merchantCtx.promptPrefix（商家画像前缀）
 * - 统一竖屏 9:16、高清画质
 */
function buildAutoPrompt(
  shotType: string,
  instruction: string,
  brief: { hook: string | null; mainMessage: string | null; suggestedCta: string | null },
  merchantCtx?: MerchantContext | null
): string {
  // 基础 prompt 复用 buildFillerPrompt 的 typeDescriptions 映射
  const basePrompt = buildFillerPrompt(shotType, instruction, brief, null)

  // 增强：注入 brief 上下文和商家画像
  const enhancements: string[] = []

  if (brief.hook) {
    enhancements.push(`视频开头钩子：${brief.hook}`)
  }
  if (brief.mainMessage) {
    enhancements.push(`核心信息：${brief.mainMessage}`)
  }

  const enhancementStr = enhancements.length > 0
    ? `\n${enhancements.join('。')}。`
    : ''

  if (merchantCtx?.promptPrefix) {
    return `${merchantCtx.promptPrefix}\n${basePrompt}${enhancementStr}`
  }

  return `${basePrompt}${enhancementStr}`
}
