import { NextRequest, NextResponse } from 'next/server'
import * as NotificationService from '@/lib/notification-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// PATCH /api/notifications/[id]/read - 标记单条通知为已读
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    await NotificationService.markAsRead(id, userId)

    return NextResponse.json({ message: '已标记为已读' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[PATCH /api/notifications/[id]/read]', error)
    return NextResponse.json({ error: '标记已读失败' }, { status: 500 })
  }
}
