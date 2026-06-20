import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptionHistory } from '@/lib/subscription-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/subscriptions/history
 * 分页查询用户订阅支付历史
 *
 * Query Params:
 * - page: 页码（默认 1）
 * - pageSize: 每页条数（默认 10，最大 50）
 *
 * 返回: { items, total, page, pageSize, totalPages }
 */
export async function GET(request: NextRequest) {
  try {
    // 鉴权
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // 解析分页参数
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)))

    // 调用服务层查询历史
    const result = await getSubscriptionHistory(userId, page, pageSize)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[GET /api/subscriptions/history]', error)
    return NextResponse.json({ error: '查询支付历史失败' }, { status: 500 })
  }
}
