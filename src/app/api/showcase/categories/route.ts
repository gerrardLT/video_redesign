import { NextResponse } from 'next/server'
import { SHOWCASE_CATEGORIES } from '@/constants/showcase-categories'

// GET /api/showcase/categories - 获取案例分类列表
export async function GET() {
  return NextResponse.json({ categories: SHOWCASE_CATEGORIES })
}
