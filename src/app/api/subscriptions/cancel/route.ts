import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { cancelSubscription } from '@/lib/subscription-service'

export const dynamic = 'force-dynamic'

const CancelSubscriptionSchema = z.object({
  recordId: z.string().min(1, '订阅记录ID不能为空'),
})

/**
 * POST /api/subscriptions/cancel
 * 取消订阅（关闭自动续费，权益保留至到期）
 *
 * Body: { recordId }
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
    const parsed = CancelSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { recordId } = parsed.data

    // 调用服务层取消订阅
    await cancelSubscription(userId, recordId)

    return NextResponse.json({ success: true, message: '已取消自动续费' })
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    if (statusCode) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: statusCode }
      )
    }

    console.error('[POST /api/subscriptions/cancel]', error)
    return NextResponse.json({ error: '取消订阅失败' }, { status: 500 })
  }
}
