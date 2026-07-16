/**
 * GET /api/stores/[storeId]/playbooks — 列出门店可用剧本（需求 6.1 换 playbook）
 *
 * 供 calendar 计划可编辑前端的「换剧本」选择器使用：按门店所属行业返回激活中的 Playbook，
 * 可选按内容目标（goal）过滤。仅返回前端选择所需的精简字段（id/name/goal/description），
 * 使用真实剧本数据，不伪造、不补位。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 查询 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 查询参数：goal?(ContentGoal) — 提供时仅返回该目标的剧本
 *
 * 响应：
 * - 200: { playbooks: { id, name, goal, description }[] }
 * - 400: goal 参数非法（VALIDATION_ERROR）
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 404: 门店不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 6.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { ContentGoalSchema } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 校验可选的 goal 过滤参数
    const goalParam = request.nextUrl.searchParams.get('goal')
    let goal: string | undefined
    if (goalParam) {
      const parsed = ContentGoalSchema.safeParse(goalParam)
      if (!parsed.success) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'goal 参数非法' } },
          { status: 400 }
        )
      }
      goal = parsed.data
    }

    // 查询门店所属行业（剧本按行业划分）
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { industry: true },
    })
    if (!store) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '门店不存在' } },
        { status: 404 }
      )
    }

    // 查询该行业激活中的剧本（可选按 goal 过滤），仅返回前端选择所需字段
    const playbooks = await prisma.playbook.findMany({
      where: {
        industry: store.industry,
        isActive: true,
        ...(goal ? { goal: goal as never } : {}),
      },
      select: { id: true, name: true, goal: true, description: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ playbooks })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores/[storeId]/playbooks] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
