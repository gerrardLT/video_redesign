import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { showcaseService } from '@/lib/showcase-service'
import { ApiError } from '@/lib/api-error'

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
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
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
    console.error('[GET /api/admin/showcase]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取案例列表失败' } },
      { status: 500 }
    )
  }
}

// POST /api/admin/showcase - 创建案例
export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  try {
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
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/admin/showcase]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '创建案例失败' } },
      { status: 500 }
    )
  }
}
