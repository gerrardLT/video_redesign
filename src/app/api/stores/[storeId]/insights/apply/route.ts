/**
 * POST /api/stores/[storeId]/insights/apply — 应用复盘建议（可反哺）
 *
 * 调用 performance-learning-service.applyInsights：将商家采纳的复盘建议
 * （推荐下周目标 / 复用剧本 / 规避剧本 / 采纳摘要）固化为下一轮内容计划生成输入
 * （写入 PlanGenerationInput），供 content-calendar-service 一次性消费。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { planInput: PlanGenerationInput, message: string }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 404: 门店不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 1.3, 1.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { applyInsights } from '@/lib/merchant/performance-learning-service'
import { ContentGoalSchema } from '@/types/merchant'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

/**
 * 应用复盘建议请求体校验：
 * - acceptedNextGoals / reusePlaybookIds / avoidPlaybookIds 均为可选，未采纳时不传或传空数组
 * - acceptedSuggestionSummaries 必填（可为空数组），用于计划上的「已采纳上轮复盘建议」标注
 */
const ApplyInsightsSchema = z.object({
  acceptedNextGoals: z.array(ContentGoalSchema).optional(),
  reusePlaybookIds: z.array(z.string().min(1)).optional(),
  avoidPlaybookIds: z.array(z.string().min(1)).optional(),
  acceptedSuggestionSummaries: z.array(z.string()),
})

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    // Zod 校验
    const parseResult = ApplyInsightsSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }

    const data = parseResult.data

    // 调用服务写入下一轮计划生成输入（不消耗积分）
    const planInput = await applyInsights({
      storeId,
      acceptedNextGoals: data.acceptedNextGoals,
      reusePlaybookIds: data.reusePlaybookIds,
      avoidPlaybookIds: data.avoidPlaybookIds,
      acceptedSuggestionSummaries: data.acceptedSuggestionSummaries,
    })

    return NextResponse.json({ planInput, message: '已采纳，将在下一轮内容计划生效' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/stores/[storeId]/insights/apply] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
