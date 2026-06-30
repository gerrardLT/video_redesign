/**
 * GET /api/stores/[storeId]/engagement — 激励与留存聚合（当前门店作用域）
 *
 * 并行调用 engagement-service 的四项能力并聚合为单一响应：
 * - getStreak：连续创作统计（连续天数 / 周数，基于 period-service 周期口径，仅真实发布数据，需求 11.1）
 * - checkMilestones：当前成立的里程碑集合；检测到新达成里程碑时写入门店作用域 MILESTONE 通知（需求 11.2）
 * - getGrowthComparison：本月最佳 vs 上月最佳效果对比，历史不足时显式返回 available:false（需求 11.3）
 * - getOnboardingProgress：渐进式进阶引导任务（完成度由真实数据派生，需求 11.4）
 *
 * 副作用说明：checkMilestones 会写 StoreNotification + StreakRecord，但已通过 StreakRecord.milestones
 * 去重保证同一里程碑只产生一次通知，GET 中调用是幂等安全的。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 并行调用服务 + 返回，纯读写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { streak, milestones, growthComparison, onboarding }
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import {
  getStreak,
  checkMilestones,
  getGrowthComparison,
  getOnboardingProgress,
} from '@/lib/engagement-service'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 并行聚合连续创作 / 里程碑 / 效果对比 / 进阶引导（不消耗积分）
    const [streak, milestones, growthComparison, onboarding] = await Promise.all([
      getStreak({ storeId }),
      checkMilestones({ storeId }),
      getGrowthComparison({ storeId }),
      getOnboardingProgress({ storeId }),
    ])

    return NextResponse.json({ streak, milestones, growthComparison, onboarding })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/engagement] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
