/**
 * GET /api/content-briefs/[briefId] — 获取 ContentBrief 详情
 *
 * 返回 ContentBrief 及其关联的 ShotTasks 和 VideoVariants。
 * 鉴权：通过 x-user-id header 获取用户 ID，验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 200: { brief: ContentBrief (含 shotTasks, videoVariants, store, complianceChecks) }
 * - 401: 未认证
 * - 403: 无权限（归属验证失败）
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 5.1, 5.2, 5.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
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
