import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { updateSortOrder } from '@/lib/help-center-service'
import { ApiError } from '@/lib/api-error'

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
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
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
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PATCH /api/admin/help-articles/[id]/sort]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '更新排序失败' } },
      { status: 500 }
    )
  }
}
