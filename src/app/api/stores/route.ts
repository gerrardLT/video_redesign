/**
 * GET /api/stores — 获取当前用户所有门店列表
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 返回当前用户名下所有门店（通过 userId → Merchant → Store 关系链查询）
 *
 * 响应：
 * - 200: { stores: Store[] }
 * - 401: 未认证
 * - 403: 无商家身份
 * - 500: 服务器内部错误
 *
 * Requirements: 15.1, 16.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest, getMerchantByUserId } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)

    // 2. 查找商家及其门店
    const merchant = await getMerchantByUserId(userId)
    if (!merchant) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无商家身份，请先完成问诊' } },
        { status: 403 }
      )
    }

    // 3. 获取门店列表，包含 profile 和 offers 的基础统计
    const stores = await prisma.store.findMany({
      where: { merchantId: merchant.id },
      include: {
        profile: { select: { id: true, status: true, contentPositioning: true } },
        _count: { select: { offers: true, contentBriefs: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ stores })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
