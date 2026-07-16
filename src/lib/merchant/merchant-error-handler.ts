/**
 * 商家平台统一错误映射
 *
 * 所有 merchant API Route Handler 的 catch 块应统一调用 mapMerchantError，
 * 将捕获的 ApiError（含 DomainError 子类）映射为标准 HTTP JSON 响应。
 *
 * 用法：
 *   catch (error) {
 *     return mapMerchantError(error, 'POST /api/content-briefs')
 *   }
 */

import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

/**
 * 将任意错误映射为标准 HTTP 错误响应。
 *
 * - ApiError（含 DomainError 子类）：按 code + statusCode 透传
 * - 其他错误：记录日志，返回 500 INTERNAL_ERROR
 *
 * @param error 捕获到的错误
 * @param scope 日志作用域标识（如 'POST /api/stores/[storeId]'）
 */
export function mapMerchantError(error: unknown, scope: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    )
  }

  logger.error(`${scope} 未知错误`, {
    error: error instanceof Error ? error.message : String(error),
  })
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
    { status: 500 }
  )
}
