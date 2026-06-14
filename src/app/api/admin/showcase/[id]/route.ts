import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { showcaseService } from '@/lib/showcase-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// 更新案例验证 schema（所有字段可选）
const updateSchema = z.object({
  title: z.string().min(1, '标题不能为空').optional(),
  description: z.string().min(1, '描述不能为空').optional(),
  category: z.string().min(1, '分类不能为空').optional(),
  coverUrl: z.string().url('封面图 URL 无效').optional(),
  originalVideoUrl: z.string().url('原视频 URL 无效').optional(),
  generatedVideoUrl: z.string().url('生成视频 URL 无效').optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// PUT /api/admin/showcase/[id] - 更新案例
export async function PUT(
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
    const parseResult = updateSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: parseResult.error.issues } },
        { status: 400 }
      )
    }

    const item = await showcaseService.update(id, parseResult.data)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PUT /api/admin/showcase/[id]]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '更新案例失败' } },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/showcase/[id] - 删除案例
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
    const { id } = await params
    await showcaseService.delete(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[DELETE /api/admin/showcase/[id]]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '删除案例失败' } },
      { status: 500 }
    )
  }
}
