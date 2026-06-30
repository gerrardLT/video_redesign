// Feature: local-life-depth-enhancements, Property 34: 切换器可见性等价
//
// Property 34（Validates: Requirements 10.1, 10.4）：
//   门店切换器（及跨店看板）可见 当且仅当 maxStores > 1 AND storeCount > 1；否则隐藏，不展示空壳。
//
// 被测：src/lib/cross-store-service.ts 的 getStoreSwitcher。
// 依赖以内存桩替代（vi.mock）：
//   - privilege-engine.getMerchantPrivileges：返回随机 maxStores（会员权益的名下门店上限）
//   - prisma.store.findMany：返回随机 storeCount 家门店（商家名下实际门店）
// 随机化 maxStores / storeCount，断言 multiStore===true ⟺ (maxStores>1 && storeCount>1)，
// 且可见时返回完整 stores 列表。fast-check ≥100 次迭代，Node 环境。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ========================
// 内存桩：privilege-engine（提供随机 maxStores）
// ========================
const mockGetMerchantPrivileges = vi.fn()
vi.mock('@/lib/privilege-engine', () => ({
  getMerchantPrivileges: (userId: string) => mockGetMerchantPrivileges(userId),
}))

// ========================
// 内存桩：prisma.store.findMany（返回随机数量门店）
// ========================
const mockStoreFindMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    store: {
      findMany: (...args: unknown[]) => mockStoreFindMany(...args),
    },
  },
}))

// 桩就位后再导入被测模块，确保其内部引用的是上面的内存桩
import { getStoreSwitcher } from '@/lib/cross-store-service'

describe('Property 34: 切换器可见性等价', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('multiStore 可见 ⟺ (maxStores>1 && storeCount>1)，且可见时返回完整门店列表', async () => {
    await fc.assert(
      fc.asyncProperty(
        // maxStores：覆盖 0/1（不支持多店）与 >1（支持多店）边界
        fc.integer({ min: 0, max: 8 }),
        // storeCount：覆盖 0/1（单店或无店）与 >1（多店）边界
        fc.integer({ min: 0, max: 8 }),
        async (maxStores, storeCount) => {
          // 桩：权益返回随机 maxStores
          mockGetMerchantPrivileges.mockResolvedValue({ maxStores })

          // 桩：按 storeCount 构造门店列表（与 service 的 select 字段对齐：id、name）
          const stores = Array.from({ length: storeCount }, (_, i) => ({
            id: `store-${i}`,
            name: `门店${i}`,
          }))
          mockStoreFindMany.mockResolvedValue(stores)

          const result = await getStoreSwitcher({ userId: 'user-1' })

          // 可见性等价：当且仅当 maxStores>1 且 storeCount>1
          const expectedVisible = maxStores > 1 && storeCount > 1
          expect(result.multiStore).toBe(expectedVisible)

          if (result.multiStore) {
            // 可见时必须返回完整门店列表，且与桩数据逐项一致
            expect(stores.length).toBeGreaterThan(1)
            expect(result.stores).toHaveLength(storeCount)
            expect(result.stores.map((s) => s.storeId)).toEqual(stores.map((s) => s.id))
            expect(result.stores.map((s) => s.name)).toEqual(stores.map((s) => s.name))
          } else {
            // 隐藏时不应携带 stores 字段（不展示空壳）
            expect('stores' in result).toBe(false)
          }

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('单店或无多店权益的边界组合一律隐藏', async () => {
    // 显式覆盖三类隐藏边界：maxStores<=1 任意 storeCount、storeCount<=1 任意 maxStores
    const hiddenCases: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [1, 5], // 有多店但权益不支持
      [5, 1], // 权益支持但只有单店
      [5, 0], // 权益支持但无店
    ]

    for (const [maxStores, storeCount] of hiddenCases) {
      vi.clearAllMocks()
      mockGetMerchantPrivileges.mockResolvedValue({ maxStores })
      mockStoreFindMany.mockResolvedValue(
        Array.from({ length: storeCount }, (_, i) => ({ id: `s-${i}`, name: `n-${i}` }))
      )

      const result = await getStoreSwitcher({ userId: 'user-1' })
      expect(result.multiStore).toBe(false)
    }
  })
})
