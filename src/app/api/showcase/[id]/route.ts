import { NextRequest, NextResponse } from 'next/server'
import { showcaseService } from '@/lib/showcase-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// GET /api/showcase/[id] - 公开案例详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const item = await showcaseService.getById(id)

    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }

    console.error('[GET /api/showcase/[id]]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取案例详情失败' } },
      { status: 500 }
    )
  }
}
