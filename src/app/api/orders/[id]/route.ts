import { NextRequest, NextResponse } from 'next/server'
import * as OrderService from '@/lib/order-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// GET /api/orders/[id] - 获取订单详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: '订单ID不能为空' }, { status: 400 })
    }

    const order = await OrderService.getOrderById(id, userId)

    return NextResponse.json({ order })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/orders/[id]]', error)
    return NextResponse.json({ error: '获取订单详情失败' }, { status: 500 })
  }
}
