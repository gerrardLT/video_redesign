import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { showcaseService } from '@/lib/shared/showcase-service'

export const dynamic = 'force-dynamic'

// 分页参数验证 schema
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().optional(),
})

// GET /api/showcase - 公开案例列表（支持分页 + 分类筛选）
export async function GET(request: NextRequest) {
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
      publishedOnly: true,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[GET /api/showcase]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取案例列表失败' } },
      { status: 500 }
    )
  }
}
