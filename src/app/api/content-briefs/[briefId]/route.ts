/**
 * /api/content-briefs/[briefId] — ContentBrief 详情与编辑
 *
 * - GET：获取 ContentBrief 详情（含 ShotTasks / VideoVariants / 合规检测 / 溯源）
 * - PATCH：编辑（改期 / 换选题 goal / 换 playbook），重实例化并透传 assetWarning（需求 6.1-6.4）
 * - DELETE：删除该 brief，允许该天空缺（需求 6.1, 6.7）
 *
 * 鉴权：通过 x-user-id header 获取用户 ID，验证 brief.store.merchant.userId === currentUserId。
 * 编辑/删除均为纯写库，不消耗积分。
 *
 * Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { editContentBrief } from '@/lib/content-calendar-service'
import { ContentGoalSchema } from '@/types/merchant'
import { ApiError } from '@/lib/api-error'
import { mapContentBriefError } from '@/lib/content-brief-api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/**
 * 校验 brief 归属于当前用户（brief → Store → Merchant.userId）。
 * 返回归属校验结果：notFound（brief 不存在）/ forbidden（非本人）/ ok。
 */
async function assertBriefOwnership(
  briefId: string,
  userId: string
): Promise<'NOT_FOUND' | 'FORBIDDEN' | 'OK'> {
  const brief = await prisma.contentBrief.findUnique({
    where: { id: briefId },
    select: { store: { select: { merchant: { select: { userId: true } } } } },
  })
  if (!brief) return 'NOT_FOUND'
  if (brief.store.merchant.userId !== userId) return 'FORBIDDEN'
  return 'OK'
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 ContentBrief，含关联数据
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: {
            merchant: { select: { userId: true } },
          },
        },
        shotTasks: {
          orderBy: { order: 'asc' },
          include: {
            rawAssets: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        videoVariants: {
          orderBy: { createdAt: 'desc' },
        },
        complianceChecks: {
          orderBy: { createdAt: 'desc' },
        },
        playbook: {
          select: { id: true, name: true, goal: true },
        },
      },
    })

    if (!brief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    // 验证归属关系: brief.store.merchant.userId === currentUserId
    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 移除响应中的深层 merchant 信息（不暴露给前端）
    const { store: { merchant: _merchant, ...storeData }, ...briefData } = brief

    return NextResponse.json({
      brief: {
        ...briefData,
        store: storeData,
      },
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/content-briefs/[briefId]] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

/**
 * 编辑请求体校验（PATCH）：op 为 RESCHEDULE / CHANGE_GOAL / CHANGE_PLAYBOOK，
 * payload 按 op 提供对应字段（删除走 HTTP DELETE 方法，不在此处）。
 * - RESCHEDULE 需提供 newDate（ISO 字符串）
 * - CHANGE_GOAL 需提供 newGoal（ContentGoal）
 * - CHANGE_PLAYBOOK 需提供 newPlaybookId
 */
const EditBriefSchema = z
  .object({
    op: z.enum(['RESCHEDULE', 'CHANGE_GOAL', 'CHANGE_PLAYBOOK']),
    payload: z
      .object({
        newDate: z.string().min(1).optional(),
        newGoal: ContentGoalSchema.optional(),
        newPlaybookId: z.string().min(1).optional(),
      })
      .default({}),
  })
  .superRefine((data, ctx) => {
    if (data.op === 'RESCHEDULE' && !data.payload.newDate) {
      ctx.addIssue({ code: 'custom', message: '改期需提供 payload.newDate', path: ['payload', 'newDate'] })
    }
    if (data.op === 'CHANGE_GOAL' && !data.payload.newGoal) {
      ctx.addIssue({ code: 'custom', message: '更换选题需提供 payload.newGoal', path: ['payload', 'newGoal'] })
    }
    if (data.op === 'CHANGE_PLAYBOOK' && !data.payload.newPlaybookId) {
      ctx.addIssue({ code: 'custom', message: '更换剧本需提供 payload.newPlaybookId', path: ['payload', 'newPlaybookId'] })
    }
  })

/**
 * PATCH /api/content-briefs/[briefId] — 编辑内容任务（需求 6.1, 6.2, 6.3, 6.4）
 *
 * 支持 op：
 * - RESCHEDULE：改期（校验日期合法 + 单日上界约束，需求 6.2）
 * - CHANGE_GOAL：更换选题目标并基于 StoreProfile 重实例化镜头脚本/文案草稿（需求 6.3）
 * - CHANGE_PLAYBOOK：更换剧本并重实例化（需求 6.3）
 *
 * 换选题且该 brief 已有已拍素材时，原素材保留不丢弃，服务层返回 assetWarning 透传给前端，
 * 由商家决定是否重拍（需求 6.4）。纯写库，不消耗积分。
 *
 * 鉴权：x-user-id header + brief 归属校验（brief → Store → Merchant.userId）。
 *
 * 响应：
 * - 200: { brief, reinstantiated, assetWarning? , message }
 * - 400: 参数校验失败 / 日期非法
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 409: 当日内容已达上限（DAY_LIMIT_EXCEEDED，改期目标日满额）
 * - 422: 剧本不可用 / 画像未完成
 * - 500: 服务器内部错误
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

    const parseResult = EditBriefSchema.safeParse(body)
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

    // 归属校验
    const ownership = await assertBriefOwnership(briefId, userId)
    if (ownership === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }
    if (ownership === 'FORBIDDEN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权编辑该内容任务' } },
        { status: 403 }
      )
    }

    const { op, payload } = parseResult.data

    // 调用服务（纯写库，不消耗积分）；assetWarning 透传给前端（需求 6.4）
    const result = await editContentBrief({
      briefId,
      op,
      payload: {
        newDate: payload.newDate ? new Date(payload.newDate) : undefined,
        newGoal: payload.newGoal,
        newPlaybookId: payload.newPlaybookId,
      },
    })

    return NextResponse.json({
      brief: result.brief,
      reinstantiated: result.reinstantiated,
      assetWarning: result.assetWarning,
      message: result.assetWarning ?? '已更新内容任务',
    })
  } catch (error) {
    return mapContentBriefError(error, 'PATCH /api/content-briefs/[briefId]')
  }
}

/**
 * DELETE /api/content-briefs/[briefId] — 删除内容任务（需求 6.1, 6.7）
 *
 * 删除该 brief（级联删除 shotTasks；已拍 RawAsset 经 onDelete:SetNull 解除关联但保留素材行）。
 * 允许该天空缺，不自动补位伪内容（需求 6.7）。纯写库，不消耗积分。
 *
 * 鉴权：x-user-id header + brief 归属校验。
 *
 * 响应：
 * - 200: { deleted: true, message }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 归属校验
    const ownership = await assertBriefOwnership(briefId, userId)
    if (ownership === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }
    if (ownership === 'FORBIDDEN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权删除该内容任务' } },
        { status: 403 }
      )
    }

    // 调用服务删除（op=DELETE，纯写库，不消耗积分）
    await editContentBrief({ briefId, op: 'DELETE', payload: {} })

    return NextResponse.json({ deleted: true, message: '已删除内容任务' })
  } catch (error) {
    return mapContentBriefError(error, 'DELETE /api/content-briefs/[briefId]')
  }
}
