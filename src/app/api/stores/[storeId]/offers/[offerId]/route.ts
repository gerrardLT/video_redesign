/**
 * PUT /api/stores/[storeId]/offers/[offerId] — 更新优惠信息
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 * 额外验证 offerId 归属于 storeId
 *
 * 响应：
 * - 200: { offer: ProductOffer, message: string }
 * - 400: 验证失败
 * - 401: 未认证
 * - 403: 无权限
 * - 404: 优惠不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 15.1, 16.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { Prisma } from '@/generated/prisma'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { ProductOfferSchema } from '@/lib/validations/merchant'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

interface RouteContext {
  params: Promise<{ storeId: string; offerId: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { storeId, offerId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    await validateMerchantAccess(userId, storeId)

    // 验证优惠记录存在且归属当前门店
    const existingOffer = await prisma.productOffer.findUnique({
      where: { id: offerId },
    })
    if (!existingOffer || existingOffer.storeId !== storeId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '优惠不存在' } },
        { status: 404 }
      )
    }

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

    // 使用 ProductOfferSchema 做部分更新验证（所有字段 partial）
    const PartialOfferSchema = ProductOfferSchema.partial()
    const parseResult = PartialOfferSchema.safeParse(body)
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

    const data = parseResult.data

    // 更新优惠记录
    const updatedOffer = await prisma.productOffer.update({
      where: { id: offerId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.originalPrice !== undefined && { originalPrice: data.originalPrice }),
        ...(data.salePrice !== undefined && { salePrice: data.salePrice }),
        ...(data.sellingPoints !== undefined && { sellingPoints: data.sellingPoints ?? Prisma.DbNull }),
        ...(data.usageRules !== undefined && { usageRules: data.usageRules }),
      },
    })

    return NextResponse.json({
      offer: updatedOffer,
      message: '优惠已更新',
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[PUT /api/stores/[storeId]/offers/[offerId]] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
