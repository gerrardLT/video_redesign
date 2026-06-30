/**
 * GET /api/content-briefs/[briefId]/provenance — 获取 ContentBrief 的画像溯源快照（可解释）
 *
 * 直接读取 ContentBrief.provenance 列（生成时快照，需求 5.4 不回溯）并原样返回，
 * 供前端用通俗话术展示该 brief 引用了门店画像的哪些依据（卖点/钩子词/人设/CTA）。
 * 当 brief 无可溯源的画像引用记录（provenance 列为空）时，如实返回
 * { references: [], isGenericTemplate: true }，前端显示「通用模板」，绝不伪造溯源（需求 5.6）。
 *
 * Route Handler 仅做鉴权 + brief 归属校验 + 读取列 + 返回，不消耗积分。
 *
 * 鉴权：通过 x-user-id header 获取用户 ID，验证 brief.store.merchant.userId === currentUserId。
 *
 * 响应：
 * - 200: { provenance: BriefProvenance }
 * - 401: 未认证
 * - 403: 无权限（归属验证失败）
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 5.1, 5.2, 5.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'
import type { BriefProvenance } from '@/lib/playbook-engine'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 brief，仅取归属链与 provenance 列
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      select: {
        provenance: true,
        store: {
          select: {
            merchant: { select: { userId: true } },
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

    // 数据隔离：验证 brief 归属当前用户的商家
    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // provenance 为生成时快照；无引用记录时如实返回通用模板，不伪造（需求 5.6）
    const provenance: BriefProvenance =
      (brief.provenance as BriefProvenance | null) ?? {
        references: [],
        isGenericTemplate: true,
      }

    return NextResponse.json({ provenance })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/content-briefs/[briefId]/provenance] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
