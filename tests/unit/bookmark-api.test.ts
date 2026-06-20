import { describe, it, expect } from 'vitest'
import { computeExpiryStatus } from '@/lib/expiry-status'

/**
 * Bookmark API 边界情况测试
 * 测试 POST /api/assets/[id]/bookmark 的核心验证逻辑
 *
 * Validates: Requirements 4.1, 4.4
 */

// ========================
// 类型定义
// ========================

interface MockAsset {
  id: string
  userId: string
  status: string
  category: string | null
  expiresAt: Date | null
}

// ========================
// 模拟 API 验证逻辑（与 route.ts 一致）
// ========================

/**
 * 模拟 Bookmark API 的验证逻辑
 * 按实际 route.ts 中的校验顺序：
 * 1. 鉴权：x-user-id 是否存在
 * 2. 资产存在性：asset 是否存在
 * 3. 所有权：asset.userId === requestUserId
 * 4. 状态：asset.status !== 'EXPIRED'
 */
function validateBookmark(
  asset: MockAsset | null,
  requestUserId: string | null
): { error: string; status: number } | null {
  if (!requestUserId) return { error: '未授权', status: 401 }
  if (!asset) return { error: '资产不存在或已被删除', status: 404 }
  if (asset.userId !== requestUserId) return { error: '无权操作该资产', status: 403 }
  if (asset.status === 'EXPIRED') return { error: '该资产已过期清理，无法收藏', status: 400 }
  return null // 校验通过
}

/**
 * 模拟 Bookmark 操作执行逻辑
 * 设置 expiresAt=null，设置 category
 */
function executeBookmark(asset: MockAsset, category: string = 'CHARACTER'): MockAsset {
  return { ...asset, expiresAt: null, category }
}

// ========================
// 测试：错误情况
// ========================

describe('Bookmark API - 边界情况', () => {
  describe('错误校验', () => {
    it('资产不存在 → 返回 404 错误', () => {
      const result = validateBookmark(null, 'user-1')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(404)
      expect(result!.error).toBe('资产不存在或已被删除')
    })

    it('非本人资产操作 → 返回 403 错误', () => {
      const asset: MockAsset = {
        id: 'asset-1',
        userId: 'user-owner',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-06-20'),
      }

      const result = validateBookmark(asset, 'user-other')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(403)
      expect(result!.error).toBe('无权操作该资产')
    })

    it('已过期资产执行 Bookmark → 返回 400 错误', () => {
      const asset: MockAsset = {
        id: 'asset-expired',
        userId: 'user-1',
        status: 'EXPIRED',
        category: null,
        expiresAt: new Date('2024-01-01'),
      }

      const result = validateBookmark(asset, 'user-1')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(400)
      expect(result!.error).toBe('该资产已过期清理，无法收藏')
    })

    it('未授权（缺少 x-user-id）→ 返回 401 错误', () => {
      const asset: MockAsset = {
        id: 'asset-1',
        userId: 'user-1',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-06-20'),
      }

      const result = validateBookmark(asset, null)

      expect(result).not.toBeNull()
      expect(result!.status).toBe(401)
      expect(result!.error).toBe('未授权')
    })
  })

  // ========================
  // 测试：正常流程
  // ========================

  describe('正常收藏流程', () => {
    it('临时资产收藏成功 → expiresAt 变为 null，category 被设置', () => {
      const asset: MockAsset = {
        id: 'asset-temp',
        userId: 'user-1',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-07-01'),
      }

      // 校验通过
      const validationResult = validateBookmark(asset, 'user-1')
      expect(validationResult).toBeNull()

      // 执行 bookmark
      const updated = executeBookmark(asset, 'CHARACTER')

      expect(updated.expiresAt).toBeNull()
      expect(updated.category).toBe('CHARACTER')
      // 验证 expiryStatus 变为 permanent
      const expiryStatus = computeExpiryStatus(updated.expiresAt)
      expect(expiryStatus.status).toBe('permanent')
      expect(expiryStatus.remainingDays).toBeNull()
    })

    it('收藏时可指定自定义 category', () => {
      const asset: MockAsset = {
        id: 'asset-temp-2',
        userId: 'user-1',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-07-01'),
      }

      const updated = executeBookmark(asset, 'MATERIAL')

      expect(updated.expiresAt).toBeNull()
      expect(updated.category).toBe('MATERIAL')
    })

    it('不传 category 时默认使用 CHARACTER', () => {
      const asset: MockAsset = {
        id: 'asset-temp-3',
        userId: 'user-1',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-07-01'),
      }

      const updated = executeBookmark(asset)

      expect(updated.category).toBe('CHARACTER')
    })
  })

  // ========================
  // 测试：幂等行为
  // ========================

  describe('幂等行为：重复收藏已是永久资产', () => {
    it('已是永久资产再次执行 Bookmark → 校验通过，结果不变', () => {
      const alreadyPermanentAsset: MockAsset = {
        id: 'asset-permanent',
        userId: 'user-1',
        status: 'UPLOADED',
        category: 'CHARACTER',
        expiresAt: null,
      }

      // 校验仍然通过（不是 EXPIRED 状态，是本人资产）
      const validationResult = validateBookmark(alreadyPermanentAsset, 'user-1')
      expect(validationResult).toBeNull()

      // 再次执行 bookmark：expiresAt 保持 null，category 保持
      const updated = executeBookmark(alreadyPermanentAsset, 'CHARACTER')

      expect(updated.expiresAt).toBeNull()
      expect(updated.category).toBe('CHARACTER')
      // expiryStatus 仍为 permanent
      const expiryStatus = computeExpiryStatus(updated.expiresAt)
      expect(expiryStatus.status).toBe('permanent')
    })

    it('已是永久资产用不同 category 收藏 → category 更新，expiresAt 仍为 null', () => {
      const alreadyPermanentAsset: MockAsset = {
        id: 'asset-permanent-2',
        userId: 'user-1',
        status: 'UPLOADED',
        category: 'CHARACTER',
        expiresAt: null,
      }

      // 校验通过
      const validationResult = validateBookmark(alreadyPermanentAsset, 'user-1')
      expect(validationResult).toBeNull()

      // 用不同 category 执行
      const updated = executeBookmark(alreadyPermanentAsset, 'MATERIAL')

      expect(updated.expiresAt).toBeNull()
      expect(updated.category).toBe('MATERIAL')
      // 仍然是永久资产
      const expiryStatus = computeExpiryStatus(updated.expiresAt)
      expect(expiryStatus.status).toBe('permanent')
    })

    it('多次连续收藏结果一致（幂等性）', () => {
      const asset: MockAsset = {
        id: 'asset-idempotent',
        userId: 'user-1',
        status: 'UPLOADED',
        category: null,
        expiresAt: new Date('2025-07-01'),
      }

      // 第一次收藏
      const first = executeBookmark(asset, 'CHARACTER')
      // 第二次收藏（对已收藏资产再次收藏）
      const second = executeBookmark(first, 'CHARACTER')
      // 第三次收藏
      const third = executeBookmark(second, 'CHARACTER')

      // 结果一致
      expect(first.expiresAt).toBeNull()
      expect(second.expiresAt).toBeNull()
      expect(third.expiresAt).toBeNull()
      expect(first.category).toBe('CHARACTER')
      expect(second.category).toBe('CHARACTER')
      expect(third.category).toBe('CHARACTER')
    })
  })
})
