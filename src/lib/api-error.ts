/**
 * 统一 API 错误处理
 */

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
 * 构造统一错误响应 JSON
 */
export function errorResponse(code: ErrorCode, message?: string, statusCode?: number) {
  const msg = message || ERROR_CODES[code]
  const status = statusCode || getDefaultStatusCode(code)
  return { error: { code, message: msg }, status }
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
