/**
 * POST /api/shot-tasks/[shotTaskId]/reference-image — 生成镜头参考图（需求 3.5）
 *
 * 基于 StoreProfile + 镜头脚本，复用 Flux 文生图生成该镜头的参考画面供商家对照。
 * 消耗积分，统一走 credit-service 计费链路（reserve→charge/refund，经 withCreditLock），
 * 余额预检不足时在预检阶段显式拒绝并返回 402，绝不先扣后退、不静默失败。
 *
 * 鉴权：shotTask → contentBrief → store → merchant → userId，
 * 验证 shotTask.contentBrief.store.merchant.userId === currentUserId。
 *
 * 响应：
 * - 200: { referenceUrl: string }
 * - 401: 未认证
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 403: 无权限
 * - 404: ShotTask 不存在
 * - 500: 服务器内部错误（含文生图失败，已自动 REFUND）
 *
 * Requirements: 3.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { generateShotReferenceImage } from '@/lib/merchant/capture-director'

interface RouteContext {
  params: Promise<{ shotTaskId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shotTaskId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 鉴权：沿 shotTask→brief→store→merchant 验证归属
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
      },
    })

    if (!shotTask) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '拍摄任务不存在' } },
        { status: 404 }
      )
    }

    if (shotTask.contentBrief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该拍摄任务' } },
        { status: 403 }
      )
    }

    // 调用服务层：内部完成余额预检（不足抛 402）+ RESERVE→CHARGE/REFUND 计费链路
    const { referenceUrl } = await generateShotReferenceImage({ shotTaskId, userId })

    return NextResponse.json({ referenceUrl })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/shot-tasks/[shotTaskId]/reference-image] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
