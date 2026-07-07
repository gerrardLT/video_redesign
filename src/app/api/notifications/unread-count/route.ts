import { NextRequest, NextResponse } from 'next/server'
import * as NotificationService from '@/lib/shared/notification-service'
import { ApiError } from '@/lib/shared/api-error'

export const dynamic = 'force-dynamic'

// GET /api/notifications/unread-count - 获取当前用户未读通知数量
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const count = await NotificationService.getUnreadCount(userId)

    return NextResponse.json({ count })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[GET /api/notifications/unread-count]', error)
    return NextResponse.json({ error: '获取未读通知数量失败' }, { status: 500 })
  }
}
