import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { showcaseService } from '@/lib/shared/showcase-service'
import { ApiError, apiErrorToResponse, toErrorResponse } from '@/lib/shared/api-error'
import { requireAdmin } from '@/lib/shared/auth-helpers'

export const dynamic = 'force-dynamic'

// 分页参数验证 schema
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().optional(),
})

// 创建案例验证 schema
const createSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  description: z.string().min(1, '描述不能为空'),
  category: z.string().min(1, '分类不能为空'),
  coverUrl: z.string().url('封面图 URL 无效'),
  originalVideoUrl: z.string().url('原视频 URL 无效'),
  generatedVideoUrl: z.string().url('生成视频 URL 无效'),
  isPublished: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

// GET /api/admin/showcase - 管理后台案例列表（包含未发布）
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const { searchParams } = request.nextUrl

    const parseResult = listQuerySchema.safeParse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      category: searchParams.get('category') ?? undefined,
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '分页参数无效' } },
        { status: 400 }
      )
    }

    const { page, pageSize, category } = parseResult.data

    const result = await showcaseService.list({
      page,
      pageSize,
      category,
      publishedOnly: false,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[GET /api/admin/showcase]', error)
    return toErrorResponse('INTERNAL_ERROR', '获取案例列表失败')
  }
}

// POST /api/admin/showcase - 创建案例
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

    const item = await showcaseService.create(parseResult.data)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ApiError) {
      return apiErrorToResponse(error)
    }
    console.error('[POST /api/admin/showcase]', error)
    return toErrorResponse('INTERNAL_ERROR', '创建案例失败')
  }
}
