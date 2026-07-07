/**
 * POST /api/content-briefs/[briefId]/auto-render — 一键出片（AI 全自动渲染）
 *
 * 流程：
 * 1. 鉴权（brief.store.merchant.userId === currentUserId）
 * 2. 状态检查（DRAFT 或 READY_TO_SHOOT 可触发一键出片）
 * 3. 标记 renderMode = "AUTO"
 * 4. 积分预检 + 冻结（AUTO 模式成本 = 全部 ShotTask 时长 × 3 版本）
 * 5. 入队 render-local-video（mode = AUTO_RENDER）
 * 6. 返回 202 + jobId
 *
 * 与 render/route.ts 的差异：
 * - 不需要素材就绪检查（AUTO 模式全部 AI 生成，无上传环节）
 * - 不需要同质化检查（纯 AI 生成内容）
 * - 成本更高（全部镜头均需 Seedance 调用）
 *
 * 响应：
 * - 202: { jobId: string, message: string }
 * - 400: 状态不允许
 * - 401: 未认证
 * - 402: 积分不足
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 409: 已在渲染中
 * - 500: 服务器内部错误
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { estimateRenderCost, reserveMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { getBalance } from '@/lib/shared/credit-service'
import { renderLocalVideoQueue } from '@/lib/shared/queue'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 渲染输出的版本数量（PROMOTION / ATMOSPHERE / OWNER_TALKING） */
const RENDER_VARIANT_COUNT = 3

/** 渲染目标分辨率 */
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
        shotTasks: true,
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

    // 状态检查：AUTO 模式仅允许从 DRAFT 或 READY_TO_SHOOT 触发
    if (brief.status !== 'DRAFT' && brief.status !== 'READY_TO_SHOOT') {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_STATUS',
            message: `当前状态 ${brief.status} 不支持一键出片，仅 DRAFT 或 READY_TO_SHOOT 状态可触发`,
          },
        },
        { status: 400 }
      )
    }

    // 检查是否有 ShotTasks
    if (brief.shotTasks.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: 'NO_SHOT_TASKS',
            message: '当前内容任务无拍摄计划，无法执行一键出片',
          },
        },
        { status: 400 }
      )
    }

    // 标记 renderMode = "AUTO"
    await prisma.contentBrief.update({
      where: { id: briefId },
      data: { renderMode: 'AUTO' },
    })

    // 估算积分成本（AUTO 模式：全部 ShotTask 时长 × 3 版本）
    const plannedGroupDuration = brief.shotTasks.reduce(
      (sum, task) => sum + task.durationSec,
      0
    )
    const groupDurations = Array.from(
      { length: RENDER_VARIANT_COUNT },
      () => plannedGroupDuration
    )
    const estimatedCost = estimateRenderCost(groupDurations, RENDER_RESOLUTION)

    // 余额预检
    const balance = await getBalance(userId)
    if (balance < estimatedCost) {
      return NextResponse.json(
        {
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: `积分不足：一键出片需 ${estimatedCost} 积分，当前余额 ${balance}`,
            details: { required: estimatedCost, balance },
          },
        },
        { status: 402 }
      )
    }

    // 冻结积分（RESERVE）
    try {
      await reserveMerchantCredits({
        userId,
        bizRefType: 'CONTENT_BRIEF',
        bizRefId: briefId,
        amount: estimatedCost,
        remark: `[AUTO_RENDER] 一键出片冻结 ${estimatedCost} 积分（brief=${briefId}）`,
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

    // 入队 render-local-video（mode = AUTO_RENDER）
    const job = await renderLocalVideoQueue.add(
      `auto-render-${briefId}`,
      {
        contentBriefId: briefId,
        userId,
        mode: 'AUTO_RENDER',
      },
      {
        jobId: `auto-render-${briefId}-${Date.now()}`,
      }
    )

    return NextResponse.json(
      {
        jobId: job.id,
        message: '一键出片任务已提交，AI 正在为您生成全部镜头，预计需要 5-15 分钟',
        estimatedCost,
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
    console.error('[POST /api/content-briefs/[briefId]/auto-render] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
