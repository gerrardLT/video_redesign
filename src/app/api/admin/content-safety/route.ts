import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { faceDetectionService } from '@/lib/face-detection-service'

export const dynamic = 'force-dynamic'

// 分页参数验证 schema
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

// GET /api/admin/content-safety - 获取被拦截素材列表
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
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '分页参数无效' } },
        { status: 400 }
      )
    }

    const { page, pageSize } = parseResult.data

    const result = await faceDetectionService.getRejectedAssets({ page, pageSize })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[GET /api/admin/content-safety]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取被拦截素材列表失败' } },
      { status: 500 }
    )
  }
}
