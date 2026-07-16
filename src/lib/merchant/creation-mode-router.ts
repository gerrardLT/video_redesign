/**
 * 创作模式路由服务 — Inhot 四模式接入
 *
 * 根据 ContentBrief.creationMode 决定进入哪条渲染管线：
 * - REPLICATE_TRENDING（复刻爆款）：下载源视频落 OSS → 链式触发 HappyHorse V-Edit（源视频 + 素材库参考图 + 提示词）
 * - IMMERSIVE_SHORT（沉浸式短片）：直接走现有 renderLocalVideoVariants（商家上传素材已就位）
 * - INSPIRE_TO_VIDEO（灵感生视频）：构建 Seedance T2V 任务，入队 render-local-video
 * - PHOTO_ANIMATE（照片跟我动）：构建 Seedance I2V 任务（锚定图），入队 render-local-video
 *
 * REPLICATE 汇入 merchant-video-download → merchant-vedit；其余模式汇入 render-local-video 队列。
 * 差异在上游预处理阶段完成。
 *
 * 计费链路不变：入队前 RESERVE → 成功 CHARGE → 失败 REFUND。
 * 复刻爆款按 HappyHorse V-Edit 公式计费（estimateHappyHorseCreditCost），其余模式按渲染公式。
 */

import { prisma } from '../shared/db'
import { renderLocalVideoQueue, merchantVideoDownloadQueue } from '../shared/queue'
import { estimateRenderCost, reserveMerchantCredits } from './merchant-billing-service'
import { estimateHappyHorseCreditCost } from '../shared/credit-calc'
import { ApiError } from '../shared/api-error'
import { logger } from '../shared/logger'

import type { CreationMode } from '@/generated/prisma'

// ========================
// 类型定义
// ========================

export interface RouteCreationModeInput {
  /** 内容任务 ID */
  briefId: string
  /** 操作用户 ID（计费主体） */
  userId: string
  /** 创作模式 */
  mode: CreationMode
  /** 复刻爆款：源视频 URL */
  sourceVideoUrl?: string
  /** 复刻爆款：V-Edit 编辑指令提示词（可用 [Image N] 引用参考图） */
  prompt?: string
  /** 复刻爆款：@ 选中的素材库 RawAsset ID（作为 V-Edit 参考图，最多 5 张） */
  referenceAssetIds?: string[]
  /** 照片跟我动：源图 OSS keys */
  sourceImageKeys?: string[]
  /** 灵感生视频：文字描述 */
  textPrompt?: string
  /** 沉浸式短片：选中的素材标签（可选，存入 brief.tags） */
  materialTags?: string[]
}

export interface RouteCreationModeResult {
  /** 任务 ID（BullMQ job ID） */
  jobId: string
  /** 创作模式 */
  mode: CreationMode
  /** 预估积分消耗 */
  estimatedCost: number
}

// ========================
// 主入口
// ========================

/**
 * 按创作模式路由到对应渲染管线
 *
 * 1. 将创作模式 + 源数据写入 ContentBrief
 * 2. 按模式预处理（下载/校验/构建参数）
 * 3. 积分预检 + 冻结
 * 4. 入队 render-local-video（或 download-video 链式触发）
 */
export async function routeByCreationMode(
  input: RouteCreationModeInput
): Promise<RouteCreationModeResult> {
  const { briefId, userId, mode, sourceVideoUrl, prompt, referenceAssetIds, sourceImageKeys, textPrompt, materialTags } = input

  // Step 1: 校验 brief 归属与状态
  const brief = await prisma.contentBrief.findUniqueOrThrow({
    where: { id: briefId },
    select: {
      id: true, storeId: true, status: true,
      shotTasks: { select: { id: true, durationSec: true } },
    },
  })

  // Step 2: 按模式校验输入并更新 brief
  const briefUpdateData: Record<string, unknown> = {
    creationMode: mode,
  }

  switch (mode) {
    case 'REPLICATE_TRENDING':
      if (!sourceVideoUrl) {
        throw new ApiError('VALIDATION_ERROR', '复刻爆款模式需要提供源视频 URL', 400)
      }
      if (!prompt || prompt.trim().length < 1) {
        throw new ApiError('VALIDATION_ERROR', '复刻爆款模式需要提供编辑指令（告诉 AI 如何替换/修改）', 400)
      }
      if (referenceAssetIds && referenceAssetIds.length > 5) {
        throw new ApiError('VALIDATION_ERROR', '复刻爆款参考素材最多 5 张', 400)
      }
      briefUpdateData.sourceVideoUrl = sourceVideoUrl
      // 复刻爆款复用既有字段承载 V-Edit 入参：prompt → textPrompt、参考素材 ID → sourceImageKeys
      briefUpdateData.textPrompt = prompt
      briefUpdateData.sourceImageKeys = referenceAssetIds ?? []
      break

    case 'IMMERSIVE_SHORT':
      // 素材已通过 RawAsset 上传就位，materialTags 存入 brief.tags 供渲染时参考
      if (materialTags && materialTags.length > 0) {
        briefUpdateData.tags = materialTags
      }
      break

    case 'INSPIRE_TO_VIDEO':
      if (!textPrompt || textPrompt.trim().length < 5) {
        throw new ApiError('VALIDATION_ERROR', '灵感生视频模式需要至少 5 个字的文字描述', 400)
      }
      briefUpdateData.textPrompt = textPrompt
      break

    case 'PHOTO_ANIMATE':
      if (!sourceImageKeys || sourceImageKeys.length === 0) {
        throw new ApiError('VALIDATION_ERROR', '照片跟我动模式需要至少一张源图片', 400)
      }
      briefUpdateData.sourceImageKeys = sourceImageKeys
      break

    default:
      throw new ApiError('VALIDATION_ERROR', `不支持的创作模式: ${mode}`, 400)
  }

  // 更新 brief 创作模式与源数据
  await prisma.contentBrief.update({
    where: { id: briefId },
    data: briefUpdateData,
  })

  // Step 3: 积分预检 + 冻结
  // 与 render/route.ts 口径一致：先求总时长，按单组计费（避免逐镜头 ceil 累计偏高）
  const plannedGroupDuration = brief.shotTasks.reduce((sum, st) => sum + st.durationSec, 0)
  // 复刻爆款走 HappyHorse V-Edit，按 V-Edit 公式估算；其余模式按渲染公式
  const estimatedCost =
    mode === 'REPLICATE_TRENDING'
      ? estimateHappyHorseCreditCost(plannedGroupDuration)
      : estimateRenderCost([plannedGroupDuration], '720p')

  try {
    await reserveMerchantCredits({
      userId,
      bizRefType: 'CONTENT_BRIEF',
      bizRefId: briefId,
      amount: estimatedCost,
      remark: `[CREATION_${mode}] 创作模式渲染冻结 ${estimatedCost} 积分`,
    })
  } catch (reserveError: unknown) {
    if (reserveError instanceof ApiError && reserveError.code === 'INSUFFICIENT_CREDITS') {
      throw new ApiError('INSUFFICIENT_CREDITS', reserveError.message, 402)
    }
    throw reserveError
  }

  // Step 4: 更新 brief 状态为 RENDERING（先于入队，消除竞态窗口）
  await prisma.contentBrief.update({
    where: { id: briefId },
    data: { status: 'RENDERING' },
  })

  // Step 5: 按模式入队
  let jobId: string

  switch (mode) {
    case 'REPLICATE_TRENDING': {
      // 复刻爆款：入队 merchant-video-download，Worker 内完成下载→OSS→RawAsset→链式触发渲染
      const firstShotTask = brief.shotTasks[0]
      if (!firstShotTask) {
        throw new ApiError('VALIDATION_ERROR', '内容任务缺少镜头，无法复刻', 400)
      }
      const downloadJob = await merchantVideoDownloadQueue.add(
        `merchant-download-${briefId}`,
        {
          briefId,
          userId,
          sourceVideoUrl: sourceVideoUrl!,
          storeId: brief.storeId,
          shotTaskId: firstShotTask.id,
          plannedGroupDuration,
          estimatedCost,
          // V-Edit 入参：链式透传给 merchant-vedit worker
          prompt: prompt!,
          referenceAssetIds: referenceAssetIds ?? [],
        },
        {
          jobId: `merchant-download-${briefId}-${Date.now()}`,
        }
      )
      jobId = downloadJob.id!
      break
    }

    case 'IMMERSIVE_SHORT':
    case 'INSPIRE_TO_VIDEO':
    case 'PHOTO_ANIMATE': {
      // 直接入队 render-local-video
      // INSPIRE_TO_VIDEO / PHOTO_ANIMATE 的 T2V/I2V 参数通过 brief 传递，
      // Worker 内 renderLocalVideoVariants 会读取 creationMode 并走对应分支
      const renderJob = await renderLocalVideoQueue.add(
        `creation-${briefId}`,
        {
          contentBriefId: briefId,
          userId,
          mode: 'INTEGRAL',
          creationMode: mode,
        },
        {
          jobId: `creation-${briefId}-${Date.now()}`,
        }
      )
      jobId = renderJob.id!
      break
    }

    default:
      throw new ApiError('VALIDATION_ERROR', `不支持的创作模式: ${mode}`, 400)
  }

  logger.info(
    `[creation-mode-router] 模式=${mode} briefId=${briefId} jobId=${jobId} 预估积分=${estimatedCost}`
  )

  return { jobId, mode, estimatedCost }
}
