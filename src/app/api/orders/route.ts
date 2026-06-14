import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import * as OrderService from '@/lib/order-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// POST /api/orders - 创建订单
const CreateOrderSchema = z.object({
  packageId: z.string().min(1, '套餐ID不能为空'),
  payMethod: z.enum(['wechat', 'alipay'], { message: '支付方式仅支持 wechat 或 alipay' }),
})

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const body = await request.json()

    const parsed = CreateOrderSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { packageId, payMethod } = parsed.data

    const result = await OrderService.createOrder(userId, packageId, payMethod)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/orders]', error)
    return NextResponse.json({ error: '创建订单失败' }, { status: 500 })
  }
}

// GET /api/orders - 分页获取当前用户订单列表
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)))

    const result = await OrderService.getUserOrders(userId, page, pageSize)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/orders]', error)
    return NextResponse.json({ error: '获取订单列表失败' }, { status: 500 })
  }
}
