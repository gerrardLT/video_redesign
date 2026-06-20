import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { createSubscription } from '@/lib/subscription-service'

export const dynamic = 'force-dynamic'

const CreateSubscriptionSchema = z.object({
  planId: z.string().min(1, '套餐ID不能为空'),
  payMethod: z.enum(['wechat', 'alipay']),
  enableAutoRenewal: z.boolean(),
})

/**
 * POST /api/subscriptions/create
 * 创建订阅订单并发起签约支付
 *
 * Body: { planId, payMethod, enableAutoRenewal }
 * 返回: { order, paymentParams }
 */
export async function POST(request: NextRequest) {
  try {
    // 鉴权：从 header 获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // 参数校验
    const body = await request.json()
    const parsed = CreateSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { planId, payMethod, enableAutoRenewal } = parsed.data

    // 调用服务层创建订阅
    const result = await createSubscription({
      userId,
      planId,
      payMethod,
      enableAutoRenewal,
    })

    return NextResponse.json(result)
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    if (statusCode) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: statusCode }
      )
    }

    console.error('[POST /api/subscriptions/create]', error)
    return NextResponse.json({ error: '创建订阅失败' }, { status: 500 })
  }
}
