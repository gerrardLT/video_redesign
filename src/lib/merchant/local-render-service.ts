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
 * 积分与锁集成（统一计费体系，RESERVE→CHARGE/REFUND）：
 * - 计费模型：商家视频渲染统一消费视频重塑既有的「积分(credit)」。
 *   入口 render/route.ts 在入队前按计划时长 RESERVE 冻结积分（关联键 CONTENT_BRIEF + briefId）；
 *   本服务在渲染成功时按 3 个 VideoVariant 实际渲染时长经 estimateGroupCreditCost 求和执行 CHARGE
 *   （多冻结差额自动 REFUND 退回），与置 GENERATED 同事务提交；
 *   渲染失败时按关联键幂等 REFUND，全额退还入队前冻结的积分。
 * - distributed-lock: 防重复渲染（TTL 720s）
 * - progress-publisher: SSE 实时进度
 *
 * 超时控制：整体 600s 计时器，超时后置 FAILED
 */

import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, rm } from 'fs/promises'
import os from 'os'

import { prisma } from '../shared/db'
import { acquireLock, releaseLock } from '../shared/distributed-lock'
import { uploadBuffer, getSignedObjectUrl, downloadToTemp } from '../shared/storage'
import * as progressPublisher from '../shared/progress-publisher'
import { estimateGroupCreditCost, getBalance } from '../shared/credit-service'
import {
  estimateRenderCost,
  reserveMerchantCredits,
  chargeMerchantCredits,
  refundMerchantCredits,
} from './merchant-billing-service'
import { computeReshootScope } from './impact-scope-service'
import { ApiError } from '../shared/api-error'
import { buildMerchantContext, type MerchantContext } from './merchant-context-builder'
import {
  RENDER_TIMEOUT_MS,
  RENDER_LOCK_TTL_MS,
  MAX_FILLER_CLIPS_PER_VARIANT,
  MAX_FILLER_DURATION_SEC,
} from '@/constants/merchant'
import {
  type ClipSegment,
  type VariantAssembly,
  type RenderOutput,
  type RenderAdvancedParams,
  VARIANT_SHOT_ORDER,
  VARIANT_TITLES,
  RENDER_RESOLUTION,
  compositeVideo,
  buildSubtitles,
  sortShotTasksByVariant,
  buildFillerPrompt,
  generateFillerClip,
  resolveAdvancedParams,
} from '../video/render-pipeline'

import type { VideoVariantType } from '@/types/merchant'
import { Prisma } from '@/generated/prisma'
import type { VideoVariant, ContentBriefStatus } from '@/generated/prisma'
import { assertBriefTransition } from './content-brief-state-machine'

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

  // results 声明在 try 外部，以便 catch 块在部分成功时也能访问已生成的 variant
  let results: Array<{ id: string; type: string; ossKey: string | null }> = []

  try {
    // Step 1: 获取分布式锁，防止重复渲染（TTL 720s，与 RENDER_LOCK_TTL_MS 对应）
    const lockAcquired = await acquireLock(lockKey, lockValue)
    if (!lockAcquired) {
      throw new Error(
        `渲染锁获取失败：ContentBrief ${contentBriefId} 正在被其他进程渲染（锁 TTL ${RENDER_LOCK_TTL_MS / 1000}s）`
      )
    }

    // Step 2: 置渲染中状态（幂等）
    // 入口 render/route.ts 已在入队前按计划时长 RESERVE 冻结积分（关联键 CONTENT_BRIEF + briefId），
    // 此处仅确保 ContentBrief 处于 RENDERING 状态（重复进入时幂等），实际 CHARGE / REFUND 在渲染收尾处理。
    const currentBrief = await prisma.contentBrief.findUniqueOrThrow({
      where: { id: contentBriefId },
      select: { status: true },
    })

    if (currentBrief.status === 'RENDERING') {
      console.info(`[local-render] ContentBrief ${contentBriefId} 已处于 RENDERING 状态`)
    } else {
      // 状态机守卫：仅合法前置状态可进入 RENDERING
      assertBriefTransition(currentBrief.status as ContentBriefStatus, 'RENDERING')
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

    // 构建商家画像上下文（注入到 Seedance 补充片段 prompt，让 AI 生成的镜头更懂门店）
    const merchantCtx = await buildMerchantContext(brief.storeId).catch((err) => {
      console.warn('[local-render] 构建商家画像上下文失败（不影响主流程）:', err instanceof Error ? err.message : String(err))
      return null
    })

    // Step 5: 对 3 种版本分别编排和渲染
    const variantTypes: VideoVariantType[] = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING']
    // results 声明提到外层以便 catch 块访问，用于精确退款计算
    results = []
    // 收集 3 个 VideoVariant 的实际渲染时长，用于渲染成功后按组求和 CHARGE 实扣积分
    const renderedDurations: number[] = []

    for (let vi = 0; vi < variantTypes.length; vi++) {
      const variantType = variantTypes[vi]
      // 每版本独立日志数组，避免跨版本污染
      const generationLogs: Record<string, unknown>[] = []

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
        merchantCtx,
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
          renderParams: renderOutput.renderParams as unknown as Prisma.InputJsonValue,
          generationLog: generationLogs as unknown as Prisma.InputJsonValue,
        },
      })

      results.push({
        id: variant.id,
        type: variant.type,
        ossKey: variant.ossKey,
      })

      // 收集本版本的实际渲染时长，用于渲染成功后按组求和 CHARGE 实扣积分
      renderedDurations.push(renderOutput.durationSec)
    }

    // Step 6: 渲染成功——置 GENERATED 并在同一事务内 CHARGE 实扣积分。
    // 入口 render/route.ts 已在入队前按计划时长 RESERVE 冻结积分（关联键 CONTENT_BRIEF + briefId）；
    // 此处按 3 个 VideoVariant 的实际渲染时长经 estimateGroupCreditCost 逐组求和得到实扣额，
    // 交由 chargeMerchantCredits 在同事务内记 CHARGE（多冻结差额自动 REFUND 退回，净扣 = 实扣额）。
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

    // 发布完成事件
    await progressPublisher.publishCompleted(userId, 'generation', contentBriefId)

    return results

  } catch (error) {
    // 渲染失败：置 FAILED 状态，并按关联键幂等 REFUND，全额退还入队前 RESERVE 冻结的积分。
    // REFUND 幂等（已退款则跳过），故 BullMQ 重试安全：重试不会重复退款。
    try {
      await prisma.contentBrief.update({
        where: { id: contentBriefId },
        data: { status: 'FAILED' },
      })
    } catch (statusErr) {
      console.error('[local-render] 更新 FAILED 状态失败:', statusErr)
    }

    // 退还入队前冻结的积分（幂等全额退款）；退款本身失败仅记日志，不掩盖原始渲染错误
    try {
      await refundMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: contentBriefId,
      })
    } catch (refundErr) {
      console.error('[local-render] 退还冻结积分失败:', refundErr)
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
// 单版本重生成 / 局部重拍重合成（需求 4）
// ========================

/**
 * 单版本重生成（需求 4.2）：仅重生成指定 VideoVariant，保留其它版本。
 *
 * 隔离性（Property 14）：就地更新该版本记录（保持同一 id 与 OSS 路径），版本总数不变，
 * 其它版本的 id 与内容不受影响，仅本版本被新产物替换。
 *
 * 复用既有渲染管线（assembleVariantClips + compositeVideo + OSS 上传）与计费链路：
 *   1. 余额预检（需求 4.8 / 0.7）：余额 < 成本时在预检阶段显式拒绝，绝不先扣后退；
 *   2. RESERVE 冻结（经 withCreditLock 串行化，需求 4.2/0.8），关联键采用每次调用唯一的
 *      CONTENT_BRIEF + bizRefId，与该 brief 整体渲染冻结键互不冲突、可重复重生成各自独立计费；
 *   3. 成功 → 与就地更新同事务 CHARGE 实扣；失败/超时 → 幂等全额 REFUND + 状态回滚（不改动该版本），
 *      错误抛出不静默（需求 0.4）。
 *
 * 高级参数（运营型用户，需求 4.6/4.7）：经 resolveAdvancedParams 校验后落入渲染管线，
 * 并将本次实际生效的参数标注到结果 VideoVariant.renderParams（Property 16 可解释）。
 *
 * @param input.videoVariantId 待重生成的版本 ID
 * @param input.userId         操作用户 ID（计费主体）
 * @param input.advancedParams 运营型用户高级抽屉参数（可选，默认一键路径不传）
 * @returns 重生成后的 VideoVariant
 * @throws ApiError('INSUFFICIENT_CREDITS') 余额不足；ApiError('VALIDATION_ERROR') 高级参数非法；其它错误原样抛出
 */
export async function regenerateSingleVariant(input: {
  videoVariantId: string
  userId: string
  advancedParams?: RenderAdvancedParams
}): Promise<VideoVariant> {
  const { videoVariantId, userId, advancedParams } = input

  // 读取目标版本 + 所属 brief + 全部镜头与素材（重新合成所需上下文）
  const variant = await prisma.videoVariant.findUniqueOrThrow({
    where: { id: videoVariantId },
    include: {
      contentBrief: {
        include: {
          shotTasks: { include: { rawAssets: true }, orderBy: { order: 'asc' } },
          store: true,
        },
      },
    },
  })

  const brief = variant.contentBrief
  const contentBriefId = brief.id
  const variantType = variant.type

  // 校验高级参数（非法取值显式拒绝，不静默忽略）
  const resolved = resolveAdvancedParams(variantType, advancedParams)

  // 成本估算：单版本视为一个分镜组，组时长 = 本 brief 全部镜头计划时长之和（与渲染入口口径一致）
  const plannedGroupDuration = brief.shotTasks.reduce((sum, t) => sum + t.durationSec, 0)
  const cost = estimateRenderCost([plannedGroupDuration], RENDER_RESOLUTION)

  // 余额预检（需求 4.8 / 0.7）：不足在预检阶段显式拒绝，绝不进入 reserve/扣减
  const balance = await getBalance(userId)
  if (balance < cost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：重新生成此版本需 ${cost} 积分，当前余额 ${balance}`,
      402
    )
  }

  // 每次重生成独立计费键，互不幂等覆盖，且不与该 brief 整体渲染冻结键冲突
  const bizRefId = `REGEN_VARIANT:${videoVariantId}:${randomUUID()}`
  const lockKey = `render:variant:${videoVariantId}`
  const lockValue = randomUUID()
  const tempDir = path.join(os.tmpdir(), `regen-${videoVariantId}-${Date.now()}`)

  // RESERVE 冻结（经 withCreditLock 串行化，需求 4.2/0.8）
  await reserveMerchantCredits({
    userId,
    bizRefType: 'CONTENT_BRIEF',
    bizRefId,
    amount: cost,
    remark: `[MERCHANT_REGEN] 单版本重生成冻结 ${cost} 积分（variant=${videoVariantId}）`,
  })

  let timeoutReached = false
  const timeoutTimer = setTimeout(() => { timeoutReached = true }, RENDER_TIMEOUT_MS)

  try {
    // 获取版本级分布式锁，防止同一版本被并发重生成（TTL 720s）
    const lockAcquired = await acquireLock(lockKey, lockValue)
    if (!lockAcquired) {
      throw new Error(
        `重生成锁获取失败：VideoVariant ${videoVariantId} 正在被其他进程重生成（锁 TTL ${RENDER_LOCK_TTL_MS / 1000}s）`
      )
    }

    await mkdir(tempDir, { recursive: true })

    // 构建商家画像上下文（注入到 Seedance 补充片段 prompt）
    const merchantCtx = await buildMerchantContext(brief.storeId).catch(() => null)

    const generationLogs: Record<string, unknown>[] = []

    // 编排素材（高级参数 templateId/durationSec 经 resolved 透传）
    const assembly = await assembleVariantClips({
      variantType,
      shotOrderType: resolved.orderType,
      fillerDurationCapSec: resolved.fillerDurationCapSec,
      shotTasks: brief.shotTasks,
      tempDir,
      contentBriefId,
      brief,
      merchantCtx,
      generationLogs,
    })

    if (timeoutReached) {
      throw new Error(`重生成超时（${RENDER_TIMEOUT_MS / 1000}s）：VideoVariant ${videoVariantId}`)
    }

    // FFmpeg 合成（高级参数 style 经 resolved 透传字幕样式）
    const renderOutput = await compositeVideo({
      variantId: videoVariantId,
      assembly,
      tempDir,
      subtitleStyleType: resolved.styleType,
    })

    // 上传新产物：沿用稳定 OSS 路径覆盖旧文件，保持 variantId 不变 → 仅本版本被替换（隔离性）
    const storeId = brief.storeId
    const videoOssKey = `merchant/${storeId}/variants/${videoVariantId}.mp4`
    const coverOssKey = `merchant/${storeId}/variants/${videoVariantId}_cover.jpg`
    await uploadBuffer(videoOssKey, renderOutput.videoBuffer)
    await uploadBuffer(coverOssKey, renderOutput.coverBuffer)

    // renderParams 标注本次实际生效的高级参数（需求 4.7 / Property 16 可解释）
    const renderParams = { ...renderOutput.renderParams, advancedParams: resolved.applied }
    // regenScope 记录本次重生成范围（单版本模式，便于追溯）
    const regenScope = {
      mode: 'SINGLE_VARIANT',
      videoVariantId,
      advancedParams: resolved.applied,
      regeneratedAt: new Date().toISOString(),
    }

    // 就地更新该版本（同 id），其它版本不受影响（Property 14），与 CHARGE 同事务提交
    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.videoVariant.update({
        where: { id: videoVariantId },
        data: {
          ossKey: videoOssKey,
          coverOssKey,
          durationSec: renderOutput.durationSec,
          width: renderOutput.width,
          height: renderOutput.height,
          subtitles: renderOutput.subtitles,
          renderParams: renderParams as unknown as Prisma.InputJsonValue,
          generationLog: generationLogs as unknown as Prisma.InputJsonValue,
          regenScope: regenScope as unknown as Prisma.InputJsonValue,
        },
      })
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId,
        actualAmount: cost,
      })
      return v
    })

    return updated
  } catch (error) {
    // 失败/超时：幂等全额 REFUND，不改动该版本（状态回滚到重生成前）；退款失败仅记日志，不掩盖原始错误
    try {
      await refundMerchantCredits({ userId, bizRefType: 'CONTENT_BRIEF', bizRefId })
    } catch (refundErr) {
      console.error('[local-render] 单版本重生成失败后退款失败:', refundErr)
    }
    throw error
  } finally {
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

/**
 * 局部重拍重合成（需求 4.3, 4.5）：替换某 ShotTask 素材后，仅基于受影响范围重新合成。
 *
 * 受影响范围由 impact-scope-service.computeReshootScope 计算 = {被重拍镜头所属分镜组}
 * ∪ {沿 frame-continuity 尾帧链依赖的后续同场景分镜组}。承接关系数据缺失时
 * computeReshootScope 显式抛错，本函数让该错误向上传播（不吞错、不静默缩小范围，需求 4.5）。
 *
 * 承接链上的后续同场景组一并重算，保证画面承接不断裂（需求 4.5）：本 brief 的每个版本均
 * 以当前最新素材（被重拍镜头素材已被替换）重合成，仅在全部版本成功后同事务批量就地更新；
 * 任一版本失败则整体 REFUND 回滚，不留接不上的半成品。
 *
 * 计费仅按受影响分镜组时长计入（需求 4.9 仅重渲染受影响范围），复用既有计费链路：
 * 余额预检 → RESERVE（withCreditLock 串行化）→ 成功 CHARGE / 失败 REFUND。
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.shotTaskId     被重拍镜头（ShotTask）ID
 * @param input.userId         操作用户 ID（计费主体）
 * @returns 受影响范围重合成后的全部 VideoVariant
 * @throws computeReshootScope 的承接数据缺失错误；ApiError('INSUFFICIENT_CREDITS') 余额不足；其它错误原样抛出
 */
export async function rerenderAffectedScope(input: {
  contentBriefId: string
  shotTaskId: string
  userId: string
}): Promise<VideoVariant[]> {
  const { contentBriefId, shotTaskId, userId } = input

  // 计算受影响范围；承接数据缺失时此处显式抛错，错误向上传播（不静默缩小范围，需求 4.5）
  const scope = await computeReshootScope({ contentBriefId, shotTaskId })

  // 读取 brief + 镜头 + 素材 + 既有版本（局部重拍以当前最新素材重合成，无需其它镜头重传）
  const brief = await prisma.contentBrief.findUniqueOrThrow({
    where: { id: contentBriefId },
    include: {
      shotTasks: { include: { rawAssets: true }, orderBy: { order: 'asc' } },
      store: true,
      videoVariants: true,
    },
  })

  if (brief.videoVariants.length === 0) {
    throw new Error(
      `局部重拍失败：ContentBrief ${contentBriefId} 尚无任何已生成版本可重合成`
    )
  }

  // 成本：仅按受影响分镜组（含承接链）时长计费（需求 4.9），跨全部待重合成版本求和
  const affectedDuration = brief.shotTasks
    .filter((t) => scope.affectedGroupIds.includes(t.id))
    .reduce((sum, t) => sum + t.durationSec, 0)
  const groupDurations = brief.videoVariants.map(() => affectedDuration)
  const cost = estimateRenderCost(groupDurations, RENDER_RESOLUTION)

  // 余额预检（需求 4.8 / 0.7）：不足在预检阶段显式拒绝，绝不进入 reserve/扣减
  const balance = await getBalance(userId)
  if (balance < cost) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：局部重拍需 ${cost} 积分，当前余额 ${balance}`,
      402
    )
  }

  // 每次局部重拍独立计费键，互不幂等覆盖，且不与该 brief 整体渲染冻结键冲突
  const bizRefId = `RESHOOT:${contentBriefId}:${shotTaskId}:${randomUUID()}`
  const lockKey = `render:brief:${contentBriefId}`
  const lockValue = randomUUID()
  const tempDir = path.join(os.tmpdir(), `reshoot-${contentBriefId}-${Date.now()}`)

  // RESERVE 冻结（经 withCreditLock 串行化，需求 4.8/0.8）
  await reserveMerchantCredits({
    userId,
    bizRefType: 'CONTENT_BRIEF',
    bizRefId,
    amount: cost,
    remark: `[MERCHANT_RESHOOT] 局部重拍冻结 ${cost} 积分（brief=${contentBriefId}, shot=${shotTaskId}）`,
  })

  let timeoutReached = false
  const timeoutTimer = setTimeout(() => { timeoutReached = true }, RENDER_TIMEOUT_MS)

  try {
    // 获取 brief 级分布式锁，防止与整体渲染/其它局部重拍并发（TTL 720s）
    const lockAcquired = await acquireLock(lockKey, lockValue)
    if (!lockAcquired) {
      throw new Error(
        `局部重拍锁获取失败：ContentBrief ${contentBriefId} 正在被其他进程渲染（锁 TTL ${RENDER_LOCK_TTL_MS / 1000}s）`
      )
    }

    await mkdir(tempDir, { recursive: true })

    // regenScope 记录受影响范围（含承接链），写入每个被重合成版本以供追溯（需求 4.5）
    const regenScope = {
      mode: 'RESHOOT_SCOPE',
      reshotShotTaskId: shotTaskId,
      affectedGroupIds: scope.affectedGroupIds,
      hasContinuityChain: scope.hasContinuityChain,
      rerenderedAt: new Date().toISOString(),
    }

    // 构建商家画像上下文（注入到 Seedance 补充片段 prompt）
    const merchantCtx = await buildMerchantContext(brief.storeId).catch(() => null)

    // 先把全部版本以最新素材重合成并上传（任一失败直接抛错，进入 catch 整体退款回滚）
    const rendered: Array<{
      id: string
      videoOssKey: string
      coverOssKey: string
      output: RenderOutput
      generationLogs: Record<string, unknown>[]
    }> = []

    for (let i = 0; i < brief.videoVariants.length; i++) {
      if (timeoutReached) {
        throw new Error(`局部重拍超时（${RENDER_TIMEOUT_MS / 1000}s）：ContentBrief ${contentBriefId}`)
      }

      const existing = brief.videoVariants[i]
      const generationLogs: Record<string, unknown>[] = []

      const assembly = await assembleVariantClips({
        variantType: existing.type,
        shotTasks: brief.shotTasks,
        tempDir,
        contentBriefId,
        brief,
        merchantCtx,
        generationLogs,
      })

      const output = await compositeVideo({
        variantId: existing.id,
        assembly,
        tempDir,
      })

      const storeId = brief.storeId
      const videoOssKey = `merchant/${storeId}/variants/${existing.id}.mp4`
      const coverOssKey = `merchant/${storeId}/variants/${existing.id}_cover.jpg`
      await uploadBuffer(videoOssKey, output.videoBuffer)
      await uploadBuffer(coverOssKey, output.coverBuffer)

      rendered.push({ id: existing.id, videoOssKey, coverOssKey, output, generationLogs })
    }

    // 全部受影响版本重合成成功后，同事务批量就地更新 + CHARGE（承接链一并重算，避免画面断裂）
    const updated = await prisma.$transaction(async (tx) => {
      const list: VideoVariant[] = []
      for (const r of rendered) {
        const v = await tx.videoVariant.update({
          where: { id: r.id },
          data: {
            ossKey: r.videoOssKey,
            coverOssKey: r.coverOssKey,
            durationSec: r.output.durationSec,
            width: r.output.width,
            height: r.output.height,
            subtitles: r.output.subtitles,
            renderParams: r.output.renderParams as unknown as Prisma.InputJsonValue,
            generationLog: r.generationLogs as unknown as Prisma.InputJsonValue,
            regenScope: regenScope as unknown as Prisma.InputJsonValue,
          },
        })
        list.push(v)
      }
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId,
        actualAmount: cost,
      })
      return list
    })

    return updated
  } catch (error) {
    // 失败/超时：幂等全额 REFUND + 整体回滚（未提交事务则版本不变，避免承接链断裂的半成品）
    try {
      await refundMerchantCredits({ userId, bizRefType: 'CONTENT_BRIEF', bizRefId })
    } catch (refundErr) {
      console.error('[local-render] 局部重拍失败后退款失败:', refundErr)
    }
    throw error
  } finally {
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
  /** 镜头排序模板覆盖（高级参数 templateId）；缺省时按 variantType 选用默认排序 */
  shotOrderType?: VideoVariantType
  /** AI 补充片段时长上限覆盖（高级参数 durationSec）；缺省时取 MAX_FILLER_DURATION_SEC */
  fillerDurationCapSec?: number
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
  /** 商家画像上下文（注入到 Seedance 补充片段 prompt） */
  merchantCtx?: MerchantContext | null
  generationLogs: Record<string, unknown>[]
}): Promise<VariantAssembly> {
  const { variantType, shotTasks, tempDir, brief, generationLogs } = params
  // 排序模板：高级参数 templateId 覆盖时按其顺序编排，否则按当前版本默认顺序
  const shotOrder = VARIANT_SHOT_ORDER[params.shotOrderType ?? variantType]
  // AI 补充片段时长上限：高级参数 durationSec 覆盖时取其值，否则取默认上限
  const fillerDurationCap = params.fillerDurationCapSec ?? MAX_FILLER_DURATION_SEC
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
      // 可选镜头缺失：调用 Seedance 生成补充片段（时长受 fillerDurationCap 约束，可由高级参数覆盖）
      const fillerDuration = Math.min(task.durationSec, fillerDurationCap)
      const prompt = task.examplePrompt
        || buildFillerPrompt(task.type, task.instruction, brief, params.merchantCtx)

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
