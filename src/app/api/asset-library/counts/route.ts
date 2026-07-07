/**
 * 资产库分类计数 API
 * GET /api/asset-library/counts - 获取用户各分类资产数量和总计
 *
 * 返回：{ CHARACTER: number, MATERIAL: number, AUDIO: number, total: number }
 *
 * 鉴权：从 request.headers.get('x-user-id') 获取 userId
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCategoryCounts } from '@/lib/shared/asset-library-service'

export const dynamic = 'force-dynamic'

// GET /api/asset-library/counts - 获取各分类资产数量
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const counts = await getCategoryCounts(userId)

    return NextResponse.json(counts)
  } catch (error) {
    console.error('[GET /api/asset-library/counts]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取分类计数失败' } },
      { status: 500 }
    )
  }
}
