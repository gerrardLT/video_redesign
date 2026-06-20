/**
 * 用户资产库 - 属性测试 (Property-Based Tests)
 *
 * 使用 fast-check v4.8.0 对核心服务层逻辑进行属性测试。
 * 每个属性测试运行最少 100 次迭代，验证服务逻辑在随机输入下的正确性。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ========================
// Mock setup
// ========================

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    character: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  extractKeyFromUrl: vi.fn((url: string) => url),
  isOSSConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

import { prisma } from '@/lib/db'
import { ingestCharacterImage } from '@/lib/asset-ingestion-service'
import { listAssets, deleteAsset } from '@/lib/asset-library-service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ========================
// 通用 Arbitrary 生成器
// ========================

/** 非空字符串（模拟 ID、名称等） */
const nonEmptyStr = fc.string({ minLength: 1, maxLength: 50 })

/** URL 生成器 */
const urlArb = fc.string({ minLength: 1, maxLength: 30 }).map(
  (s) => `https://oss.example.com/${s}`
)

/** 分类枚举 */
const categoryArb = fc.constantFrom('CHARACTER' as const, 'MATERIAL' as const, 'AUDIO' as const)

// ========================
// Property 1: 自动入库创建完整记录
// Feature: user-asset-library, Property 1: 自动入库创建完整记录
// Validates: Requirements 1.1, 1.2
// ========================

describe('Property 1: 自动入库创建完整记录', () => {
  it('对任意有效输入，首次入库应创建包含正确字段的 Asset 记录', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        urlArb,
        async (userId, projectId, characterId, characterName, imageUrl) => {
          vi.clearAllMocks()

          // 模拟无已有记录
          vi.mocked(prisma.asset.findFirst).mockResolvedValue(null)

          // 模拟 create 回传数据
          vi.mocked(prisma.asset.create as any).mockImplementation(async (args: any) => ({
            id: 'generated-id',
            ...args.data,
            createdAt: new Date(),
          }))

          await ingestCharacterImage({
            userId,
            projectId,
            characterId,
            characterName,
            imageUrl,
          })

          // 验证 create 被调用一次
          expect(prisma.asset.create).toHaveBeenCalledTimes(1)

          const createCall = vi.mocked(prisma.asset.create).mock.calls[0][0] as any
          const data = createCall.data

          // 验证核心字段
          expect(data.userId).toBe(userId)
          expect(data.projectId).toBe(projectId)
          expect(data.category).toBe('CHARACTER')
          expect(data.displayName).toBe(characterName)
          expect(data.url).toBe(imageUrl)
          expect(data.status).toBe('UPLOADED')
          expect(data.type).toBe('CHARACTER_IMAGE')
          expect(data.isCharImage).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 2: 再生成 Upsert 语义
// Feature: user-asset-library, Property 2: 再生成的 Upsert 语义
// Validates: Requirements 1.3
// ========================

describe('Property 2: 再生成 Upsert 语义', () => {
  it('对已有记录的角色，再生成应调用 update 而非 create', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        urlArb,
        urlArb,
        async (userId, projectId, characterId, characterName, oldUrl, newUrl) => {
          vi.clearAllMocks()

          const existingAsset = {
            id: 'existing-asset-id',
            userId,
            projectId,
            type: 'CHARACTER_IMAGE',
            category: 'CHARACTER',
            displayName: characterName,
            url: oldUrl,
            thumbUrl: null,
            fileName: `char:${characterId}`,
            isCharImage: true,
            status: 'UPLOADED',
            sortOrder: 0,
            fileSize: null,
            rejectReason: null,
            expiresAt: null,
            createdAt: new Date(),
          }

          // 模拟已有记录
          vi.mocked(prisma.asset.findFirst).mockResolvedValue(existingAsset as any)

          // 模拟 update 回传
          vi.mocked(prisma.asset.update as any).mockImplementation(async (args: any) => ({
            ...existingAsset,
            ...args.data,
          }))

          await ingestCharacterImage({
            userId,
            projectId,
            characterId,
            characterName,
            imageUrl: newUrl,
          })

          // 核心断言：应调用 update，不调用 create
          expect(prisma.asset.update).toHaveBeenCalledTimes(1)
          expect(prisma.asset.create).not.toHaveBeenCalled()

          // 验证 update 使用新 URL
          const updateCall = vi.mocked(prisma.asset.update).mock.calls[0][0] as any
          expect(updateCall.data.url).toBe(newUrl)
          expect(updateCall.where.id).toBe('existing-asset-id')
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 4: 搜索与筛选正确性
// Feature: user-asset-library, Property 4: 搜索与筛选正确性
// Validates: Requirements 2.4, 5.1, 5.2, 5.3, 7.5
// ========================

describe('Property 4: 搜索与筛选正确性', () => {
  it('对任意查询条件组合，where 子句应包含所有必要的过滤条件', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        fc.option(categoryArb, { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
        async (userId, category, keyword) => {
          vi.clearAllMocks()

          // 模拟返回数据
          vi.mocked(prisma.asset.count).mockResolvedValue(0)
          vi.mocked(prisma.asset.findMany).mockResolvedValue([])

          await listAssets({
            userId,
            category: category as any,
            keyword,
            page: 1,
            pageSize: 20,
          })

          // 获取传给 count 和 findMany 的 where 子句
          const countCall = vi.mocked(prisma.asset.count).mock.calls[0][0] as any
          const findManyCall = vi.mocked(prisma.asset.findMany).mock.calls[0][0] as any

          const countWhere = countCall.where
          const findManyWhere = findManyCall.where

          // 1) userId 过滤必须存在
          expect(countWhere.userId).toBe(userId)
          expect(findManyWhere.userId).toBe(userId)

          // 2) 如果指定了 category，where 中应包含该 category 值
          if (category) {
            expect(countWhere.category).toBe(category)
            expect(findManyWhere.category).toBe(category)
          } else {
            // 未指定分类时，服务应过滤出有分类的资产（category: { not: null }）
            expect(countWhere.category).toEqual({ not: null })
            expect(findManyWhere.category).toEqual({ not: null })
          }

          // 3) 如果指定了 keyword 且非空，where 中应包含 displayName 模糊匹配
          if (keyword && keyword.trim()) {
            expect(countWhere.displayName).toBeDefined()
            expect(countWhere.displayName.contains).toBe(keyword.trim())
            expect(findManyWhere.displayName).toBeDefined()
            expect(findManyWhere.displayName.contains).toBe(keyword.trim())
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 6: 分页正确性
// Feature: user-asset-library, Property 6: 分页正确性
// Validates: Requirements 4.1, 4.3, 4.4
// ========================

describe('Property 6: 分页正确性', () => {
  it('对任意 total 和 pageSize，totalPages = ceil(total / pageSize) 且分页元数据正确', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 100 }),
        async (userId, total, page, pageSize) => {
          vi.clearAllMocks()

          // 参数规范化（与服务逻辑一致）
          const effectivePageSize = Math.min(100, Math.max(1, pageSize))
          const effectivePage = Math.max(1, page)
          const expectedTotalPages = total === 0 ? 0 : Math.ceil(total / effectivePageSize)

          // 模拟总数
          vi.mocked(prisma.asset.count).mockResolvedValue(total)

          // 模拟当前页数据
          const itemsOnPage = Math.max(
            0,
            Math.min(effectivePageSize, total - (effectivePage - 1) * effectivePageSize)
          )

          const mockItems = Array.from({ length: Math.max(0, itemsOnPage) }, (_, i) => ({
            id: `asset-${i}`,
            displayName: `Asset ${i}`,
            category: 'CHARACTER',
            type: 'CHARACTER_IMAGE',
            url: `https://oss.example.com/${i}.png`,
            thumbUrl: null,
            fileName: null,
            fileSize: null,
            createdAt: new Date(),
            project: null,
          }))

          vi.mocked(prisma.asset.findMany).mockResolvedValue(mockItems as any)

          const result = await listAssets({
            userId,
            page,
            pageSize,
          })

          // 验证分页元数据
          expect(result.totalPages).toBe(expectedTotalPages)
          expect(result.page).toBe(effectivePage)
          expect(result.pageSize).toBe(effectivePageSize)
          expect(result.total).toBe(total)

          // 验证 findMany 的 skip 和 take 参数
          const findManyCall = vi.mocked(prisma.asset.findMany).mock.calls[0][0] as any
          expect(findManyCall.skip).toBe((effectivePage - 1) * effectivePageSize)
          expect(findManyCall.take).toBe(effectivePageSize)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 7: 删除移除记录
// Feature: user-asset-library, Property 7: 删除移除记录
// Validates: Requirements 6.2
// ========================

describe('Property 7: 删除移除记录', () => {
  it('对任意用户拥有的资产，deleteAsset 应调用 prisma.asset.delete', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        nonEmptyStr,
        urlArb,
        async (assetId, userId, assetUrl) => {
          vi.clearAllMocks()

          // 模拟资产存在且属于该用户
          vi.mocked(prisma.asset.findUnique).mockResolvedValue({
            id: assetId,
            userId,
            url: assetUrl,
            projectId: null,
            type: 'CHARACTER_IMAGE',
            category: 'CHARACTER',
            displayName: '测试资产',
            thumbUrl: null,
            fileName: null,
            fileSize: null,
            isCharImage: true,
            sortOrder: 0,
            status: 'UPLOADED',
            rejectReason: null,
            expiresAt: null,
            createdAt: new Date(),
          } as any)

          // 模拟无角色引用
          vi.mocked(prisma.character.findFirst).mockResolvedValue(null)

          // 模拟 delete 成功
          vi.mocked(prisma.asset.delete).mockResolvedValue({} as any)

          await deleteAsset(assetId, userId)

          // 核心断言：prisma.asset.delete 被调用且 ID 正确
          expect(prisma.asset.delete).toHaveBeenCalledTimes(1)
          expect(prisma.asset.delete).toHaveBeenCalledWith({
            where: { id: assetId },
          })
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ========================
// Property 9: 用户数据隔离
// Feature: user-asset-library, Property 9: 用户数据隔离
// Validates: Requirements 6.4, 7.5
// ========================

describe('Property 9: 用户数据隔离', () => {
  it('对任意两个不同 userId，跨用户删除资产应返回 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        urlArb,
        async (userA, userB, assetId, assetUrl) => {
          // 确保两个用户 ID 不同
          fc.pre(userA !== userB)

          vi.clearAllMocks()

          // 模拟资产属于 userA
          vi.mocked(prisma.asset.findUnique).mockResolvedValue({
            id: assetId,
            userId: userA,
            url: assetUrl,
            projectId: null,
            type: 'CHARACTER_IMAGE',
            category: 'CHARACTER',
            displayName: '测试资产',
            thumbUrl: null,
            fileName: null,
            fileSize: null,
            isCharImage: true,
            sortOrder: 0,
            status: 'UPLOADED',
            rejectReason: null,
            expiresAt: null,
            createdAt: new Date(),
          } as any)

          // userB 尝试删除 userA 的资产，应抛出 403 错误
          const { ApiError } = await import('@/lib/api-error')
          try {
            await deleteAsset(assetId, userB)
            // 如果没有抛异常则失败
            expect.fail('应抛出 403 错误')
          } catch (error: any) {
            expect(error).toBeInstanceOf(ApiError)
            expect(error.statusCode).toBe(403)
          }

          // 验证 delete 未被调用（资产不应被删除）
          expect(prisma.asset.delete).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 10: 分类计数准确性
// Feature: user-asset-library, Property 10: 分类计数准确性
// Validates: Requirements 8.3
// ========================

describe('Property 10: 分类计数准确性', () => {
  it('对任意分类计数组合，getCategoryCounts 应返回精确数值及正确的总计', async () => {
    const { getCategoryCounts } = await import('@/lib/asset-library-service')

    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        async (userId, characterCount, materialCount, audioCount) => {
          vi.clearAllMocks()

          // 模拟 prisma.asset.count 按顺序返回各分类计数
          vi.mocked(prisma.asset.count)
            .mockResolvedValueOnce(characterCount)   // CHARACTER
            .mockResolvedValueOnce(materialCount)    // MATERIAL
            .mockResolvedValueOnce(audioCount)       // AUDIO

          const result = await getCategoryCounts(userId)

          // 验证各分类计数精确匹配
          expect(result.CHARACTER).toBe(characterCount)
          expect(result.MATERIAL).toBe(materialCount)
          expect(result.AUDIO).toBe(audioCount)

          // 验证 total 为三个分类之和
          expect(result.total).toBe(characterCount + materialCount + audioCount)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 3: 分类枚举约束
// Feature: user-asset-library, Property 3: 分类枚举约束
// Validates: Requirements 2.1, 2.2
// ========================

describe('Property 3: 分类枚举约束', () => {
  it('合法分类值（CHARACTER/MATERIAL/AUDIO）应通过 validateCategory 校验并返回自身', async () => {
    const { validateCategory } = await import('@/lib/asset-library-service')

    await fc.assert(
      fc.property(
        fc.constantFrom('CHARACTER', 'MATERIAL', 'AUDIO'),
        (validCategory) => {
          const result = validateCategory(validCategory)
          expect(result).toBe(validCategory)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('非法分类值应被 validateCategory 拒绝（返回 undefined）', async () => {
    const { validateCategory } = await import('@/lib/asset-library-service')

    const validCategories = ['CHARACTER', 'MATERIAL', 'AUDIO']

    await fc.assert(
      fc.property(
        fc.string().filter((s) => !validCategories.includes(s)),
        (invalidCategory) => {
          const result = validateCategory(invalidCategory)
          expect(result).toBeUndefined()
        }
      ),
      { numRuns: 100 }
    )
  })

  it('对任意 ingestCharacterImage 调用，创建的资产 category 始终为 CHARACTER', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        nonEmptyStr,
        urlArb,
        async (userId, projectId, characterId, characterName, imageUrl) => {
          vi.clearAllMocks()

          // 模拟无已有记录（首次入库）
          vi.mocked(prisma.asset.findFirst).mockResolvedValue(null)

          // 模拟 create 回传
          vi.mocked(prisma.asset.create as any).mockImplementation(async (args: any) => ({
            id: 'generated-id',
            ...args.data,
            createdAt: new Date(),
          }))

          await ingestCharacterImage({
            userId,
            projectId,
            characterId,
            characterName,
            imageUrl,
          })

          // 验证创建的 Asset category 始终为 CHARACTER
          const createCall = vi.mocked(prisma.asset.create).mock.calls[0][0] as any
          expect(createCall.data.category).toBe('CHARACTER')
        }
      ),
      { numRuns: 100 }
    )
  })
})
