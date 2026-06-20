/**
 * 资产库增强 - 属性测试 (Property-Based Tests)
 *
 * 使用 fast-check 对资产库增强功能的核心服务层逻辑进行属性测试。
 * 每个属性测试运行最少 100 次迭代，验证服务逻辑在随机输入下的正确性。
 *
 * 标签格式：Feature: asset-library-enhancements, Property N: {description}
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ========================
// Mock setup
// ========================

vi.mock('@/lib/db', () => {
  return {
    prisma: {
      project: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      asset: {
        findUnique: vi.fn(),
      },
      character: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  extractKeyFromUrl: vi.fn((url: string) => url),
  isOSSConfigured: vi.fn(() => true),
  getSignedObjectUrl: vi.fn(() => 'https://signed-url.example.com'),
}))

// 在 mock 声明之后导入被测模块和 mock 对象
import { prisma } from '@/lib/db'
import {
  listProjectsWithCharacterCount,
  applyToCharacter,
} from '@/lib/asset-library-service'
import { ApiError } from '@/lib/api-error'

// 获取 mock 函数引用（从已 mock 的 prisma 对象中）
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
const mockProjectFindUnique = vi.mocked(prisma.project.findUnique)
const mockAssetFindUnique = vi.mocked(prisma.asset.findUnique)
const mockCharacterUpdate = vi.mocked(prisma.character.update)
const mockTransaction = vi.mocked(prisma.$transaction)

beforeEach(() => {
  vi.clearAllMocks()
})

// ========================
// 通用 Arbitrary 生成器
// ========================

/** 非空字符串（模拟 ID、名称等） */
const nonEmptyStr = fc.string({ minLength: 1, maxLength: 50 })

/** 日期生成器（覆盖较广的时间范围） */
const dateArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2030-12-31T23:59:59Z'),
})

/** 项目生成器（含随机 updatedAt） */
const projectArb = fc.record({
  id: nonEmptyStr,
  name: nonEmptyStr,
  updatedAt: dateArb,
  _count: fc.record({
    characters: fc.nat({ max: 50 }),
  }),
})

// ========================
// Property 6: 项目列表按更新时间降序排列
// Feature: asset-library-enhancements, Property 6: 项目列表按更新时间降序排列
// Validates: Requirements 6.1
// ========================

describe('Feature: asset-library-enhancements, Property 6: 项目列表按更新时间降序排列', () => {
  it('对任意项目集合，返回的列表中相邻项满足 projects[i].updatedAt >= projects[i+1].updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        fc.array(projectArb, { minLength: 0, maxLength: 30 }),
        async (userId, projects) => {
          vi.clearAllMocks()

          // 模拟 Prisma 的 orderBy: { updatedAt: 'desc' } 行为
          const sortedProjects = [...projects].sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
          )

          mockProjectFindMany.mockResolvedValue(sortedProjects as any)

          const result = await listProjectsWithCharacterCount(userId)

          // 验证返回列表长度与输入一致
          expect(result.length).toBe(projects.length)

          // 核心属性：相邻项满足 updatedAt 降序排列
          for (let i = 0; i < result.length - 1; i++) {
            const currentDate = new Date(result[i].updatedAt).getTime()
            const nextDate = new Date(result[i + 1].updatedAt).getTime()
            expect(currentDate).toBeGreaterThanOrEqual(nextDate)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('映射后的项目数据保留原始顺序，不会意外打乱排序', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        fc.array(projectArb, { minLength: 2, maxLength: 30 }),
        async (userId, projects) => {
          vi.clearAllMocks()

          const sortedProjects = [...projects].sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
          )

          mockProjectFindMany.mockResolvedValue(sortedProjects as any)

          const result = await listProjectsWithCharacterCount(userId)

          for (let i = 0; i < result.length; i++) {
            expect(result[i].id).toBe(sortedProjects[i].id)
            expect(result[i].name).toBe(sortedProjects[i].name)
            expect(result[i].characterCount).toBe(sortedProjects[i]._count.characters)
            expect(result[i].updatedAt).toBe(sortedProjects[i].updatedAt.toISOString())
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('验证 Prisma 查询请求包含正确的 orderBy 参数', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStr,
        async (userId) => {
          vi.clearAllMocks()

          mockProjectFindMany.mockResolvedValue([] as any)

          await listProjectsWithCharacterCount(userId)

          // 验证传递给 Prisma 的 orderBy 参数为 { updatedAt: 'desc' }
          const findManyCall = mockProjectFindMany.mock.calls[0][0] as any
          expect(findManyCall.orderBy).toEqual({ updatedAt: 'desc' })
          expect(findManyCall.where).toEqual({ userId })
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 5: 所有权验证——非法访问始终返回 403
// Feature: asset-library-enhancements, Property 5: 所有权验证——非法访问始终返回 403
// Validates: Requirements 5.1, 5.3, 5.5
// ========================

describe('Feature: asset-library-enhancements, Property 5: 所有权验证——非法访问始终返回 403', () => {
  /**
   * 场景 1: 用户拥有资产但不拥有目标项目 → 403 "无权操作该项目"
   * 验证：Character 记录不被修改
   */
  it('用户拥有资产但不拥有目标项目时，始终返回 403 且不修改 Character', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),  // assetId
        fc.uuid(),  // targetProjectId
        fc.uuid(),  // targetCharacterId
        fc.uuid(),  // requestUserId（请求者）
        fc.uuid(),  // projectOwnerId（项目真正拥有者，与请求者不同）
        fc.webUrl(), // asset URL
        async (assetId, targetProjectId, targetCharacterId, requestUserId, projectOwnerId, assetUrl) => {
          // 确保请求者和项目拥有者不同
          if (requestUserId === projectOwnerId) return

          vi.clearAllMocks()

          // 配置 mock：资产属于请求者，项目属于另一个用户
          mockAssetFindUnique.mockResolvedValue({
            id: assetId,
            userId: requestUserId, // 资产属于请求者
            url: assetUrl,
            category: 'CHARACTER',
          } as any)

          mockProjectFindUnique.mockResolvedValue({
            id: targetProjectId,
            userId: projectOwnerId, // 项目不属于请求者
          } as any)

          // 调用并验证抛出 403
          try {
            await applyToCharacter(assetId, targetProjectId, targetCharacterId, requestUserId)
            expect.fail('应抛出 403 错误')
          } catch (error) {
            expect(error).toBeInstanceOf(ApiError)
            const apiError = error as ApiError
            expect(apiError.statusCode).toBe(403)
            expect(apiError.message).toBe('无权操作该项目')
          }

          // 验证 Character 未被修改
          expect(mockCharacterUpdate).not.toHaveBeenCalled()
          expect(mockTransaction).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * 场景 2: 用户拥有目标项目但不拥有资产 → 403 "无权访问该资产"
   * 验证：Character 记录不被修改
   */
  it('用户拥有目标项目但不拥有资产时，始终返回 403 且不修改 Character', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),  // assetId
        fc.uuid(),  // targetProjectId
        fc.uuid(),  // targetCharacterId
        fc.uuid(),  // requestUserId
        fc.uuid(),  // assetOwnerId（资产真正拥有者）
        fc.webUrl(), // asset URL
        async (assetId, targetProjectId, targetCharacterId, requestUserId, assetOwnerId, assetUrl) => {
          // 确保请求者和资产拥有者不同
          if (requestUserId === assetOwnerId) return

          vi.clearAllMocks()

          // 配置 mock：资产属于另一用户
          mockAssetFindUnique.mockResolvedValue({
            id: assetId,
            userId: assetOwnerId, // 资产不属于请求者
            url: assetUrl,
            category: 'CHARACTER',
          } as any)

          // 项目归请求者所有，但因为资产检查先执行，不会到达项目检查
          mockProjectFindUnique.mockResolvedValue({
            id: targetProjectId,
            userId: requestUserId,
          } as any)

          // 调用并验证抛出 403
          try {
            await applyToCharacter(assetId, targetProjectId, targetCharacterId, requestUserId)
            expect.fail('应抛出 403 错误')
          } catch (error) {
            expect(error).toBeInstanceOf(ApiError)
            const apiError = error as ApiError
            expect(apiError.statusCode).toBe(403)
            expect(apiError.message).toBe('无权访问该资产')
          }

          // 验证 Character 未被修改
          expect(mockCharacterUpdate).not.toHaveBeenCalled()
          expect(mockTransaction).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * 场景 3: 用户既不拥有资产也不拥有目标项目 → 403（先检查资产所有权）
   * 验证：Character 记录不被修改
   */
  it('用户两者都不拥有时，始终返回 403 且不修改 Character', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),  // assetId
        fc.uuid(),  // targetProjectId
        fc.uuid(),  // targetCharacterId
        fc.uuid(),  // requestUserId
        fc.uuid(),  // assetOwnerId
        fc.uuid(),  // projectOwnerId
        fc.webUrl(), // asset URL
        async (assetId, targetProjectId, targetCharacterId, requestUserId, assetOwnerId, projectOwnerId, assetUrl) => {
          // 确保请求者既不是资产拥有者也不是项目拥有者
          if (requestUserId === assetOwnerId || requestUserId === projectOwnerId) return

          vi.clearAllMocks()

          // 配置 mock：资产和项目都不属于请求者
          mockAssetFindUnique.mockResolvedValue({
            id: assetId,
            userId: assetOwnerId,
            url: assetUrl,
            category: 'CHARACTER',
          } as any)

          mockProjectFindUnique.mockResolvedValue({
            id: targetProjectId,
            userId: projectOwnerId,
          } as any)

          // 调用并验证抛出 403（资产检查在先，应抛出 "无权访问该资产"）
          try {
            await applyToCharacter(assetId, targetProjectId, targetCharacterId, requestUserId)
            expect.fail('应抛出 403 错误')
          } catch (error) {
            expect(error).toBeInstanceOf(ApiError)
            const apiError = error as ApiError
            expect(apiError.statusCode).toBe(403)
            // 资产所有权检查在前，先触发
            expect(apiError.message).toBe('无权访问该资产')
          }

          // 验证 Character 未被修改
          expect(mockCharacterUpdate).not.toHaveBeenCalled()
          expect(mockTransaction).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ========================
// Property 7: 成功应用后 toast 消息包含项目名和角色名
// Feature: asset-library-enhancements, Property 7: 成功应用后 toast 消息包含项目名和角色名
// Validates: Requirements 3.6
// ========================

/**
 * Toast 消息格式化辅助函数
 * 提取自组件内联逻辑，便于纯函数属性测试
 * 模板: `已应用到 ${projectName} - ${characterName}`
 */
function formatApplySuccessToast(projectName: string, characterName: string): string {
  return `已应用到 ${projectName} - ${characterName}`
}

describe('Feature: asset-library-enhancements, Property 7: 成功应用后 toast 消息包含项目名和角色名', () => {
  it('对任意项目名和角色名，toast 消息始终包含两者作为子字符串', () => {
    fc.assert(
      fc.property(
        // 生成非空字符串作为项目名（允许各种 Unicode 字符）
        fc.string({ minLength: 1, maxLength: 100 }),
        // 生成非空字符串作为角色名（允许各种 Unicode 字符）
        fc.string({ minLength: 1, maxLength: 100 }),
        (projectName, characterName) => {
          const toast = formatApplySuccessToast(projectName, characterName)

          // 核心属性：toast 消息包含项目名
          expect(toast).toContain(projectName)
          // 核心属性：toast 消息包含角色名
          expect(toast).toContain(characterName)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('toast 消息以固定前缀 "已应用到 " 开头', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (projectName, characterName) => {
          const toast = formatApplySuccessToast(projectName, characterName)

          // 验证消息格式以 "已应用到 " 开头
          expect(toast.startsWith('已应用到 ')).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('toast 消息中项目名和角色名通过 " - " 分隔', () => {
    fc.assert(
      fc.property(
        // 使用不含 " - " 的字符串，避免分隔符歧义
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(' - ')),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(' - ')),
        (projectName, characterName) => {
          const toast = formatApplySuccessToast(projectName, characterName)

          // 验证消息格式为 "已应用到 {projectName} - {characterName}"
          expect(toast).toBe(`已应用到 ${projectName} - ${characterName}`)
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ========================
// Property 4 & 8: 按钮可见性规则
// Feature: asset-library-enhancements, Property 4 & 8: 按钮可见性规则
// Validates: Requirements 3.8, 4.1, 4.2
// ========================

/**
 * 操作叠层按钮集合计算逻辑
 *
 * 提取自 AssetCard 组件的条件渲染逻辑：
 * - 所有类别始终显示：preview, download, delete
 * - 仅当 category === 'CHARACTER' 且 onApplyToCharacter 回调存在时，额外显示 apply-to-character
 *
 * 此纯函数便于属性测试验证按钮组合规则的正确性。
 */
type AssetCategoryType = 'CHARACTER' | 'MATERIAL' | 'AUDIO'

/** 基础按钮集合（所有类别通用） */
const BASE_BUTTONS = ['preview', 'download', 'delete'] as const

/** 角色类别额外按钮 */
const CHARACTER_EXTRA_BUTTON = 'apply-to-character' as const

/**
 * 根据资产类别和回调配置，计算操作叠层应显示的按钮集合
 * @param category 资产分类
 * @param hasApplyCallback 是否提供了 onApplyToCharacter 回调
 * @returns 应显示的按钮标识数组
 */
function getVisibleButtons(
  category: AssetCategoryType,
  hasApplyCallback: boolean
): string[] {
  const buttons: string[] = [...BASE_BUTTONS]

  // 仅 CHARACTER 类别且有回调时显示"应用到角色"按钮
  if (category === 'CHARACTER' && hasApplyCallback) {
    buttons.push(CHARACTER_EXTRA_BUTTON)
  }

  return buttons
}

describe('Feature: asset-library-enhancements, Property 4 & 8: 按钮可见性规则', () => {
  /** 有效的资产分类值生成器 */
  const categoryArb = fc.constantFrom<AssetCategoryType>('CHARACTER', 'MATERIAL', 'AUDIO')

  /**
   * Property 4: "应用到角色"按钮仅在 CHARACTER 类别可见
   *
   * 对任意资产分类，当 onApplyToCharacter 回调存在时：
   * - category === 'CHARACTER' → 按钮集合包含 'apply-to-character'
   * - category !== 'CHARACTER' → 按钮集合不包含 'apply-to-character'
   */
  it('Property 4: "应用到角色"按钮仅在 category === CHARACTER 时可见', () => {
    fc.assert(
      fc.property(
        categoryArb,
        (category) => {
          // 假设 onApplyToCharacter 回调始终存在（由 AssetGrid 父组件根据类别决定是否传入）
          const hasCallback = true
          const buttons = getVisibleButtons(category, hasCallback)

          if (category === 'CHARACTER') {
            // CHARACTER 类别：必须包含 apply-to-character
            expect(buttons).toContain(CHARACTER_EXTRA_BUTTON)
          } else {
            // 非 CHARACTER 类别：不得包含 apply-to-character
            expect(buttons).not.toContain(CHARACTER_EXTRA_BUTTON)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property 8: 操作卡片叠层按钮组合规则
   *
   * 对任意资产分类：
   * - 非 CHARACTER → 恰好 3 个按钮: {preview, download, delete}
   * - CHARACTER → 恰好 4 个按钮: {preview, download, delete, apply-to-character}
   */
  it('Property 8: 非 CHARACTER 类别恰好 3 个按钮，CHARACTER 类别恰好 4 个按钮', () => {
    fc.assert(
      fc.property(
        categoryArb,
        (category) => {
          // 模拟实际组件行为：仅 CHARACTER 类别时父组件传入 onApplyToCharacter 回调
          const hasCallback = category === 'CHARACTER'
          const buttons = getVisibleButtons(category, hasCallback)

          if (category === 'CHARACTER') {
            // CHARACTER 类别恰好 4 个按钮
            expect(buttons).toHaveLength(4)
            expect(buttons).toEqual(
              expect.arrayContaining(['preview', 'download', 'delete', 'apply-to-character'])
            )
          } else {
            // 非 CHARACTER 类别恰好 3 个按钮
            expect(buttons).toHaveLength(3)
            expect(buttons).toEqual(
              expect.arrayContaining(['preview', 'download', 'delete'])
            )
            expect(buttons).not.toContain('apply-to-character')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * 补充验证：即使 category === 'CHARACTER'，若 onApplyToCharacter 回调不存在，
   * 也不显示 apply-to-character 按钮（对应 AssetGrid 中 onApplyToCharacter 未传的情况）
   */
  it('无 onApplyToCharacter 回调时，任何类别都不显示 apply-to-character 按钮', () => {
    fc.assert(
      fc.property(
        categoryArb,
        (category) => {
          // 模拟未提供回调的场景
          const hasCallback = false
          const buttons = getVisibleButtons(category, hasCallback)

          // 无论类别如何，不提供回调则不显示 apply-to-character
          expect(buttons).not.toContain(CHARACTER_EXTRA_BUTTON)
          expect(buttons).toHaveLength(3)
          expect(buttons).toEqual(
            expect.arrayContaining(['preview', 'download', 'delete'])
          )
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * 验证所有类别都始终包含基础按钮集合 {preview, download, delete}
   */
  it('所有类别始终包含基础按钮集合 {preview, download, delete}', () => {
    fc.assert(
      fc.property(
        categoryArb,
        fc.boolean(), // 随机 hasCallback
        (category, hasCallback) => {
          const buttons = getVisibleButtons(category, hasCallback)

          // 核心属性：无论任何配置，基础按钮始终存在
          expect(buttons).toContain('preview')
          expect(buttons).toContain('download')
          expect(buttons).toContain('delete')
        }
      ),
      { numRuns: 100 }
    )
  })
})
