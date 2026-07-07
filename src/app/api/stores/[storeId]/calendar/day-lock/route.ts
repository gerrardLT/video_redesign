/**
 * PUT /api/stores/[storeId]/calendar/day-lock — 锁定/跳过/恢复某天（需求 6.5）
 *
 * 写入 CalendarDayState（按 storeId + 自然日 UTC 零点为唯一键 upsert）。下一轮自动生成
 * （generateContentPlan）尊重 LOCKED/SKIPPED 状态：不覆盖、不改写，且不在 SKIPPED 天填充
 * 内容（需求 6.5, 6.7）。state=NORMAL 表示恢复为可自动生成。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 请求体：{ date(ISO 字符串), state('LOCKED' | 'SKIPPED' | 'NORMAL') }
 *
 * 响应：
 * - 200: { ok: true, message }
 * - 400: 参数校验失败 / 日期非法（VALIDATION_ERROR）
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 500: 服务器内部错误
 *
 * Requirements: 6.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { setDayLockState } from '@/lib/merchant/content-calendar-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ storeId: string }>
}

/** 锁定/跳过请求体校验：date 为 ISO 日期字符串，state 为三态枚举 */
const DayLockSchema = z.object({
  date: z.string().min(1, 'date 不能为空'),
  state: z.enum(['LOCKED', 'SKIPPED', 'NORMAL']),
})

export async function PUT(request: NextRequest, context: RouteContext) {
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

    const parseResult = DayLockSchema.safeParse(body)
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

    const { date, state } = parseResult.data

    // 调用服务写入 CalendarDayState（纯写库，不消耗积分）
    await setDayLockState({ storeId, date: new Date(date), state })

    const stateText = state === 'LOCKED' ? '已锁定' : state === 'SKIPPED' ? '已设为跳过' : '已恢复'
    return NextResponse.json({ ok: true, message: stateText })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    // 日期非法（服务层 assertValidDate 抛出）显式返回 400
    if (error instanceof Error && /不是合法日期/.test(error.message)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: error.message } },
        { status: 400 }
      )
    }
    console.error('[PUT /api/stores/[storeId]/calendar/day-lock] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
