/**
 * 内容计划编辑类 API（content-briefs 新增/编辑/删除）的统一错误映射。
 *
 * 将 content-calendar-service 抛出的领域错误映射为一致的 HTTP 响应，供
 * POST /api/content-briefs 与 PATCH/DELETE /api/content-briefs/[briefId] 复用。
 *
 * 映射规则：
 * - ApiError：按其状态码透传（鉴权/归属等）
 * - 当日内容已达上限 → 409 DAY_LIMIT_EXCEEDED（需求 6.2）
 * - 日期非法 → 400 VALIDATION_ERROR
 * - 画像未完成 / 剧本不可用 → 422 UNPROCESSABLE
 * - 其它 → 500 INTERNAL_ERROR
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-error'

/**
 * 将 content-calendar-service 抛出的领域错误映射为 HTTP 响应。
 * @param error 捕获到的错误
 * @param scope 日志作用域标识（如 'POST /api/content-briefs'）
 */
export function mapContentBriefError(error: unknown, scope: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    )
  }

  if (error instanceof Error) {
    const message = error.message

    // 单日上界超出（需求 6.2）：显式返回 409，前端据此提示「当日已达上限」
    if (/当日内容已达上限/.test(message)) {
      return NextResponse.json(
        { error: { code: 'DAY_LIMIT_EXCEEDED', message } },
        { status: 409 }
      )
    }

    // 日期非法
    if (/不是合法日期/.test(message)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message } },
        { status: 400 }
      )
    }

    // 门店画像未完成 / 剧本不可用 / 目标无可用剧本 / 剧本目标不一致 → 业务前置条件不满足
    if (/画像未完成|内容定位为空|剧本不存在|剧本已停用|无可用剧本|不一致/.test(message)) {
      return NextResponse.json(
        { error: { code: 'UNPROCESSABLE', message } },
        { status: 422 }
      )
    }
  }

  console.error(`[${scope}] 未知错误:`, error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
    { status: 500 }
  )
}
