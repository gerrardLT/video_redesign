/**
 * GET /api/shot-tasks/[shotTaskId]/reshoot-advice — 质检失败重拍建议（需求 3.4）
 *
 * 读取该 ShotTask 最近一次质检结果（RawAsset.qualityReport）+ 该镜头的量化阈值
 * （由 buildCaptureGuide 推导，时长区间来源于 ShotTask.durationSec），
 * 调用 capture-director.buildReshootAdvice 仅针对未通过维度产出具体重拍话术。
 * 纯计算，不消耗积分。
 *
 * 无质检结果时显式提示「尚未上传素材或还没完成质检」，不伪造建议。
 *
 * 鉴权：shotTask → contentBrief → store → merchant → userId。
 *
 * 响应：
 * - 200: { hasReport: true, advices: ReshootAdvice[] } | { hasReport: false, message: string }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ShotTask 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 3.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { buildCaptureGuide, buildReshootAdvice, type ShotTaskWithGuide } from '@/lib/merchant/capture-director'
import type { QualityInspectionResult, ShotTaskType } from '@/types/merchant'

interface RouteContext {
  params: Promise<{ shotTaskId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shotTaskId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 读取 ShotTask + 鉴权链 + 关联素材（按上传时间倒序，取最近一次质检）
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
        rawAssets: {
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

    // 验证归属
    if (shotTask.contentBrief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该拍摄任务' } },
        { status: 403 }
      )
    }

    // 取最近一次带质检报告的素材；无则显式提示，不伪造
    const latestInspected = shotTask.rawAssets.find((a) => a.qualityReport !== null)
    if (!latestInspected || !latestInspected.qualityReport) {
      return NextResponse.json({
        hasReport: false,
        message: '这个镜头还没有质检结果，请先上传拍好的素材，系统检测后才能给出重拍建议',
      })
    }

    // 装配阈值：复用 buildCaptureGuide 推导该镜头的量化质检阈值（时长区间来源于 durationSec）
    const guideInput: ShotTaskWithGuide = {
      type: shotTask.type as ShotTaskType,
      title: shotTask.title,
      instruction: shotTask.instruction,
      durationSec: shotTask.durationSec,
      framingGuide: shotTask.framingGuide as Record<string, unknown> | null,
      qualityRules: shotTask.qualityRules as Record<string, unknown> | null,
    }
    const { qualityThresholds } = buildCaptureGuide({ shotTask: guideInput })

    // qualityReport 即 QualityInspectionResult.report，直接传入重拍建议生成
    const report = latestInspected.qualityReport as unknown as QualityInspectionResult['report']
    const advices = buildReshootAdvice({ report, thresholds: qualityThresholds })

    return NextResponse.json({ hasReport: true, advices })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/shot-tasks/[shotTaskId]/reshoot-advice] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
