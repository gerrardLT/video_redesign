/**
 * POST /api/content-briefs/[briefId]/reshoot — 局部重拍重合成（需求 4.3, 4.4, 4.5, 4.8, 4.9）
 *
 * 替换某 ShotTask 的素材后，仅基于「受影响范围」重新合成，而非要求全部镜头重传。
 * 受影响范围 = 被重拍镜头所属分镜组 ∪ 沿 frame-continuity 尾帧链依赖的后续同场景分镜组
 * （由 impact-scope-service.computeReshootScope 计算，承接链上的后续组一并重算，
 * 保证画面承接不断裂，需求 4.4 / 4.5）。
 *
 * 流程：
 * 1. 鉴权：从 x-user-id header 获取用户 ID
 * 2. 验证归属关系：brief → Store → Merchant.userId === currentUserId
 * 3. 接收 body：{ shotTaskId }（被重拍镜头 ID）
 * 4. 调用 rerenderAffectedScope（其内部含受影响范围计算 + 分布式锁 + 计费链路
 *    reserve→charge/refund + 余额预检），不新建并行计费路径（需求 4.9）
 * 5. 返回受影响范围重合成后的全部 VideoVariant
 *
 * 计费：消耗积分，仅按受影响分镜组时长计入；余额不足在服务层预检阶段显式拒绝（需求 4.8），
 * 由 ApiError('INSUFFICIENT_CREDITS') 映射 402。
 *
 * 承接数据缺失（computeReshootScope 抛出的 framingGuide.scene 缺失等错误）显式返回 422
 * CONTINUITY_DATA_MISSING，绝不静默缩小受影响范围（需求 4.5）。
 *
 * 响应：
 * - 200: { variants, message }
 * - 400: 请求体非法（VALIDATION_ERROR）/ 该 brief 尚无已生成版本可重合成
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 422: 承接数据缺失，无法判定受影响范围（CONTINUITY_DATA_MISSING）
 * - 500: 服务器内部错误
 *
 * Requirements: 4.3, 4.4, 4.5, 4.8, 4.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { rerenderAffectedScope } from '@/lib/local-render-service'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 请求体校验 Schema：必须指定被重拍镜头 ID */
const ReshootRequestSchema = z.object({
  /** 被重拍镜头（ShotTask）ID */
  shotTaskId: z.string().min(1, 'shotTaskId 不能为空'),
})

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    const parseResult = ReshootRequestSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }

    const { shotTaskId } = parseResult.data

    // 查询 ContentBrief 并验证归属：brief → Store → Merchant.userId
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: { merchant: { select: { userId: true } } },
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
        { error: { code: 'FORBIDDEN', message: '无权对该内容任务发起重拍' } },
        { status: 403 }
      )
    }

    // 验证 shotTaskId 归属于该 brief（避免跨 brief 误传；归属错误显式返回）
    const shotTask = await prisma.shotTask.findUnique({
      where: { id: shotTaskId },
      select: { id: true, contentBriefId: true },
    })
    if (!shotTask || shotTask.contentBriefId !== briefId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '指定镜头不属于该内容任务' } },
        { status: 400 }
      )
    }

    // 调用服务：内部含受影响范围计算 + 分布式锁 + 余额预检 + reserve→charge/refund
    const variants = await rerenderAffectedScope({
      contentBriefId: briefId,
      shotTaskId,
      userId,
    })

    return NextResponse.json({
      variants,
      message: `已基于受影响范围重新合成 ${variants.length} 个版本`,
    })
  } catch (error) {
    // 服务层抛出的 ApiError 按其状态码映射：INSUFFICIENT_CREDITS→402、VALIDATION_ERROR→400 等
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }

    // 承接数据缺失（computeReshootScope 抛出的普通 Error）显式返回 422，不静默缩小范围（需求 4.5）
    if (error instanceof Error && /受影响范围计算失败|场景承接数据/.test(error.message)) {
      return NextResponse.json(
        { error: { code: 'CONTINUITY_DATA_MISSING', message: error.message } },
        { status: 422 }
      )
    }

    // 尚无已生成版本可重合成（局部重拍前置条件不满足）显式返回 400
    if (error instanceof Error && /尚无任何已生成版本/.test(error.message)) {
      return NextResponse.json(
        { error: { code: 'NO_VARIANTS_TO_RERENDER', message: error.message } },
        { status: 400 }
      )
    }

    console.error('[POST /api/content-briefs/[briefId]/reshoot] 未知错误:', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : '服务器内部错误',
        },
      },
      { status: 500 }
    )
  }
}
