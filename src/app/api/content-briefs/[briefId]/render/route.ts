/**
 * POST /api/content-briefs/[briefId]/render — 触发视频生成
 *
 * 流程：
 * 1. 验证素材就绪（所有 required ShotTask 有 qualityScore >= 60 的素材）
 * 2. 额度检查 checkMerchantQuota(RENDER_VIDEO)
 * 3. 同质化检查 calculateContentEntropy（< 40 拒绝）
 * 4. 入队 render-local-video
 * 5. 返回 202 + jobId
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 202: { jobId: string, message: string }
 * - 400: 素材未就绪
 * - 401: 未认证
 * - 403: 无权限 / 额度不足
 * - 404: ContentBrief 不存在
 * - 409: 已在渲染中
 * - 422: 同质化检测不通过（score < 40）
 * - 500: 服务器内部错误
 *
 * Requirements: 7.1, 7.4, 13.6, 14.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { checkMerchantQuota } from '@/lib/merchant-quota-service'
import { calculateContentEntropy } from '@/lib/content-entropy-service'
import { renderLocalVideoQueue } from '@/lib/queue'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

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

    // 2. 额度检查
    const quotaResult = await checkMerchantQuota(userId, 'RENDER_VIDEO')
    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'QUOTA_EXCEEDED',
            message: '视频生成额度已用完',
            details: {
              current: quotaResult.current,
              limit: quotaResult.limit,
              resetDate: quotaResult.resetDate,
            },
          },
        },
        { status: 403 }
      )
    }

    // 3. 同质化检查
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
