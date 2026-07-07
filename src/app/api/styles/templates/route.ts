import { NextRequest, NextResponse } from 'next/server'
import { getTemplates } from '@/lib/shared/style-service'

export const dynamic = 'force-dynamic'

// GET /api/styles/templates - 获取所有活跃风格模板列表
export async function GET(request: NextRequest) {
  try {
    const templates = await getTemplates()

    return NextResponse.json({ templates })
  } catch (error) {
    console.error('[GET /api/styles/templates]', error)
    return NextResponse.json({ error: '获取风格模板失败' }, { status: 500 })
  }
}
