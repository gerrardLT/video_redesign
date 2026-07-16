/**
 * POST /api/content-briefs/[briefId]/creation — Inhot 创作模式触发
 *
 * 流程：
 * 1. 鉴权：验证 brief.store.merchant.userId === currentUserId
 * 2. 校验输入（creationMode + 对应参数）
 * 3. 调用 routeByCreationMode — 写入创作模式 + 积分预检 + 入队
 * 4. 返回 202 + jobId
 *
 * 请求体：
 * {
 *   mode: 'REPLICATE_TRENDING' | 'IMMERSIVE_SHORT' | 'INSPIRE_TO_VIDEO' | 'PHOTO_ANIMATE',
 *   sourceVideoUrl?: string,    // 复刻爆款
 *   sourceImageKeys?: string[],  // 照片跟我动
 *   textPrompt?: string,         // 灵感生视频
 * }
 *
 * 响应：
 * - 202: { jobId, mode, estimatedCost }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 402: 积分不足
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { routeByCreationMode } from '@/lib/merchant/creation-mode-router'
import { ApiError } from '@/lib/shared/api-error'

import type { CreationMode } from '@/generated/prisma'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

const VALID_MODES: CreationMode[] = [
  'REPLICATE_TRENDING',
  'IMMERSIVE_SHORT',
  'INSPIRE_TO_VIDEO',
  'PHOTO_ANIMATE',
]

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // 鉴权（getUserIdFromRequest 为同步函数，无需 await）
    const userId = getUserIdFromRequest(request)
    const { briefId } = await context.params

    // 校验 brief 归属
    const brief = await prisma.contentBrief.findFirst({
      where: {
        id: briefId,
        store: { merchant: { userId } },
      },
      select: { id: true, status: true },
    })

    if (!brief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '内容任务不存在或无权访问' } },
        { status: 404 }
      )
    }

    // 前置状态校验：正在生成中的任务禁止重复提交，避免重复入队产生
    // 重复的 HappyHorse 外部调用与重复 VideoVariant（并发点击 / 二次提交）。
    if (brief.status === 'RENDERING') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: '该任务正在生成中，请等待完成后再操作' } },
        { status: 409 }
      )
    }

    // 解析请求体
    const body = await request.json()
    const { mode, sourceVideoUrl, prompt, referenceAssetIds, sourceImageKeys, textPrompt, materialTags } = body as {
      mode?: CreationMode
      sourceVideoUrl?: string
      /** 复刻爆款：V-Edit 编辑指令 */
      prompt?: string
      /** 复刻爆款：@ 选中的素材库 RawAsset ID（最多 5 张） */
      referenceAssetIds?: string[]
      sourceImageKeys?: string[]
      textPrompt?: string
      /** 沉浸式短片：选中的素材标签（可选） */
      materialTags?: string[]
    }

    // 校验 mode
    if (!mode || !VALID_MODES.includes(mode)) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `无效的创建模式，可选值: ${VALID_MODES.join(', ')}`,
          },
        },
        { status: 400 }
      )
    }

    // 路由到对应渲染管线
    const result = await routeByCreationMode({
      briefId,
      userId,
      mode,
      sourceVideoUrl,
      prompt,
      referenceAssetIds,
      sourceImageKeys,
      textPrompt,
      materialTags,
    })

    return NextResponse.json(
      {
        jobId: result.jobId,
        mode: result.mode,
        estimatedCost: result.estimatedCost,
        message: '创作任务已提交，请等待完成',
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
    console.error('[POST /api/content-briefs/[briefId]/creation] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
