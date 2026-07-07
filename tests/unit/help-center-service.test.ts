import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Feature: product-competitiveness
 * 帮助中心服务单元测试
 *
 * 测试 CRUD 操作、搜索功能、排序逻辑
 * **Validates: Requirements 5.2, 6.1, 6.3, 6.4**
 */

// ========================
// Mock Prisma
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    helpArticle: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

const { prisma } = await import('@/lib/shared/db')
const {
  listBySection,
  search,
  getBySlug,
  create,
  update,
  deleteArticle,
  updateSortOrder,
} = await import('@/lib/shared/help-center-service')

// ========================
// 测试数据
// ========================

const mockArticles = [
  {
    id: 'art-1',
    title: '快速入门指南',
    slug: 'quick-start-guide',
    section: 'quickstart',
    content: '# 欢迎使用\n\n本指南帮助你快速上手视频重塑工具...',
    sortOrder: 1,
    isPublished: true,
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
  },
  {
    id: 'art-2',
    title: '如何上传视频',
    slug: 'how-to-upload',
    section: 'guide',
    content: '## 上传视频\n\n支持 MP4、MOV 格式，大小不超过 500MB...',
    sortOrder: 1,
    isPublished: true,
    createdAt: new Date('2024-06-02'),
    updatedAt: new Date('2024-06-02'),
  },
  {
    id: 'art-3',
    title: '常见问题',
    slug: 'faq',
    section: 'faq',
    content: '## FAQ\n\nQ: 积分不够怎么办？\nA: 前往套餐页面充值...',
    sortOrder: 1,
    isPublished: true,
    createdAt: new Date('2024-06-03'),
    updatedAt: new Date('2024-06-03'),
  },
  {
    id: 'art-4',
    title: '未发布的草稿',
    slug: 'draft-article',
    section: 'guide',
    content: '这是一篇未发布的文章...',
    sortOrder: 99,
    isPublished: false,
    createdAt: new Date('2024-06-04'),
    updatedAt: new Date('2024-06-04'),
  },
]

// ========================
// 测试
// ========================

describe('帮助中心服务单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listBySection', () => {
    it('按板块分组返回文章', async () => {
      vi.mocked(prisma.helpArticle.findMany).mockResolvedValue(
        mockArticles.filter((a) => a.isPublished) as never
      )

      const result = await listBySection(true)

      expect(result.quickstart).toHaveLength(1)
      expect(result.guide).toHaveLength(1)
      expect(result.faq).toHaveLength(1)
    })

    it('publishedOnly=true 时不返回未发布文章', async () => {
      vi.mocked(prisma.helpArticle.findMany).mockResolvedValue(
        mockArticles.filter((a) => a.isPublished) as never
      )

      const result = await listBySection(true)

      const allArticles = [
        ...result.quickstart,
        ...result.guide,
        ...result.faq,
      ]
      for (const article of allArticles) {
        expect(article.isPublished).toBe(true)
      }
    })

    it('publishedOnly=false 时返回所有文章', async () => {
      vi.mocked(prisma.helpArticle.findMany).mockResolvedValue(mockArticles as never)

      const result = await listBySection(false)

      const allArticles = [
        ...result.quickstart,
        ...result.guide,
        ...result.faq,
      ]
      expect(allArticles.length).toBe(4)
    })
  })

  describe('search', () => {
    it('搜索 title 中的关键词返回匹配文章', async () => {
      vi.mocked(prisma.helpArticle.findMany).mockResolvedValue(
        [mockArticles[0]] as never // '快速入门指南'
      )

      const result = await search('快速入门')

      expect(result).toHaveLength(1)
    })

    it('搜索 content 中的关键词返回匹配文章', async () => {
      vi.mocked(prisma.helpArticle.findMany).mockResolvedValue(
        [mockArticles[2]] as never // content 包含 '积分'
      )

      const result = await search('积分')

      expect(result).toHaveLength(1)
    })

    it('空关键词返回空数组', async () => {
      const result = await search('')

      expect(result).toHaveLength(0)
      // 不应调用数据库
      expect(prisma.helpArticle.findMany).not.toHaveBeenCalled()
    })

    it('纯空格关键词返回空数组', async () => {
      const result = await search('   ')

      expect(result).toHaveLength(0)
      expect(prisma.helpArticle.findMany).not.toHaveBeenCalled()
    })
  })

  describe('getBySlug', () => {
    it('存在的 slug 返回对应文章', async () => {
      vi.mocked(prisma.helpArticle.findUnique).mockResolvedValue(mockArticles[0] as never)

      const result = await getBySlug('quick-start-guide')

      expect(result).not.toBeNull()
      expect(result!.slug).toBe('quick-start-guide')
      expect(result!.title).toBe('快速入门指南')
    })

    it('不存在的 slug 返回 null', async () => {
      vi.mocked(prisma.helpArticle.findUnique).mockResolvedValue(null)

      const result = await getBySlug('non-existent-slug')

      expect(result).toBeNull()
    })
  })

  describe('create', () => {
    it('创建文章并返回完整数据', async () => {
      const input = {
        title: '新文章',
        slug: 'new-article',
        section: 'guide' as const,
        content: '这是新文章的内容',
        sortOrder: 5,
      }
      const mockCreated = {
        id: 'art-new',
        ...input,
        isPublished: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      vi.mocked(prisma.helpArticle.create).mockResolvedValue(mockCreated as never)

      const result = await create(input)

      expect(result.title).toBe('新文章')
      expect(result.slug).toBe('new-article')
      expect(result.section).toBe('guide')
      expect(result.content).toBe('这是新文章的内容')
      expect(result.sortOrder).toBe(5)
    })
  })

  describe('update', () => {
    it('更新文章指定字段', async () => {
      const mockUpdated = {
        ...mockArticles[0],
        title: '更新后的标题',
        updatedAt: new Date(),
      }

      vi.mocked(prisma.helpArticle.update).mockResolvedValue(mockUpdated as never)

      const result = await update('art-1', { title: '更新后的标题' })

      expect(result.title).toBe('更新后的标题')
      expect(prisma.helpArticle.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { title: '更新后的标题' },
      })
    })
  })

  describe('deleteArticle', () => {
    it('删除指定文章', async () => {
      vi.mocked(prisma.helpArticle.delete).mockResolvedValue(mockArticles[0] as never)

      await deleteArticle('art-1')

      expect(prisma.helpArticle.delete).toHaveBeenCalledWith({
        where: { id: 'art-1' },
      })
    })
  })

  describe('updateSortOrder', () => {
    it('更新文章排序权重', async () => {
      const mockUpdated = { ...mockArticles[0], sortOrder: 10 }

      vi.mocked(prisma.helpArticle.update).mockResolvedValue(mockUpdated as never)

      const result = await updateSortOrder('art-1', 10)

      expect(result.sortOrder).toBe(10)
      expect(prisma.helpArticle.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { sortOrder: 10 },
      })
    })
  })
})
