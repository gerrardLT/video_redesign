/**
 * GET /api/merchant/me
 * 获取当前登录用户的商家和门店信息
 * 供 merchant layout 使用
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: '未登录' } },
      { status: 401 }
    )
  }

  // 查询用户关联的商家和第一个门店
  const merchant = await prisma.merchant.findFirst({
    where: { userId },
    include: {
      stores: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, name: true, industry: true },
      },
    },
  })

  if (!merchant || merchant.stores.length === 0) {
    // 还没创建商家/门店，返回空状态（前端可据此跳转问诊页）
    return NextResponse.json({
      hasMerchant: false,
      storeName: null,
      storeId: null,
    })
  }

  const store = merchant.stores[0]
  return NextResponse.json({
    hasMerchant: true,
    merchantId: merchant.id,
    merchantName: merchant.name,
    storeId: store.id,
    storeName: store.name,
    industry: store.industry,
  })
}
