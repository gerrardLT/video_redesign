/**
 * 内容计划编辑类 API（content-briefs 新增/编辑/删除）的统一错误映射。
 *
 * 将 content-calendar-service 抛出的领域错误映射为一致的 HTTP 响应，供
 * POST /api/content-briefs 与 PATCH/DELETE /api/content-briefs/[briefId] 复用。
 *
 * 映射规则：
 * - ApiError：按其状态码透传（鉴权/归属等）
 * - DayLimitExceededError → 409 DAY_LIMIT_EXCEEDED（需求 6.2）
 * - InvalidDateError → 400 VALIDATION_ERROR
 * - ProfileIncompleteError / PlaybookUnavailableError / GoalPlaybookMismatchError → 422 UNPROCESSABLE
 * - 其它 → 500 INTERNAL_ERROR
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import { NextResponse } from 'next/server'
import { ApiError, DomainError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

// ========================
// 内容日历领域错误类（继承 DomainError，统一进入 ApiError 体系）
// ========================

/** 单日 brief 数量已达上限（需求 6.2） */
export class DayLimitExceededError extends DomainError {
  constructor(message: string) {
    super('DAY_LIMIT_EXCEEDED', message, 409)
    this.name = 'DayLimitExceededError'
  }
}

/** 日期参数非法 */
export class InvalidDateError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400)
    this.name = 'InvalidDateError'
  }
}

/** 门店画像未完成或内容定位为空（需求 4.7） */
export class ProfileIncompleteError extends DomainError {
  constructor(message: string) {
    super('UNPROCESSABLE', message, 422)
    this.name = 'ProfileIncompleteError'
  }
}

/** 剧本不存在、已停用或目标无可用剧本 */
export class PlaybookUnavailableError extends DomainError {
  constructor(message: string) {
    super('UNPROCESSABLE', message, 422)
    this.name = 'PlaybookUnavailableError'
  }
}

/** 指定剧本目标与操作目标不一致 */
export class GoalPlaybookMismatchError extends DomainError {
  constructor(message: string) {
    super('UNPROCESSABLE', message, 422)
    this.name = 'GoalPlaybookMismatchError'
  }
}

/**
 * 将 content-calendar-service 抛出的错误映射为 HTTP 响应。
 *
 * 领域错误类已继承 DomainError（即 ApiError），统一由 ApiError 分支处理。
 * @param error 捕获到的错误
 * @param scope 日志作用域标识（如 'POST /api/content-briefs'）
 */
export function mapContentBriefError(error: unknown, scope: string): NextResponse {
  // ApiError（包括 DomainError 子类）：按其状态码透传
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    )
  }

  logger.error(`${scope} 未知错误`, { error: error instanceof Error ? error.message : String(error) })
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
    { status: 500 }
  )
}
