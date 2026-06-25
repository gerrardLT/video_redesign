import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { createSubscription } from '@/lib/subscription-service'
import { ApiError } from '@/lib/api-error'

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
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '未登录' } },
        { status: 401 }
      )
    }

    // 参数校验
    const body = await request.json()
    const parsed = CreateSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: firstError } },
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
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }

    console.error('[POST /api/subscriptions/create]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '创建订阅失败' } },
      { status: 500 }
    )
  }
}
