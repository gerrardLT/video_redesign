/**
 * 商家权限验证工具
 *
 * 为商家营销平台 API 提供统一的认证和数据隔离验证：
 * - 从请求头提取 userId
 * - 验证用户对指定门店的访问权限（通过 userId → Merchant → Store 关系链）
 * - 查询用户关联的商家信息
 *
 * 数据隔离核心原则：所有查询强制 userId 关联验证，不依赖前端传参的 merchantId
 */

import { NextRequest } from 'next/server'
import type { Merchant, Store } from '@/generated/prisma'
import { prisma } from './db'
import { ApiError } from './api-error'

/**
 * 从 NextRequest 提取 userId (x-user-id header)
 * 由 middleware 注入，为空则表示未认证
 *
 * @throws ApiError 401 Unauthorized - header 缺失
 */
export function getUserIdFromRequest(request: NextRequest): string {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    throw new ApiError('UNAUTHORIZED', '未登录', 401)
  }
  return userId
}

/**
 * 通过 userId 查找关联的商家记录
 * 包含 stores 关系，方便后续使用
 *
 * @returns 商家记录（含 stores），未找到返回 null
 */
export async function getMerchantByUserId(
  userId: string
): Promise<(Merchant & { stores: Store[] }) | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    include: { stores: true },
  })
  return merchant
}

/**
 * 验证当前用户是否有权访问指定门店
 *
 * 验证流程：
 * 1. 通过 userId 查找 Merchant (where: { userId })
 * 2. 通过 storeId 查找 Store，验证 store.merchantId === merchant.id
 * 3. 任何一步失败抛 403 Forbidden
 *
 * @throws ApiError 403 Forbidden - 用户无商家身份或无权访问该门店
 */
export async function validateMerchantAccess(
  userId: string,
  storeId: string
): Promise<{ merchant: Merchant; store: Store }> {
  // 1. 通过 userId 查找商家记录
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
  })
  if (!merchant) {
    throw new ApiError('FORBIDDEN', '无商家身份，请先完成问诊', 403)
  }

  // 2. 通过 storeId 查找门店，并验证归属关系
  const store = await prisma.store.findUnique({
    where: { id: storeId },
  })
  if (!store) {
    throw new ApiError('FORBIDDEN', '门店不存在', 403)
  }

  // 3. 数据隔离核心：验证门店归属当前用户的商家
  if (store.merchantId !== merchant.id) {
    throw new ApiError('FORBIDDEN', '无权访问该门店', 403)
  }

  return { merchant, store }
}
