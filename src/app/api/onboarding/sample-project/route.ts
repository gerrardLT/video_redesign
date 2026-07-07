import { NextRequest, NextResponse } from 'next/server'
import { createSampleProject, hasSampleProject } from '@/lib/shared/sample-project-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding/sample-project - 创建示例项目
 * 为当前用户创建预制示例项目（幂等操作：已存在则返回现有项目）
 * 返回 201 表示新建成功，200 表示已存在直接返回
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    // 检查是否已有示例项目，用于区分返回状态码
    const alreadyExists = await hasSampleProject(userId)

    const project = await createSampleProject(userId)

    if (!project) {
      return NextResponse.json(
        { error: '示例项目创建失败：静态数据缺失' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { project },
      { status: alreadyExists ? 200 : 201 }
    )
  } catch (error) {
    console.error('[POST /api/onboarding/sample-project]', error)
    return NextResponse.json(
      { error: '创建示例项目失败' },
      { status: 500 }
    )
  }
}
