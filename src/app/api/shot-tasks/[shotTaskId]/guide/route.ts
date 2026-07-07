/**
 * GET /api/shot-tasks/[shotTaskId]/guide — 获取拍摄前可视化引导（需求 3.1, 3.2, 3.3, 3.6）
 *
 * 读取 ShotTask（type/title/instruction/durationSec/framingGuide/qualityRules）装配
 * ShotTaskWithGuide，调用 capture-director.buildCaptureGuide 产出结构化构图、关键要点清单、
 * 量化质检阈值与通俗话术。纯计算，不消耗积分。
 *
 * 鉴权：shotTask → contentBrief → store → merchant → userId，验证
 * shotTask.contentBrief.store.merchant.userId === currentUserId。
 *
 * 响应：
 * - 200: { guide: CaptureGuide }
 * - 401: 未认证
 * - 403: 无权限（归属验证失败）
 * - 404: ShotTask 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 3.1, 3.3, 3.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { buildCaptureGuide, type ShotTaskWithGuide } from '@/lib/merchant/capture-director'
import type { ShotTaskType } from '@/types/merchant'

interface RouteContext {
  params: Promise<{ shotTaskId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shotTaskId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 读取 ShotTask 并沿 brief→store→merchant 装配鉴权链
    const shotTask = await prisma.shotTask.findUnique({
      where: { id: shotTaskId },
      include: {
        contentBrief: {
          include: {
            store: {
              include: {
                merchant: { select: { userId: true } },
              },
            },
          },
        },
        // 已生成的镜头参考图素材（IMAGE 类型），供引导对照展示
        rawAssets: {
          where: { type: 'IMAGE' },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!shotTask) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '拍摄任务不存在' } },
        { status: 404 }
      )
    }

    // 验证归属：shotTask.contentBrief.store.merchant.userId === currentUserId
    if (shotTask.contentBrief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该拍摄任务' } },
        { status: 403 }
      )
    }

    // 装配 ShotTaskWithGuide：仅取构建引导必要字段
    const guideInput: ShotTaskWithGuide = {
      type: shotTask.type as ShotTaskType,
      title: shotTask.title,
      instruction: shotTask.instruction,
      durationSec: shotTask.durationSec,
      framingGuide: shotTask.framingGuide as Record<string, unknown> | null,
      qualityRules: shotTask.qualityRules as Record<string, unknown> | null,
      // 已生成的参考图 URL（若有），供前端对照
      referenceUrls: shotTask.rawAssets
        .map((a) => a.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0),
    }

    const guide = buildCaptureGuide({ shotTask: guideInput })

    return NextResponse.json({ guide })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/shot-tasks/[shotTaskId]/guide] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
