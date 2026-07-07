/**
 * GET /api/stores/[storeId]/offers — 获取门店优惠列表
 * POST /api/stores/[storeId]/offers — 创建新优惠
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - GET 200: { offers: ProductOffer[] }
 * - POST 201: { offer: ProductOffer, message: string }
 * - 400: 验证失败
 * - 401: 未认证
 * - 403: 无权限
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

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    await validateMerchantAccess(userId, storeId)

    // 查询优惠列表（默认只返回有效的，支持 ?all=true 返回全部）
    const showAll = request.nextUrl.searchParams.get('all') === 'true'

    const offers = await prisma.productOffer.findMany({
      where: {
        storeId,
        ...(showAll ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ offers })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/offers] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    await validateMerchantAccess(userId, storeId)

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
    const parseResult = ProductOfferSchema.safeParse(body)
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

    // 创建优惠记录
    const offer = await prisma.productOffer.create({
      data: {
        storeId,
        name: data.name,
        description: data.description ?? null,
        originalPrice: data.originalPrice ?? null,
        salePrice: data.salePrice ?? null,
        sellingPoints: data.sellingPoints ?? Prisma.DbNull,
        usageRules: data.usageRules ?? null,
      },
    })

    return NextResponse.json(
      { offer, message: '优惠已创建' },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/stores/[storeId]/offers] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
