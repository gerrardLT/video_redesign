import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { update, deleteArticle } from '@/lib/help-center-service'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/api-error'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

// 更新帮助文章验证 schema（所有字段可选）
const updateSchema = z.object({
  title: z.string().min(1, '标题不能为空').optional(),
  slug: z.string().min(1, 'slug 不能为空').optional(),
  section: z.enum(['quickstart', 'guide', 'faq'], { message: '板块必须为 quickstart、guide 或 faq' }).optional(),
  content: z.string().min(1, '内容不能为空').optional(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
})

// PUT /api/admin/help-articles/[id] - 更新帮助文章
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(request)

    const { id } = await params
    const body = await request.json()
    const parseResult = updateSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: parseResult.error.issues } },
        { status: 400 }
      )
    }

    const article = await update(id, parseResult.data)
    return NextResponse.json(article)
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[PUT /api/admin/help-articles/[id]]', error)
    return toErrorResponse('INTERNAL_ERROR', '更新帮助文章失败')
  }
}

// DELETE /api/admin/help-articles/[id] - 删除帮助文章
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(request)

    const { id } = await params
    await deleteArticle(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[DELETE /api/admin/help-articles/[id]]', error)
    return toErrorResponse('INTERNAL_ERROR', '删除帮助文章失败')
  }
}
