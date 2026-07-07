/**
 * POST /api/content-briefs/[briefId]/retry-render — 重试失败的渲染
 *
 * 当 ContentBrief 因渲染失败进入 FAILED 状态时，允许用户触发重试。
 * 将状态回退到 MATERIALS_UPLOADED（素材仍可用），然后重新入队渲染。
 *
 * 流程：
 * 1. 验证 ContentBrief 存在且归属当前用户
 * 2. 验证当前状态为 FAILED（状态机守卫：仅 FAILED 可重试）
 * 3. 状态回退到 MATERIALS_UPLOADED（经状态机校验）
 * 4. 积分预检 + 入队前冻结（复用 render/route.ts 的计费逻辑）
 * 5. 入队 render-local-video
 * 6. 返回 202 + jobId
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 202: { jobId: string, message: string }
 * - 400: 状态不允许重试
 * - 401: 未认证
 * - 402: 积分不足
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { estimateRenderCost, reserveMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { getBalance } from '@/lib/shared/credit-service'
import { renderLocalVideoQueue } from '@/lib/shared/queue'
import { ApiError } from '@/lib/shared/api-error'
import { canRetryRender, assertBriefTransition } from '@/lib/merchant/content-brief-state-machine'
import type { ContentBriefStatus } from '@/generated/prisma'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

const RENDER_VARIANT_COUNT = 3
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
          include: { rawAssets: true },
        },
      },
    })

    if (!brief) {
      throw new ApiError('NOT_FOUND', `ContentBrief 不存在: ${briefId}`, 404)
    }

    // 鉴权：验证归属
    if (brief.store.merchant.userId !== userId) {
      throw new ApiError('FORBIDDEN', '无权操作此内容任务', 403)
    }

    // 状态机守卫：仅 FAILED 状态可重试渲染
    if (!canRetryRender(brief.status)) {
      throw new ApiError(
        'INVALID_STATE',
        `ContentBrief 当前状态为 "${brief.status}"，仅 FAILED 状态允许重试渲染`,
        400,
      )
    }

    // 校验素材就绪：所有 required ShotTask 需有素材
    const requiredTasks = brief.shotTasks.filter((t) => t.required)
    const missingAssets = requiredTasks.filter((t) => t.rawAssets.length === 0)
    if (missingAssets.length > 0) {
      throw new ApiError(
        'ASSETS_NOT_READY',
        `以下必拍镜头缺少素材: ${missingAssets.map((t) => t.title).join(', ')}`,
        400,
      )
    }

    // 状态机校验：FAILED → MATERIALS_UPLOADED
    assertBriefTransition(brief.status as ContentBriefStatus, 'MATERIALS_UPLOADED')

    // 积分预检 + 冻结（复用 render/route.ts 的计费逻辑）
    const groupDurations = brief.shotTasks.reduce(
      (sum, t) => [...sum, t.durationSec * RENDER_VARIANT_COUNT],
      [] as number[],
    )
    const cost = estimateRenderCost(groupDurations, RENDER_RESOLUTION)

    const balance = await getBalance(userId)
    if (balance < cost) {
      throw new ApiError(
        'INSUFFICIENT_CREDITS',
        `积分不足：重试渲染需 ${cost} 积分，当前余额 ${balance}`,
        402,
      )
    }

    // 状态回退：FAILED → MATERIALS_UPLOADED
    await prisma.contentBrief.update({
      where: { id: briefId },
      data: { status: 'MATERIALS_UPLOADED' },
    })

    // 冻结积分
    await reserveMerchantCredits({
      userId,
      bizRefType: 'CONTENT_BRIEF',
      bizRefId: briefId,
      amount: cost,
      remark: `[RETRY_RENDER] 重试渲染冻结 ${cost} 积分`,
    })

    // 入队渲染
    const job = await renderLocalVideoQueue.add('render-local-video', {
      contentBriefId: briefId,
      userId,
    })

    return NextResponse.json(
      { jobId: job.id, message: '渲染任务已重新入队' },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.statusCode })
    }
    console.error('[retry-render] 未知错误:', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: '服务器内部错误' },
      { status: 500 },
    )
  }
}
