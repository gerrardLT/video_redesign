/**
 * GET /api/content-briefs/[briefId]/insights — 获取优化建议
 *
 * 流程：
 * 1. 鉴权并验证归属关系
 * 2. 按 User_Tier 权益门控数据洞察（getMerchantPrivileges().insightsEnabled）
 * 3. 调用 performance-learning-service 生成洞察
 *
 * 计费说明：数据洞察访问（ACCESS_INSIGHTS）不按次扣减积分，
 * 是否可访问改由统一会员权益（Privilege_Mapping）门控。
 *
 * 响应：
 * - 200: { insights: PerformanceInsights }
 * - 401: 未认证
 * - 403: 无权限 / 会员等级未开放数据洞察（INSIGHTS_NOT_AVAILABLE）
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 2.3, 3.6, 5.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { getMerchantPrivileges } from '@/lib/privilege-engine'
import { generatePerformanceInsights } from '@/lib/performance-learning-service'
import { ApiError } from '@/lib/api-error'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> }
) {
  const { briefId } = await params

  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 验证归属关系
    const contentBrief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: { merchant: true },
        },
      },
    })

    if (!contentBrief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (contentBrief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 3. 数据洞察权益门控（不扣减积分，仅按 User_Tier 权益判定）
    const privileges = await getMerchantPrivileges(userId)
    if (!privileges.insightsEnabled) {
      return NextResponse.json(
        {
          error: {
            code: 'INSIGHTS_NOT_AVAILABLE',
            message: '当前会员等级未开放数据洞察功能，升级到月卡或年卡会员即可使用',
          },
        },
        { status: 403 }
      )
    }

    // 4. 生成优化建议
    const insights = await generatePerformanceInsights({
      storeId: contentBrief.storeId,
      contentBriefId: briefId,
    })

    return NextResponse.json({ insights })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error(`[GET /api/content-briefs/${briefId}/insights] 未知错误:`, error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
