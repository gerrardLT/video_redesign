/**
 * merchant-auth 权限验证工具 单元测试
 *
 * 测试覆盖：
 * - getUserIdFromRequest: header 缺失抛 401，有值时正确返回
 * - getMerchantByUserId: 查询商家记录
 * - validateMerchantAccess: 数据隔离验证逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/shared/api-error'
// Mock prisma
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
    },
    store: {
      findUnique: vi.fn(),
    },
  },
}))
import { prisma } from '@/lib/shared/db'
import {
  getUserIdFromRequest,
  getMerchantByUserId,
  validateMerchantAccess,
} from '@/lib/merchant/merchant-auth'
function createMockRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new NextRequest('http://localhost:3011/api/test', {
    method: 'GET',
  })
  for (const [key, value] of Object.entries(headers)) {
    req.headers.set(key, value)
  }
  return req
}
describe('merchant-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  describe('getUserIdFromRequest', () => {
    it('缺少 x-user-id header 时抛出 401 UNAUTHORIZED', () => {
      const req = createMockRequest({})
      expect(() => getUserIdFromRequest(req)).toThrow(ApiError)
      try {
        getUserIdFromRequest(req)
      } catch (e) {
        const err = e as ApiError
        expect(err.statusCode).toBe(401)
        expect(err.code).toBe('UNAUTHORIZED')
      }
    })
    it('有 x-user-id header 时返回 userId', () => {
      const req = createMockRequest({ 'x-user-id': 'user-abc-123' })
      const result = getUserIdFromRequest(req)
      expect(result).toBe('user-abc-123')
    })
  })
  describe('getMerchantByUserId', () => {
    it('用户有商家记录时返回含 stores 的商家对象', async () => {
      const mockMerchant = {
        id: 'merchant-1',
        userId: 'user-1',
        name: '测试商家',
        industry: 'RESTAURANT',
        stores: [{ id: 'store-1', merchantId: 'merchant-1', name: '测试门店' }],
      }
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue(mockMerchant as never)
      const result = await getMerchantByUserId('user-1')
      expect(result).toEqual(mockMerchant)
      expect(prisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { stores: true },
      })
    })
    it('用户无商家记录时返回 null', async () => {
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue(null)
      const result = await getMerchantByUserId('user-unknown')
      expect(result).toBeNull()
    })
  })
  describe('validateMerchantAccess', () => {
    it('用户无商家身份时抛出 403', async () => {
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue(null)
      await expect(
        validateMerchantAccess('user-no-merchant', 'store-1')
      ).rejects.toThrow(ApiError)
      try {
        await validateMerchantAccess('user-no-merchant', 'store-1')
      } catch (e) {
        const err = e as ApiError
        expect(err.statusCode).toBe(403)
        expect(err.message).toContain('无商家身份')
      }
    })
    it('门店不存在时抛出 403', async () => {
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue({
        id: 'merchant-1',
        userId: 'user-1',
        name: '商家',
        industry: 'RESTAURANT',
      } as never)
      vi.mocked(prisma.store.findUnique).mockResolvedValue(null)
      await expect(
        validateMerchantAccess('user-1', 'store-nonexist')
      ).rejects.toThrow(ApiError)
      try {
        await validateMerchantAccess('user-1', 'store-nonexist')
      } catch (e) {
        const err = e as ApiError
        expect(err.statusCode).toBe(403)
        expect(err.message).toContain('门店不存在')
      }
    })
    it('门店不属于当前用户的商家时抛出 403', async () => {
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue({
        id: 'merchant-1',
        userId: 'user-1',
        name: '商家A',
        industry: 'RESTAURANT',
      } as never)
      vi.mocked(prisma.store.findUnique).mockResolvedValue({
        id: 'store-other',
        merchantId: 'merchant-2', // 属于另一个商家
        name: '别人的门店',
      } as never)
      await expect(
        validateMerchantAccess('user-1', 'store-other')
      ).rejects.toThrow(ApiError)
      try {
        await validateMerchantAccess('user-1', 'store-other')
      } catch (e) {
        const err = e as ApiError
        expect(err.statusCode).toBe(403)
        expect(err.message).toContain('无权访问该门店')
      }
    })
    it('验证通过时返回 merchant 和 store 对象', async () => {
      const mockMerchant = {
        id: 'merchant-1',
        userId: 'user-1',
        name: '商家A',
        industry: 'RESTAURANT',
      }
      const mockStore = {
        id: 'store-1',
        merchantId: 'merchant-1', // 属于该商家
        name: '门店A',
      }
      vi.mocked(prisma.merchant.findUnique).mockResolvedValue(mockMerchant as never)
      vi.mocked(prisma.store.findUnique).mockResolvedValue(mockStore as never)
      const result = await validateMerchantAccess('user-1', 'store-1')
      expect(result.merchant).toEqual(mockMerchant)
      expect(result.store).toEqual(mockStore)
    })
  })
})
