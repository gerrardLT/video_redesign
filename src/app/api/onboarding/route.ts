/**
 * 新手引导进度 API
 *
 * GET /api/onboarding - 获取当前用户的引导进度，首次调用自动创建进度记录并创建示例项目
 * PUT /api/onboarding - 更新单个引导步骤状态，完成后检查是否满足奖励条件
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { getUserId } from '@/lib/auth-helpers'
import { ApiError } from '@/lib/api-error'
import { getProgress, updateStep, checkAndGrantReward } from '@/lib/onboarding-service'
import type { OnboardingStepId, StepStatus } from '@/lib/onboarding-service'
import { createSampleProject } from '@/lib/sample-project-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboarding
 * 获取用户引导进度，首次调用时自动创建进度记录并触发示例项目创建
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request)

    // 获取进度（不存在时自动创建初始记录）
    const progress = await getProgress(userId)

    // 首次创建进度时自动创建示例项目（幂等操作，已存在则跳过）
    await createSampleProject(userId)

    return NextResponse.json(progress)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/onboarding]', error)
    return NextResponse.json({ error: '获取引导进度失败' }, { status: 500 })
  }
}

/**
 * PUT /api/onboarding
 * 更新单个引导步骤状态，更新后检查是否满足奖励条件
 *
 * Body: { stepId: OnboardingStepId, status: 'COMPLETED' | 'SKIPPED' }
 * Response: { progress: OnboardingProgress, rewardGranted: boolean }
 */
const UpdateStepSchema = z.object({
  stepId: z.enum([
    'WELCOME_WIZARD',
    'SAMPLE_PROJECT_CREATED',
    'DASHBOARD_TOOLTIP',
    'EDITOR_GUIDE',
    'FIRST_PROJECT_GUIDE',
  ] as const),
  status: z.enum(['COMPLETED', 'SKIPPED'] as const),
})

export async function PUT(request: NextRequest) {
  try {
    const userId = getUserId(request)
    const body = await request.json()

    // Zod 参数校验
    const parsed = UpdateStepSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { stepId, status } = parsed.data

    // 更新步骤状态
    await updateStep(userId, stepId as OnboardingStepId, status as StepStatus)

    // 检查是否满足奖励条件
    const rewardGranted = await checkAndGrantReward(userId)

    // 获取更新后的完整进度
    const progress = await getProgress(userId)

    return NextResponse.json({ progress, rewardGranted })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[PUT /api/onboarding]', error)
    return NextResponse.json({ error: '更新引导步骤失败' }, { status: 500 })
  }
}
