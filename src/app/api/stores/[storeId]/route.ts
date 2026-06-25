/**
 * GET /api/stores/[storeId] — 获取门店详情
 * PUT /api/stores/[storeId] — 更新门店信息
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 200: { store: Store }（GET）/ { store: Store, message: string }（PUT）
 * - 400: 验证失败
 * - 401: 未认证
 * - 403: 无权限
 * - 500: 服务器内部错误
 *
 * Requirements: 2.1, 15.1, 16.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { StoreUpdateSchema } from '@/lib/validations/merchant'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 验证权限
    await validateMerchantAccess(userId, storeId)

    // 查询门店详情，包含 profile 和 offers
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: {
        profile: true,
        offers: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!store) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '门店不存在' } },
        { status: 404 }
      )
    }

    return NextResponse.json({ store })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
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
    const parseResult = StoreUpdateSchema.safeParse(body)
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

    // 更新门店信息
    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.district !== undefined && { district: data.district }),
        ...(data.businessArea !== undefined && { businessArea: data.businessArea }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.avgTicket !== undefined && { avgTicket: data.avgTicket }),
        ...(data.openingHours !== undefined && { openingHours: data.openingHours }),
        ...(data.mainProducts !== undefined && { mainProducts: data.mainProducts }),
        ...(data.mainSellingPoints !== undefined && { mainSellingPoints: data.mainSellingPoints }),
        ...(data.targetCustomers !== undefined && { targetCustomers: data.targetCustomers }),
        ...(data.brandTone !== undefined && { brandTone: data.brandTone }),
        ...(data.canShootKitchen !== undefined && { canShootKitchen: data.canShootKitchen }),
        ...(data.canShootStaff !== undefined && { canShootStaff: data.canShootStaff }),
        ...(data.canShootCustomers !== undefined && { canShootCustomers: data.canShootCustomers }),
        ...(data.hasGroupBuying !== undefined && { hasGroupBuying: data.hasGroupBuying }),
        ...(data.hasReservation !== undefined && { hasReservation: data.hasReservation }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: {
        profile: true,
        offers: { where: { isActive: true } },
      },
    })

    return NextResponse.json({
      store: updatedStore,
      message: '门店信息已更新',
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PUT /api/stores/[storeId]] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
