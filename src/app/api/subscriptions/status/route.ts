import { NextRequest, NextResponse } from 'next/server'
import { getActiveSubscription } from '@/lib/shared/subscription-service'
import { getUserPrivileges } from '@/lib/shared/privilege-engine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/subscriptions/status
 * 查询当前用户的订阅状态与会员特权
 *
 * 返回: { subscription, privileges }
 * - subscription: 当前活跃订阅记录（含套餐信息）或 null
 * - privileges: 用户当前特权配置
 */
export async function GET(request: NextRequest) {
  try {
    // 鉴权
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // 并行查询订阅记录和特权
    const [subscription, privileges] = await Promise.all([
      getActiveSubscription(userId),
      getUserPrivileges(userId),
    ])

    return NextResponse.json({ subscription, privileges })
  } catch (error) {
    console.error('[GET /api/subscriptions/status]', error)
    return NextResponse.json({ error: '查询订阅状态失败' }, { status: 500 })
  }
}
