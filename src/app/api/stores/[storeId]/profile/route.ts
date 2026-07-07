/**
 * GET /api/stores/[storeId]/profile — 获取门店画像
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 验证权限
 *
 * 响应：
 * - 200: { profile: StoreProfile }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: 画像不存在（尚未生成）
 * - 500: 服务器内部错误
 *
 * Requirements: 2.1, 16.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
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

    // 查询门店画像
    const profile = await prisma.storeProfile.findUnique({
      where: { storeId },
    })

    if (!profile) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '门店画像尚未生成' } },
        { status: 404 }
      )
    }

    return NextResponse.json({ profile })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/profile] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
