import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { updateSortOrder } from '@/lib/shared/help-center-service'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

// 排序权重验证 schema
const sortSchema = z.object({
  sortOrder: z.number().int({ message: '排序值必须为整数' }),
})

// PATCH /api/admin/help-articles/[id]/sort - 调整文章排序
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(request)

    const { id } = await params
    const body = await request.json()
    const parseResult = sortSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: parseResult.error.issues } },
        { status: 400 }
      )
    }

    await updateSortOrder(id, parseResult.data.sortOrder)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[PATCH /api/admin/help-articles/[id]/sort]', error)
    return toErrorResponse('INTERNAL_ERROR', '更新排序失败')
  }
}
