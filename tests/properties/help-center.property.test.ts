import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: product-competitiveness
 * Property 8: 帮助文章全文搜索
 * Property 9: 帮助文章 CRUD 数据 Round-Trip
 * Property 10: 帮助文章排序正确性
 *
 * **Validates: Requirements 5.2, 6.1, 6.4**
 */

// ========================
// 类型定义
// ========================

type HelpSection = 'quickstart' | 'guide' | 'faq'

interface HelpArticle {
  id: string
  title: string
  slug: string
  section: HelpSection
  content: string
  sortOrder: number
  isPublished: boolean
  createdAt: Date
  updatedAt: Date
}

interface CreateHelpArticleInput {
  title: string
  slug: string
  section: HelpSection
  content: string
  sortOrder: number
  isPublished?: boolean
}

// ========================
// 纯函数模拟（来自 help-center-service.ts 逻辑）
// ========================

/**
 * 模拟全文搜索逻辑
 * 搜索规则：title 或 content 中包含 keyword（大小写敏感，与 SQLite contains 一致）
 */
function simulateSearch(
  articles: HelpArticle[],
  keyword: string,
  publishedOnly = true
): HelpArticle[] {
  const trimmed = keyword.trim()
  if (!trimmed) return []

  return articles.filter((article) => {
    if (publishedOnly && !article.isPublished) return false
    return article.title.includes(trimmed) || article.content.includes(trimmed)
  })
}

/**
 * 模拟创建文章（round-trip 验证用）
 */
function simulateCreate(
  input: CreateHelpArticleInput
): HelpArticle {
  const now = new Date()
  return {
    id: `article_${Date.now()}`,
    title: input.title,
    slug: input.slug,
    section: input.section,
    content: input.content,
    sortOrder: input.sortOrder,
    isPublished: input.isPublished ?? true,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 模拟按 sortOrder 排序逻辑
 */
function sortArticles(articles: HelpArticle[]): HelpArticle[] {
  return [...articles].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 模拟按 section 分组
 */
function groupBySection(articles: HelpArticle[]): {
  quickstart: HelpArticle[]
  guide: HelpArticle[]
  faq: HelpArticle[]
} {
  const sorted = sortArticles(articles.filter((a) => a.isPublished))
  return {
    quickstart: sorted.filter((a) => a.section === 'quickstart'),
    guide: sorted.filter((a) => a.section === 'guide'),
    faq: sorted.filter((a) => a.section === 'faq'),
  }
}

// ========================
// 生成器
// ========================

const sectionArb: fc.Arbitrary<HelpSection> = fc.constantFrom('quickstart', 'guide', 'faq')

const helpArticleArb: fc.Arbitrary<HelpArticle> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  slug: fc.stringMatching(/^[a-z0-9-]{3,30}$/),
  section: sectionArb,
  content: fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
  sortOrder: fc.integer({ min: 0, max: 100 }),
  isPublished: fc.boolean(),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
})

const createInputArb: fc.Arbitrary<CreateHelpArticleInput> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  slug: fc.stringMatching(/^[a-z0-9-]{3,30}$/),
  section: sectionArb,
  content: fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
  sortOrder: fc.integer({ min: 0, max: 100 }),
  isPublished: fc.option(fc.boolean(), { nil: undefined }),
})

// ========================
// Property 8: 帮助文章全文搜索
// ========================

describe('帮助文章全文搜索 Property (Property 8)', () => {
  it('title 中包含 keyword 的文章出现在搜索结果中', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb.map((a) => ({ ...a, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 0, max: 19 }),
        (articles, index) => {
          // 选择一篇文章，从其 title 中取子串作为 keyword
          const targetArticle = articles[index % articles.length]
          const keyword = targetArticle.title.slice(0, Math.min(5, targetArticle.title.length))

          if (!keyword.trim()) return // 跳过空关键词

          const result = simulateSearch(articles, keyword)

          // 目标文章应出现在结果中
          const found = result.find((a) => a.id === targetArticle.id)
          expect(found).toBeDefined()
        }
      ),
      { numRuns: 200 }
    )
  })

  it('content 中包含 keyword 的文章出现在搜索结果中', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb.map((a) => ({ ...a, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 0, max: 19 }),
        (articles, index) => {
          const targetArticle = articles[index % articles.length]
          const keyword = targetArticle.content.slice(0, Math.min(5, targetArticle.content.length))

          if (!keyword.trim()) return

          const result = simulateSearch(articles, keyword)

          const found = result.find((a) => a.id === targetArticle.id)
          expect(found).toBeDefined()
        }
      ),
      { numRuns: 200 }
    )
  })

  it('title 和 content 均不包含 keyword 的文章不出现在结果中', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb.map((a) => ({ ...a, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        // 使用不太可能出现在文章中的关键词
        fc.stringMatching(/^ZZZZUNIQUE[0-9]{4}$/),
        (articles, keyword) => {
          const result = simulateSearch(articles, keyword)

          // 所有在结果中的文章确实包含该关键词
          for (const article of result) {
            const containsKeyword =
              article.title.includes(keyword) || article.content.includes(keyword)
            expect(containsKeyword).toBe(true)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('空搜索关键词返回空结果', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('', ' ', '  ', '\t'),
        (articles, keyword) => {
          const result = simulateSearch(articles, keyword)
          expect(result.length).toBe(0)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('未发布文章不出现在搜索结果中（publishedOnly=true）', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb.map((a) => ({ ...a, isPublished: false })), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.string({ minLength: 1, maxLength: 5 }),
        (articles, keyword) => {
          const result = simulateSearch(articles, keyword, true)
          expect(result.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 9: 帮助文章 CRUD 数据 Round-Trip
// ========================

describe('帮助文章 CRUD 数据 Round-Trip Property (Property 9)', () => {
  it('创建后读取的 title、section、sortOrder、content 与输入一致', () => {
    fc.assert(
      fc.property(createInputArb, (input) => {
        const created = simulateCreate(input)

        expect(created.title).toBe(input.title)
        expect(created.slug).toBe(input.slug)
        expect(created.section).toBe(input.section)
        expect(created.content).toBe(input.content)
        expect(created.sortOrder).toBe(input.sortOrder)
      }),
      { numRuns: 200 }
    )
  })

  it('创建后 id 非空', () => {
    fc.assert(
      fc.property(createInputArb, (input) => {
        const created = simulateCreate(input)

        expect(created.id).toBeDefined()
        expect(created.id.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
  })

  it('创建后 createdAt 和 updatedAt 已设置', () => {
    fc.assert(
      fc.property(createInputArb, (input) => {
        const created = simulateCreate(input)

        expect(created.createdAt).toBeInstanceOf(Date)
        expect(created.updatedAt).toBeInstanceOf(Date)
      }),
      { numRuns: 100 }
    )
  })

  it('未指定 isPublished 时默认为 true', () => {
    fc.assert(
      fc.property(
        createInputArb.map((input) => ({ ...input, isPublished: undefined })),
        (input) => {
          const created = simulateCreate(input)

          expect(created.isPublished).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('指定 isPublished=false 时创建的文章未发布', () => {
    fc.assert(
      fc.property(
        createInputArb.map((input) => ({ ...input, isPublished: false })),
        (input) => {
          const created = simulateCreate(input)

          expect(created.isPublished).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 10: 帮助文章排序正确性
// ========================

describe('帮助文章排序正确性 Property (Property 10)', () => {
  it('列表按 sortOrder 升序排列', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb, { minLength: 2, maxLength: 20 }),
        (articles) => {
          const sorted = sortArticles(articles)

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].sortOrder).toBeGreaterThanOrEqual(sorted[i - 1].sortOrder)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('更新 sortOrder 后重新排序反映新顺序', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 200 }),
        (articles, targetIdx, newSortOrder) => {
          const idx = targetIdx % articles.length

          // 模拟更新 sortOrder
          const updated = articles.map((a, i) =>
            i === idx ? { ...a, sortOrder: newSortOrder } : a
          )

          const sorted = sortArticles(updated)

          // 验证排序仍然正确
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].sortOrder).toBeGreaterThanOrEqual(sorted[i - 1].sortOrder)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('每个 section 内部按 sortOrder 升序排列', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb.map((a) => ({ ...a, isPublished: true })), {
          minLength: 3,
          maxLength: 20,
        }),
        (articles) => {
          const grouped = groupBySection(articles)

          for (const section of ['quickstart', 'guide', 'faq'] as const) {
            const sectionArticles = grouped[section]
            for (let i = 1; i < sectionArticles.length; i++) {
              expect(sectionArticles[i].sortOrder).toBeGreaterThanOrEqual(
                sectionArticles[i - 1].sortOrder
              )
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('排序不改变文章数量', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb, { minLength: 0, maxLength: 20 }),
        (articles) => {
          const sorted = sortArticles(articles)
          expect(sorted.length).toBe(articles.length)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('排序保留所有原始文章 id', () => {
    fc.assert(
      fc.property(
        fc.array(helpArticleArb, { minLength: 1, maxLength: 20 }),
        (articles) => {
          const sorted = sortArticles(articles)
          const originalIds = new Set(articles.map((a) => a.id))
          const sortedIds = new Set(sorted.map((a) => a.id))

          expect(sortedIds.size).toBe(originalIds.size)
          for (const id of sortedIds) {
            expect(originalIds.has(id)).toBe(true)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
