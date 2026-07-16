/**
 * POST /api/content-briefs/[briefId]/publish-copy — 为指定 ContentBrief 生成各平台发布文案
 *
 * 流程：
 * 1. 鉴权：从 x-user-id header 获取用户 ID
 * 2. 验证归属关系：brief.store.merchant.userId === currentUserId
 * 3. 接收 body: { variantType, platforms }
 * 4. 从 DB 加载门店、画像、优惠信息
 * 5. 调用 generatePublishCopy 服务生成文案
 * 6. 保存结果到 ContentBrief.platformCopies 字段
 * 7. 返回生成结果
 *
 * 响应：
 * - 200: { platformCopies: Record<PublishPlatform, PlatformCopy>, message: string }
 * - 400: 验证失败
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import type { Prisma } from '@/generated/prisma'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { generatePublishCopy } from '@/lib/merchant/publish-copy-service'
import { VideoVariantTypeSchema, PublishPlatformSchema } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 请求体验证 Schema */
const PublishCopyRequestSchema = z.object({
  /** 视频版本类型 */
  variantType: VideoVariantTypeSchema,
  /** 目标发布平台列表（至少 1 个） */
  platforms: z.array(PublishPlatformSchema).min(1, '至少选择 1 个平台').max(5, '最多 5 个平台'),
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

    // Zod 验证
    const parseResult = PublishCopyRequestSchema.safeParse(body)
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

    const { variantType, platforms } = parseResult.data

    // 查询 ContentBrief，含门店、画像、优惠信息
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: {
            merchant: { select: { userId: true } },
            profile: true,
            offers: {
              where: { isActive: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
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

    // 验证归属关系
    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 准备 store 数据
    const store = {
      id: brief.store.id,
      name: brief.store.name,
      industry: brief.store.industry,
      city: brief.store.city,
      district: brief.store.district,
      businessArea: brief.store.businessArea,
      address: brief.store.address ?? null,
      mainProducts: (brief.store.mainProducts as string[]) || [],
      mainSellingPoints: (brief.store.mainSellingPoints as string[]) || [],
      canShootKitchen: brief.store.canShootKitchen,
      canShootStaff: brief.store.canShootStaff,
      canShootCustomers: brief.store.canShootCustomers,
    }

    // 准备 profile 数据
    const profile = brief.store.profile
    if (!profile) {
      return NextResponse.json(
        { error: { code: 'PRECONDITION_FAILED', message: '门店画像尚未生成，请先完成画像生成' } },
        { status: 412 }
      )
    }

    const profileData = {
      id: profile.id,
      storeId: profile.storeId,
      contentPositioning: profile.contentPositioning,
      recommendedPersona: profile.recommendedPersona,
      hookKeywords: profile.hookKeywords as string[] | null,
      forbiddenClaims: profile.forbiddenClaims as string[] | null,
      preferredCta: profile.preferredCta as string[] | null,
      contentDos: (profile.contentDos as string[] | null) ?? null,
      contentDonts: (profile.contentDonts as string[] | null) ?? null,
    }

    // 准备 offer 数据（PROMOTION 版本取关联优惠或门店最新优惠）
    let offerData: {
      id: string
      storeId: string
      name: string
      description: string | null
      originalPrice: number | null
      salePrice: number | null
      sellingPoints: string[] | null
      usageRules: string | null
      isActive: boolean
    } | undefined

    if (brief.offerId) {
      // 优先使用 brief 关联的优惠
      const linkedOffer = await prisma.productOffer.findUnique({
        where: { id: brief.offerId },
      })
      if (linkedOffer) {
        offerData = {
          id: linkedOffer.id,
          storeId: linkedOffer.storeId,
          name: linkedOffer.name,
          description: linkedOffer.description,
          originalPrice: linkedOffer.originalPrice,
          salePrice: linkedOffer.salePrice,
          sellingPoints: linkedOffer.sellingPoints as string[] | null,
          usageRules: linkedOffer.usageRules,
          isActive: linkedOffer.isActive,
        }
      }
    }

    // 如果没有关联优惠，取门店最新有效优惠
    if (!offerData && brief.store.offers.length > 0) {
      const firstOffer = brief.store.offers[0]
      offerData = {
        id: firstOffer.id,
        storeId: firstOffer.storeId,
        name: firstOffer.name,
        description: firstOffer.description,
        originalPrice: firstOffer.originalPrice,
        salePrice: firstOffer.salePrice,
        sellingPoints: firstOffer.sellingPoints as string[] | null,
        usageRules: firstOffer.usageRules,
        isActive: firstOffer.isActive,
      }
    }

    // 调用文案生成服务
    const platformCopies = await generatePublishCopy({
      contentBriefId: briefId,
      variantType,
      platforms,
      store,
      profile: profileData,
      offer: offerData,
    })

    // 保存到 ContentBrief.platformCopies 字段
    const existingCopies = (brief.platformCopies as Record<string, unknown>) || {}
    const mergedCopies = { ...existingCopies, ...platformCopies }

    await prisma.contentBrief.update({
      where: { id: briefId },
      data: { platformCopies: mergedCopies as unknown as Prisma.InputJsonValue },
    })

    return NextResponse.json({
      platformCopies,
      message: `已为 ${platforms.length} 个平台生成发布文案`,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/publish-copy] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '服务器内部错误' } },
      { status: 500 }
    )
  }
}
