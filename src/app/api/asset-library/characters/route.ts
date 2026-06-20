/**
 * GET /api/asset-library/characters
 * 获取用户所有 CHARACTER 类型资产列表，供角色选择器使用
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCharacterAssets } from '@/lib/asset-library-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const items = await getCharacterAssets(userId)

    return NextResponse.json({ items })
  } catch (error) {
    console.error('[GET /api/asset-library/characters]', error)
    return NextResponse.json({ error: '获取角色图列表失败' }, { status: 500 })
  }
}
