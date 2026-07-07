/**
 * 资产库列表 API
 * GET /api/asset-library - 获取用户资产列表（支持分类筛选、关键字搜索、分页）
 *
 * Query 参数：
 * - category: 可选，资产分类（CHARACTER / MATERIAL / AUDIO）
 * - keyword: 可选，搜索关键字（最大 100 字符，模糊匹配 displayName）
 * - page: 可选，页码（默认 1，最小 1）
 * - pageSize: 可选，每页数量（默认 20，范围 1-100）
 *
 * 鉴权：从 request.headers.get('x-user-id') 获取 userId
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { listAssets } from '@/lib/shared/asset-library-service'

export const dynamic = 'force-dynamic'

// 查询参数校验 schema
const listQuerySchema = z.object({
  category: z.enum(['CHARACTER', 'MATERIAL', 'AUDIO']).optional(),
  keyword: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// GET /api/asset-library - 资产列表（支持分类筛选、关键字搜索、分页）
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = request.nextUrl

    const parseResult = listQuerySchema.safeParse({
      category: searchParams.get('category') ?? undefined,
      keyword: searchParams.get('keyword') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '查询参数无效' } },
        { status: 400 }
      )
    }

    const { category, keyword, page, pageSize } = parseResult.data

    const result = await listAssets({
      userId,
      category,
      keyword,
      page,
      pageSize,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[GET /api/asset-library]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取资产列表失败' } },
      { status: 500 }
    )
  }
}
