import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { faceDetectionService } from '@/lib/face-detection-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// 复审操作验证 schema
const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
})

// PATCH /api/admin/content-safety/[id]/review - 管理员手动复审
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
    const { id: assetId } = await params
    const adminUserId = request.headers.get('x-user-id')

    if (!adminUserId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少用户标识' } },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parseResult = reviewSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: parseResult.error.issues } },
        { status: 400 }
      )
    }

    const { action } = parseResult.data

    await faceDetectionService.manualReview(assetId, adminUserId, action)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PATCH /api/admin/content-safety/[id]/review]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '复审操作失败' } },
      { status: 500 }
    )
  }
}
