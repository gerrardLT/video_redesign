import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { manualRenew } from '@/lib/subscription-service'

export const dynamic = 'force-dynamic'

const ManualRenewSchema = z.object({
  recordId: z.string().min(1, '订阅记录ID不能为空'),
  payMethod: z.enum(['wechat', 'alipay']),
})

/**
 * POST /api/subscriptions/renew
 * 手动续费：创建续费订单并发起支付
 *
 * Body: { recordId, payMethod }
 * 返回: { order, paymentParams }
 */
export async function POST(request: NextRequest) {
  try {
    // 鉴权
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // 参数校验
    const body = await request.json()
    const parsed = ManualRenewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { recordId, payMethod } = parsed.data

    // 调用服务层手动续费
    const result = await manualRenew(userId, recordId, payMethod)

    return NextResponse.json(result)
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    if (statusCode) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: statusCode }
      )
    }

    console.error('[POST /api/subscriptions/renew]', error)
    return NextResponse.json({ error: '手动续费失败' }, { status: 500 })
  }
}
