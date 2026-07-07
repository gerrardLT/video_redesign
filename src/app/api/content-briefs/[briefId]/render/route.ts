/**
 * POST /api/content-briefs/[briefId]/render — 触发视频生成
 *
 * 流程：
 * 1. 验证素材就绪（所有 required ShotTask 有 qualityScore >= 60 的素材）
 * 2. 同质化检查 calculateContentEntropy（< 40 拒绝）
 * 3. 积分预检 + 入队前冻结：estimateRenderCost 估算应扣积分，
 *    余额不足返回 402 INSUFFICIENT_CREDITS；余额足够则 reserveMerchantCredits 冻结
 * 4. 入队 render-local-video
 * 5. 返回 202 + jobId
 *
 * 计费模型：商家视频渲染统一消费视频重塑既有的「积分（Credit）」，
 * 入队前按 estimateRenderCost（Σ 各分镜组 estimateGroupCreditCost）RESERVE 冻结，
 * 渲染成功时 CHARGE 记账（差额退回）、失败时 REFUND 退款（由 local-render-service 承接）。
 * 已废除此前本地生活自建的额度体系（checkMerchantQuota / RENDER_VIDEO）。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 202: { jobId: string, message: string }
 * - 400: 素材未就绪
 * - 401: 未认证
 * - 402: 积分不足（含 required / balance）
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 409: 已在渲染中
 * - 422: 同质化检测不通过（score < 40）
 * - 500: 服务器内部错误
 *
 * Requirements: 2.3, 3.1, 3.2, 3.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { calculateContentEntropy } from '@/lib/merchant/content-entropy-service'
import { estimateRenderCost, reserveMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { getBalance } from '@/lib/shared/credit-service'
import { renderLocalVideoQueue } from '@/lib/shared/queue'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/**
 * 渲染输出的版本数量（PROMOTION / ATMOSPHERE / OWNER_TALKING）。
 * 每个版本视为一个分镜组，参与 estimateRenderCost 求和。
 * 与 local-render-service 中 variantTypes 的 3 个版本保持一致。
 */
const RENDER_VARIANT_COUNT = 3

/**
 * 渲染目标分辨率：local-render-service 固定输出 720p（720x1280 竖屏），
 * 估算成本时透传给 estimateGroupCreditCost。
 */
const RENDER_RESOLUTION = '720p'

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 ContentBrief 并验证归属
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: {
            merchant: { select: { userId: true, id: true } },
          },
        },
        shotTasks: {
          include: {
            rawAssets: true,
          },
        },
      },
    })

    if (!brief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 防止重复触发
    if (brief.status === 'RENDERING') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: '视频正在生成中，请勿重复触发' } },
        { status: 409 }
      )
    }

    // 1. 验证素材就绪：所有 required ShotTask 须有 qualityScore >= 60 的 RawAsset
    const requiredTasks = brief.shotTasks.filter((t) => t.required)
    const unreadyTasks = requiredTasks.filter((task) => {
      const passedAsset = task.rawAssets.find(
        (a) => a.qualityScore !== null && a.qualityScore >= 60
      )
      return !passedAsset
    })

    if (unreadyTasks.length > 0) {
      const missing = unreadyTasks.map((t) => ({ id: t.id, title: t.title, order: t.order }))
      return NextResponse.json(
        {
          error: {
            code: 'MATERIALS_NOT_READY',
            message: `${unreadyTasks.length} 个必拍镜头尚未上传合格素材`,
            details: { missingTasks: missing },
          },
        },
        { status: 400 }
      )
    }

    // 2. 同质化检查
    const entropyResult = await calculateContentEntropy({
      contentBriefId: briefId,
      storeId: brief.storeId,
    })

    if (entropyResult.uniquenessScore < 40) {
      return NextResponse.json(
        {
          error: {
            code: 'ENTROPY_BLOCKED',
            message: `内容独特性评分过低（${entropyResult.uniquenessScore}/100），与历史内容高度重复`,
            details: {
              uniquenessScore: entropyResult.uniquenessScore,
              duplicateRisk: entropyResult.duplicateRisk,
              reasons: entropyResult.reasons,
            },
          },
        },
        { status: 422 }
      )
    }

    // 3. 估算渲染积分成本并冻结（RESERVE）——入队前完成，余额不足拒绝入队
    // 每个版本视为一个分镜组，组时长按本 brief 全部 ShotTask 的计划时长求和估算
    // （素材编排时各版本均纳入有素材的镜头，此估值为保守上限，渲染成功后按实际时长 CHARGE，差额退回）。
    const plannedGroupDuration = brief.shotTasks.reduce(
      (sum, task) => sum + task.durationSec,
      0
    )
    const groupDurations = Array.from(
      { length: RENDER_VARIANT_COUNT },
      () => plannedGroupDuration
    )
    const estimatedCost = estimateRenderCost(groupDurations, RENDER_RESOLUTION)

    // 余额预检：不足则返回 402，携带 required / balance 供前端提示，绝不入队
    const balance = await getBalance(userId)
    if (balance < estimatedCost) {
      return NextResponse.json(
        {
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: `积分不足：本次渲染需 ${estimatedCost} 积分，当前余额 ${balance}`,
            details: { required: estimatedCost, balance },
          },
        },
        { status: 402 }
      )
    }

    // 正式冻结：经 withCreditLock 串行化写入 RESERVE 流水（jobId 恒为 null，关联走 CONTENT_BRIEF/briefId）。
    // 并发场景下余额可能在预检后被其他操作扣减，reserveMerchantCredits 会再次校验并抛 402。
    try {
      await reserveMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: briefId,
        amount: estimatedCost,
        remark: `[MERCHANT_RENDER] 渲染冻结 ${estimatedCost} 积分（brief=${briefId}）`,
      })
    } catch (reserveError) {
      if (
        reserveError instanceof ApiError &&
        reserveError.code === 'INSUFFICIENT_CREDITS'
      ) {
        const latestBalance = await getBalance(userId)
        return NextResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_CREDITS',
              message: reserveError.message,
              details: { required: estimatedCost, balance: latestBalance },
            },
          },
          { status: 402 }
        )
      }
      throw reserveError
    }

    // 4. 入队 render-local-video
    const job = await renderLocalVideoQueue.add(
      `render-${briefId}`,
      {
        contentBriefId: briefId,
        userId,
        storeId: brief.storeId,
      },
      {
        jobId: `render-${briefId}-${Date.now()}`,
      }
    )

    // 更新 ContentBrief 状态为 RENDERING
    await prisma.contentBrief.update({
      where: { id: briefId },
      data: { status: 'RENDERING' },
    })

    // 同质化警告信息（40-60 之间时附带）
    const entropyWarning = entropyResult.uniquenessScore <= 60
      ? {
          uniquenessScore: entropyResult.uniquenessScore,
          duplicateRisk: entropyResult.duplicateRisk,
          reasons: entropyResult.reasons,
        }
      : undefined

    return NextResponse.json(
      {
        jobId: job.id,
        message: '视频生成任务已提交，请等待完成',
        ...(entropyWarning && { entropyWarning }),
      },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/render] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
