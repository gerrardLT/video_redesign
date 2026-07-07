import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { list, create } from '@/lib/shared/help-center-service'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

// 创建帮助文章验证 schema
const createSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  slug: z.string().min(1, 'slug 不能为空'),
  section: z.enum(['quickstart', 'guide', 'faq'], { message: '板块必须为 quickstart、guide 或 faq' }),
  content: z.string().min(1, '内容不能为空'),
  sortOrder: z.number().int().default(0),
  isPublished: z.boolean().default(true),
})

// GET /api/admin/help-articles - 管理后台文章列表（包含未发布）
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const articles = await list(false)
    return NextResponse.json({ articles })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/help-articles]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取帮助文章列表失败')
  }
}

// POST /api/admin/help-articles - 创建帮助文章
export async function POST(request: NextRequest) {
  try {
    requireAdmin(request)

    const body = await request.json()
    const parseResult = createSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: parseResult.error.issues } },
        { status: 400 }
      )
    }

    const article = await create(parseResult.data)
    return NextResponse.json(article, { status: 201 })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[POST /api/admin/help-articles]', error)
    return toErrorResponse('INTERNAL_ERROR', '创建帮助文章失败')
  }
}
