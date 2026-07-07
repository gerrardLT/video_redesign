import { NextRequest, NextResponse } from 'next/server'
import { getBySlug } from '@/lib/shared/help-center-service'

export const dynamic = 'force-dynamic'

// GET /api/help-articles/[slug] - 获取帮助文章详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    const article = await getBySlug(slug)

    if (!article) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 })
    }

    // 只返回已发布的文章
    if (!article.isPublished) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 })
    }

    return NextResponse.json({ article })
  } catch (error) {
    console.error('[GET /api/help-articles/[slug]]', error)
    return NextResponse.json({ error: '获取帮助文章失败' }, { status: 500 })
  }
}
