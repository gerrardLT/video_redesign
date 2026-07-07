/**
 * POST /api/stores/switch — 切换当前所选门店（需求 10.2）
 *
 * 鉴权：从 x-user-id header 获取用户 ID。
 * 请求体含 storeId，先经 validateMerchantAccess 校验该门店归属当前用户的商家（数据隔离），
 * 校验通过后将其设为统一作用域键 `currentStoreId`：
 * - 写入同名 cookie（非 httpOnly，便于前端读取后在后续请求中携带作用域）；
 * - 同时在响应体回传 currentStoreId 供前端持有。
 *
 * `currentStoreId` 是任务中心（需求 9）、通知中心、跨店看板（需求 10）共享的统一作用域键，
 * 切换门店即切换上述功能的数据作用域，不跨店混合聚合。
 *
 * 纯状态切换，不消耗积分。
 *
 * 响应：
 * - 200: { currentStoreId: string }（已写入同名 cookie）
 * - 400: 请求体格式错误 / 缺少 storeId
 * - 401: 未认证
 * - 403: 无商家身份 / 门店不存在 / 无权访问该门店
 * - 500: 服务器内部错误
 *
 * Requirements: 10.1, 10.2, 10.3
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
/** 统一作用域键 cookie 名称：任务中心/通知中心/跨店看板共享 */
const CURRENT_STORE_COOKIE = 'currentStoreId'
export async function POST(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)
    // 2. 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }
    // 3. 校验 storeId 存在且为非空字符串
    const storeId =
      typeof body === 'object' && body !== null && 'storeId' in body
        ? (body as { storeId: unknown }).storeId
        : undefined
    if (typeof storeId !== 'string' || storeId.trim() === '') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少有效的 storeId' } },
        { status: 400 }
      )
    }
    // 4. 数据隔离校验：目标门店必须归属当前用户的商家（失败抛 403）
    await validateMerchantAccess(userId, storeId)
    // 5. 写入统一作用域键 cookie 并回传，供前端持有
    const response = NextResponse.json({ currentStoreId: storeId })
    response.cookies.set(CURRENT_STORE_COOKIE, storeId, {
      // 非 httpOnly：作用域键非敏感凭证，前端需读取后在后续请求中携带
      httpOnly: false,
      secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https') ?? false,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 天
    })
    return response
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/stores/switch] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
