/**
 * 项目列表与角色列表查询 API
 * GET /api/projects/list-with-characters
 *
 * 根据 query 参数区分两种返回：
 * - 无 projectId → 返回用户所有项目列表（含角色计数），按 updatedAt DESC 排序
 * - 有 projectId → 验证项目所有权后返回该项目的角色列表
 *
 * 鉴权：从 request.headers.get('x-user-id') 获取 userId
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  listProjectsWithCharacterCount,
  listCharactersByProject,
} from '@/lib/shared/asset-library-service'
import { ApiError } from '@/lib/shared/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = request.nextUrl
    const projectId = searchParams.get('projectId')

    if (projectId) {
      // 有 projectId → 返回该项目的角色列表（内部验证所有权）
      const characters = await listCharactersByProject(projectId, userId)
      return NextResponse.json({ characters })
    }

    // 无 projectId → 返回项目列表（含角色计数，按 updatedAt DESC 排序）
    const projects = await listProjectsWithCharacterCount(userId)
    return NextResponse.json({ projects })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/projects/list-with-characters]', error)
    return NextResponse.json(
      { error: '查询项目列表失败' },
      { status: 500 }
    )
  }
}
