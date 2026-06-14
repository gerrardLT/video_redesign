/**
 * 认证与授权辅助函数
 * 用于 API Route 中快速提取用户身份和权限校验
 */

import { NextRequest } from 'next/server'
import { ApiError } from './api-error'

/**
 * 从请求头中获取当前用户 ID
 * 如果未认证则抛出 ApiError
 */
export function getUserId(request: NextRequest): string {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    throw new ApiError('UNAUTHORIZED', '未登录', 401)
  }
  return userId
}

/**
 * 校验当前用户是否为管理员
 * 如果不是 ADMIN 角色则抛出 ApiError
 */
export function requireAdmin(request: NextRequest): void {
  const role = request.headers.get('x-user-role')
  if (role !== 'ADMIN') {
    throw new ApiError('FORBIDDEN', '需要管理员权限', 403)
  }
}

/**
 * 获取当前用户角色
 */
export function getUserRole(request: NextRequest): string {
  return request.headers.get('x-user-role') || 'USER'
}
