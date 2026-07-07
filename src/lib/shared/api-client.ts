/**
 * 统一 API 客户端封装
 * 提供全局 401 拦截、统一错误格式解析等能力
 *
 * P1 修复：前端无全局 401 拦截，token 过期后用户看到碎片化错误
 */

/**
 * API 响应错误（统一格式）
 */
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/**
 * 统一的 API 请求封装
 * - 自动检测 401 并跳转登录页（携带 redirect 参数）
 * - 统一解析错误格式（兼容 { error: string } 和 { error: { code, message } }）
 * - 自动处理 JSON 序列化
 *
 * @param url API 路径（如 '/api/projects'）
 * @param options fetch 选项
 * @returns 解析后的 JSON 数据
 * @throws ApiClientError 当响应非 2xx 时抛出
 */
export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  // 401 未认证：自动跳转登录页
  if (res.status === 401) {
    const currentPath = window.location.pathname
    // 避免登录页循环跳转
    if (!currentPath.startsWith('/login') && !currentPath.startsWith('/register')) {
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
    }
    throw new ApiClientError('UNAUTHORIZED', '登录已过期，请重新登录', 401)
  }

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    // 统一解析错误格式
    let code = 'UNKNOWN_ERROR'
    let message = '请求失败'

    if (data?.error) {
      if (typeof data.error === 'object' && data.error.message) {
        code = data.error.code || code
        message = data.error.message
      } else if (typeof data.error === 'string') {
        message = data.error
      }
    }

    throw new ApiClientError(code, message, res.status)
  }

  return data as T
}

/**
 * GET 请求快捷方法
 */
export function apiGet<T = unknown>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'GET' })
}

/**
 * POST 请求快捷方法
 */
export function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * PATCH 请求快捷方法
 */
export function apiPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * DELETE 请求快捷方法
 */
export function apiDelete<T = unknown>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'DELETE' })
}
