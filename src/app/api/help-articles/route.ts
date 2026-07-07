import { NextResponse } from 'next/server'
import { listBySection } from '@/lib/shared/help-center-service'

export const dynamic = 'force-dynamic'

// GET /api/help-articles - 获取帮助文章列表（按板块分组）
export async function GET() {
  try {
    const sections = await listBySection()

    return NextResponse.json({ sections })
  } catch (error) {
    console.error('[GET /api/help-articles]', error)
    return NextResponse.json({ error: '获取帮助文章列表失败' }, { status: 500 })
  }
}
