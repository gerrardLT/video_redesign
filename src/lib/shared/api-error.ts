/**
 * 统一 API 错误处理
 * 所有 API 路由应使用 toErrorResponse 构造标准错误响应格式: { error: { code, message } }
 */

import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 领域业务错误基类。
 *
 * 服务层在遇到业务前置条件不满足（画像未完成、剧本不可用、单日限额等）时抛出。
 * 默认 HTTP 422，子类可覆盖 statusCode。所有 DomainError 都是 ApiError，
 * 统一由 mapMerchantError / apiErrorToResponse 处理。
 */
export class DomainError extends ApiError {
  constructor(code: string, message: string, statusCode: number = 422) {
    super(code, message, statusCode)
    this.name = 'DomainError'
  }
}

export const ERROR_CODES = {
  VALIDATION_ERROR: '参数校验失败',
  UNAUTHORIZED: '未登录',
  FORBIDDEN: '无权限',
  NOT_FOUND: '资源不存在',
  INSUFFICIENT_CREDITS: '积分不足',
  RATE_LIMITED: '请求过于频繁',
  INTERNAL_ERROR: '系统错误',
} as const

export type ErrorCode = keyof typeof ERROR_CODES

/**
 * 构造统一错误响应 JSON（内部数据结构，不含 NextResponse 包装）
 */
export function errorResponse(code: ErrorCode, message?: string, statusCode?: number) {
  const msg = message || ERROR_CODES[code]
  const status = statusCode || getDefaultStatusCode(code)
  return { error: { code, message: msg }, status }
}

/**
 * 构造统一的 NextResponse 错误响应
 * 标准格式: { error: { code: string, message: string } }
 *
 * 用法:
 *   return toErrorResponse('VALIDATION_ERROR', '项目名称不能为空')
 *   return toErrorResponse('INTERNAL_ERROR')  // 使用默认消息
 */
export function toErrorResponse(code: ErrorCode, message?: string, statusCode?: number): NextResponse {
  const msg = message || ERROR_CODES[code]
  const status = statusCode || getDefaultStatusCode(code)
  return NextResponse.json({ error: { code, message: msg } }, { status })
}

/**
 * 将 ApiError 实例转为标准 NextResponse
 */
export function apiErrorToResponse(error: ApiError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.statusCode }
  )
}

function getDefaultStatusCode(code: ErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'RATE_LIMITED':
      return 429
    case 'INTERNAL_ERROR':
      return 500
    default:
      return 400
  }
}
