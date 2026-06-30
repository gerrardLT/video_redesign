/**
 * GET /api/stores/[storeId]/metrics/trend?metric=views — 指标趋势查询
 *
 * 调用 performance-learning-service.getMetricTrend：返回门店所有带 metrics 的 brief
 * 在指定指标上的时间序列（按 date 升序，每个含该指标的 brief 恰出现一次）。
 *
 * metric 取自 query string，需为合法 TrendMetric 之一；缺失或非法时显式 400 拒绝，不静默降级。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + 参数校验 + 调用服务 + 返回，纯读库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 响应：
 * - 200: { metric: TrendMetric, trend: MetricTrendPoint[] }
 * - 400: metric 参数缺失或非法
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 1.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { getMetricTrend } from '@/lib/performance-learning-service'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

/** 趋势指标校验：与 performance-learning-service 的 TrendMetric 保持一致 */
const TrendMetricSchema = z.enum([
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'linkClicks',
  'orders',
  'redemptions',
  'conversion',
])

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)

    // 从 query 取出 metric 并校验（缺失/非法显式拒绝，不默认回退）
    const metricParam = request.nextUrl.searchParams.get('metric')
    const parseResult = TrendMetricSchema.safeParse(metricParam)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'metric 参数缺失或非法，需为 views/likes/comments/shares/saves/linkClicks/orders/redemptions/conversion 之一',
          },
        },
        { status: 400 }
      )
    }

    const metric = parseResult.data

    // 调用趋势查询服务（不消耗积分）
    const trend = await getMetricTrend({ storeId, metric })

    return NextResponse.json({ metric, trend })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/stores/[storeId]/metrics/trend] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
