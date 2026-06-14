import { NextRequest, NextResponse } from 'next/server'
import * as NotificationService from '@/lib/notification-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// PATCH /api/notifications/read-all - 标记当前用户全部通知为已读
export async function PATCH(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    await NotificationService.markAllAsRead(userId)

    return NextResponse.json({ message: '已全部标记为已读' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[PATCH /api/notifications/read-all]', error)
    return NextResponse.json({ error: '标记全部已读失败' }, { status: 500 })
  }
}
