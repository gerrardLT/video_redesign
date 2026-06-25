import { NextRequest, NextResponse } from 'next/server'
import * as NotificationService from '@/lib/notification-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// GET /api/notifications - 获取当前用户通知列表（分页）
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))
    const unreadOnly = searchParams.get('unreadOnly') === 'true'

    const result = await NotificationService.getUserNotifications(userId, page, pageSize, unreadOnly)

    return NextResponse.json({
      notifications: result.data.map((n) => ({
        ...n,
        meta: n.meta ? JSON.parse(n.meta) : null,
        createdAt: n.createdAt.toISOString(),
      })),
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/notifications]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取通知列表失败' } },
      { status: 500 }
    )
  }
}
