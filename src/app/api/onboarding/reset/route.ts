/**
 * POST /api/onboarding/reset - 重置新手引导进度
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 流程：重置进度 → 检查示例项目是否存在（无则重新创建）→ 返回重置后的进度
 *
 * Requirements: 6.4, 6.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/shared/auth-helpers'
import { resetProgress, getProgress } from '@/lib/shared/onboarding-service'
import { hasSampleProject, createSampleProject } from '@/lib/shared/sample-project-service'
import { ApiError } from '@/lib/shared/api-error'

export async function POST(request: NextRequest) {
  try {
    // 1. 鉴权：获取当前用户 ID
    const userId = getUserId(request)

    // 2. 重置引导进度（所有步骤回到 NOT_COMPLETED，rewardGranted 保持不变）
    await resetProgress(userId)

    // 3. 检查示例项目是否存在，不存在则重新创建
    const hasProject = await hasSampleProject(userId)
    if (!hasProject) {
      await createSampleProject(userId)
    }

    // 4. 返回重置后的完整进度
    const progress = await getProgress(userId)

    return NextResponse.json({ progress })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/onboarding/reset]', error)
    return NextResponse.json({ error: '重置引导进度失败' }, { status: 500 })
  }
}
