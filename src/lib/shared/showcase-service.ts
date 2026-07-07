/**
 * 案例展示服务
 * 提供案例列表（支持分类筛选 + 分页）、详情查询、CRUD 操作
 */
import { prisma } from './db'
import { ApiError } from './api-error'

// ========================
// 接口定义
// ========================

interface ListParams {
  page?: number
  pageSize?: number
  category?: string
  publishedOnly?: boolean
}

interface ListResult {
  items: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
}

interface CreateParams {
  title: string
  description: string
  category: string
  coverUrl: string
  originalVideoUrl: string
  generatedVideoUrl: string
  isPublished?: boolean
  sortOrder?: number
}

interface UpdateParams {
  title?: string
  description?: string
  category?: string
  coverUrl?: string
  originalVideoUrl?: string
  generatedVideoUrl?: string
  isPublished?: boolean
  sortOrder?: number
}

// ========================
// 案例展示服务
// ========================

export const showcaseService = {
  /**
   * 获取案例列表（支持分类筛选 + 分页）
   * 默认只返回已发布的案例，按 sortOrder 升序 + createdAt 降序排列
   */
  async list(params: ListParams = {}): Promise<ListResult> {
    const { page = 1, pageSize = 12, category, publishedOnly = true } = params

    const where: Record<string, unknown> = {}
    if (publishedOnly) where.isPublished = true
    if (category) where.category = category

    const [items, total] = await Promise.all([
      prisma.caseItem.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.caseItem.count({ where }),
    ])

    return { items, total, page, pageSize }
  },

  /**
   * 获取案例详情
   */
  async getById(id: string) {
    if (!id) {
      throw new ApiError('VALIDATION_ERROR', '案例ID不能为空')
    }

    const item = await prisma.caseItem.findUnique({ where: { id } })

    if (!item) {
      throw new ApiError('NOT_FOUND', '案例不存在', 404)
    }

    return item
  },

  /**
   * 创建案例（管理员）
   */
  async create(data: CreateParams) {
    return prisma.caseItem.create({ data })
  },

  /**
   * 更新案例（管理员）
   */
  async update(id: string, data: UpdateParams) {
    if (!id) {
      throw new ApiError('VALIDATION_ERROR', '案例ID不能为空')
    }

    const existing = await prisma.caseItem.findUnique({ where: { id } })
    if (!existing) {
      throw new ApiError('NOT_FOUND', '案例不存在', 404)
    }

    return prisma.caseItem.update({ where: { id }, data })
  },

  /**
   * 删除案例（管理员）
   */
  async delete(id: string) {
    if (!id) {
      throw new ApiError('VALIDATION_ERROR', '案例ID不能为空')
    }

    const existing = await prisma.caseItem.findUnique({ where: { id } })
    if (!existing) {
      throw new ApiError('NOT_FOUND', '案例不存在', 404)
    }

    return prisma.caseItem.delete({ where: { id } })
  },
}
