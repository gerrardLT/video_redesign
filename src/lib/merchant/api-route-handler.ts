/**
 * 统一 API 路由处理模板
 *
 * 封装商家/门店 API 路由的公共逻辑：鉴权 → 错误处理 → 统一响应格式。
 * 消除 20+ 个路由文件中重复的 try/catch + ApiError 检测 + logger + 500 兜底代码。
 *
 * 用法：
 *   // 简单 GET
 *   export const GET = withMerchantHandler('GET /api/stores/dashboard', async ({ userId }) => {
 *     const stores = await getCrossStoreDashboard({ userId })
 *     return NextResponse.json({ stores })
 *   })
 *
 *   // POST + body + storeId
 *   export const POST = withMerchantHandler('POST /api/stores/[storeId]/insights/apply',
 *     async ({ userId, request, params }) => {
 *       const { storeId } = await params
 *       await validateMerchantAccess(userId, storeId)
 *       const body = await request.json()
 *       const data = SomeSchema.parse(body)
 *       const result = await someService({ storeId, ...data })
 *       return NextResponse.json(result)
 *     }
 *   )
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'

/** 传给业务处理函数的上下文 */
export interface MerchantHandlerContext {
  /** 已鉴权的用户 ID（从 x-user-id header 提取） */
  userId: string
  /** 原始请求对象（用于读取 body / query / headers） */
  request: NextRequest
}

/** 带路由参数的上下文（用于 [storeId] 等动态路由） */
export interface MerchantHandlerContextWithParams<P extends Record<string, string>>
  extends MerchantHandlerContext {
  params: Promise<P>
}

/**
 * 包装商家 API 路由处理函数，统一处理：
 * - 鉴权（从 x-user-id header 获取 userId）
 * - ApiError → 标准错误响应
 * - 未知错误 → 500 + 结构化日志
 *
 * @param scope 日志作用域标识（如 'GET /api/stores/dashboard'）
 * @param handler 业务处理函数，接收 { userId, request } 上下文
 */
export function withMerchantHandler(
  scope: string,
  handler: (ctx: MerchantHandlerContext) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    try {
      const userId = getUserIdFromRequest(request)
      return await handler({ userId, request })
    } catch (error) {
      return handleRouteError(error, scope)
    }
  }
}

/**
 * 包装带路由参数的商家 API 路由处理函数。
 *
 * @param scope 日志作用域标识
 * @param handler 业务处理函数，接收 { userId, request, params } 上下文
 */
export function withMerchantParamsHandler<P extends Record<string, string>>(
  scope: string,
  handler: (ctx: MerchantHandlerContextWithParams<P>) => Promise<NextResponse>
): (request: NextRequest, context: { params: Promise<P> }) => Promise<NextResponse> {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const userId = getUserIdFromRequest(request)
      return await handler({ userId, request, params: context.params })
    } catch (error) {
      return handleRouteError(error, scope)
    }
  }
}

/**
 * 统一错误响应处理（供内部复用，也可被外部自定义路由直接调用）。
 *
 * - ApiError：按 code + statusCode 透传
 * - 其它：记录结构化日志 + 返回 500 兜底
 */
export function handleRouteError(error: unknown, scope: string): NextResponse {
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

/**
 * 安全解析请求体 JSON，失败时返回标准 400 响应。
 * 用于 POST/PUT/PATCH 路由中替代 `request.json()` 的 try/catch 块。
 */
export async function parseJsonBody(
  request: NextRequest
): Promise<NextResponse | Record<string, unknown>> {
  try {
    return await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
      { status: 400 }
    )
  }
}

/**
 * 判断 parseJsonBody 返回的是错误响应还是解析后的数据。
 */
export function isErrorResponse(
  result: NextResponse | Record<string, unknown>
): result is NextResponse {
  return result instanceof NextResponse
}
