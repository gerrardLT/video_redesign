/**
 * 帮助中心服务
 * 提供帮助文章的分组查询、全文搜索、slug 查询和管理员 CRUD 操作
 */
import { prisma } from './db'
import type { HelpSection } from '@/types/enums'

// ========================
// 类型定义
// ========================

export interface GroupedArticles {
  quickstart: HelpArticleRecord[]
  guide: HelpArticleRecord[]
  faq: HelpArticleRecord[]
}

export interface HelpArticleRecord {
  id: string
  title: string
  slug: string
  section: string
  content: string
  sortOrder: number
  isPublished: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateHelpArticleInput {
  title: string
  slug: string
  section: HelpSection
  content: string
  sortOrder?: number
  isPublished?: boolean
}

export interface UpdateHelpArticleInput {
  title?: string
  slug?: string
  section?: HelpSection
  content?: string
  sortOrder?: number
  isPublished?: boolean
}

// ========================
// 公开查询方法
// ========================

/**
 * 按板块分组返回帮助文章
 * 每个板块内按 sortOrder 升序排列
 * @param publishedOnly - 是否只返回已发布文章（默认 true）
 */
export async function listBySection(publishedOnly = true): Promise<GroupedArticles> {
  const where = publishedOnly ? { isPublished: true } : {}

  const articles = await prisma.helpArticle.findMany({
    where,
    orderBy: { sortOrder: 'asc' },
  })

  return {
    quickstart: articles.filter((a) => a.section === 'quickstart'),
    guide: articles.filter((a) => a.section === 'guide'),
    faq: articles.filter((a) => a.section === 'faq'),
  }
}

/**
 * 全文搜索帮助文章（标题 + 正文）
 * 使用 Prisma contains 进行模糊匹配（SQLite 兼容）
 * @param query - 搜索关键词
 * @param publishedOnly - 是否只搜索已发布文章（默认 true）
 */
export async function search(query: string, publishedOnly = true) {
  const trimmed = query.trim()
  if (!trimmed) return []

  const where: Record<string, unknown> = {
    OR: [
      { title: { contains: trimmed } },
      { content: { contains: trimmed } },
    ],
  }

  if (publishedOnly) {
    where.isPublished = true
  }

  return prisma.helpArticle.findMany({
    where,
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * 根据 slug 获取单篇文章
 */
export async function getBySlug(slug: string) {
  return prisma.helpArticle.findUnique({ where: { slug } })
}

// ========================
// 管理员操作方法
// ========================

/**
 * 获取所有文章列表（管理员用）
 * 按 section + sortOrder 排序
 */
export async function list(publishedOnly = false) {
  const where = publishedOnly ? { isPublished: true } : {}

  return prisma.helpArticle.findMany({
    where,
    orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }],
  })
}

/**
 * 创建帮助文章
 */
export async function create(data: CreateHelpArticleInput) {
  return prisma.helpArticle.create({ data })
}

/**
 * 更新帮助文章
 */
export async function update(id: string, data: UpdateHelpArticleInput) {
  return prisma.helpArticle.update({ where: { id }, data })
}

/**
 * 删除帮助文章
 */
export async function deleteArticle(id: string) {
  return prisma.helpArticle.delete({ where: { id } })
}

/**
 * 调整文章排序权重
 */
export async function updateSortOrder(id: string, sortOrder: number) {
  return prisma.helpArticle.update({
    where: { id },
    data: { sortOrder },
  })
}
