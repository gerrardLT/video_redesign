/**
 * GET /api/content-briefs/[briefId]/templates — 获取行业模板推荐
 *
 * 根据 brief 关联门店的行业，返回匹配的分镜模板列表。
 * 用于 brief 详情页展示推荐模板，帮助商家理解"应该拍什么"。
 *
 * 鉴权：通过 x-user-id header 验证 brief 归属。
 * 不消耗积分。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { getTemplatesByIndustry, type MerchantIndustry } from '@/lib/merchant/merchant-templates'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 brief 关联的门店行业
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      select: {
        store: {
          select: {
            industry: true,
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

    // 归属验证
    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问' } },
        { status: 403 }
      )
    }

    const industry = (brief.store.industry || 'RESTAURANT') as MerchantIndustry
    const templates = getTemplatesByIndustry(industry)

    return NextResponse.json({
      industry,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        targetDuration: t.targetDuration,
        platforms: t.platforms,
        hookKeywords: t.hookKeywords,
        suggestedTags: t.suggestedTags,
        shots: t.shots,
      })),
    })
  } catch (error) {
    console.error('[GET /api/content-briefs/[briefId]/templates]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取模板失败' } },
      { status: 500 }
    )
  }
}
