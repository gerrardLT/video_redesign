import { NextRequest, NextResponse } from 'next/server'
import { search } from '@/lib/shared/help-center-service'

export const dynamic = 'force-dynamic'

// GET /api/help-articles/search?q=关键词 - 搜索帮助文章
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const query = searchParams.get('q') || ''

    // 搜索关键词为空时返回空数组
    if (!query.trim()) {
      return NextResponse.json({ articles: [] })
    }

    // 截断过长的搜索关键词（最多 100 字）
    const trimmedQuery = query.slice(0, 100)

    const articles = await search(trimmedQuery)

    return NextResponse.json({ articles })
  } catch (error) {
    console.error('[GET /api/help-articles/search]', error)
    return NextResponse.json({ error: '搜索帮助文章失败' }, { status: 500 })
  }
}
