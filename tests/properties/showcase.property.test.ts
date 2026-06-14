import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: product-competitiveness
 * Property 2: 案例列表信息完整性
 * Property 3: 分页正确性
 * Property 4: 分类筛选正确性
 *
 * **Validates: Requirements 2.3, 2.5, 2.6**
 */

// ========================
// 类型定义
// ========================

interface CaseItem {
  id: string
  title: string
  category: string
  coverUrl: string
  description: string
  originalVideoUrl: string
  generatedVideoUrl: string
  sortOrder: number
  isPublished: boolean
  createdAt: Date
}

interface ListResult {
  items: CaseItem[]
  total: number
  page: number
  pageSize: number
}

interface ListParams {
  page?: number
  pageSize?: number
  category?: string
  publishedOnly?: boolean
}

// ========================
// 纯函数模拟（来自 showcase-service.ts 逻辑）
// ========================

const SHOWCASE_CATEGORIES = [
  '口播IP',
  '说车试驾',
  '短剧网红',
  '高端探店',
  '体育解说',
  '装修探房',
  '农村生活',
  '美食探店',
] as const

/**
 * 模拟 showcase service list 逻辑
 */
function simulateList(allItems: CaseItem[], params: ListParams = {}): ListResult {
  const { page = 1, pageSize = 12, category, publishedOnly = true } = params

  let filtered = [...allItems]

  if (publishedOnly) {
    filtered = filtered.filter((item) => item.isPublished)
  }

  if (category) {
    filtered = filtered.filter((item) => item.category === category)
  }

  // 排序：sortOrder asc, createdAt desc
  filtered.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  const total = filtered.length
  const start = (page - 1) * pageSize
  const items = filtered.slice(start, start + pageSize)

  return { items, total, page, pageSize }
}

// ========================
// 生成器
// ========================

const categoryArb = fc.constantFrom(...SHOWCASE_CATEGORIES)

const caseItemArb: fc.Arbitrary<CaseItem> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  category: categoryArb,
  coverUrl: fc.stringMatching(/^https:\/\/oss\.example\.com\/cover\/[a-z0-9]{8}\.jpg$/),
  description: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  originalVideoUrl: fc.stringMatching(/^https:\/\/oss\.example\.com\/original\/[a-z0-9]{8}\.mp4$/),
  generatedVideoUrl: fc.stringMatching(/^https:\/\/oss\.example\.com\/generated\/[a-z0-9]{8}\.mp4$/),
  sortOrder: fc.integer({ min: 0, max: 100 }),
  isPublished: fc.boolean(),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
})

// ========================
// Property 2: 案例列表信息完整性
// ========================

describe('案例列表信息完整性 Property (Property 2)', () => {
  it('返回的每个案例卡片包含 title、category、coverUrl、description 四个非空字段', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        (items) => {
          const result = simulateList(items)

          for (const item of result.items) {
            expect(item.title).toBeDefined()
            expect(item.title.length).toBeGreaterThan(0)
            expect(item.category).toBeDefined()
            expect(item.category.length).toBeGreaterThan(0)
            expect(item.coverUrl).toBeDefined()
            expect(item.coverUrl.length).toBeGreaterThan(0)
            expect(item.description).toBeDefined()
            expect(item.description.length).toBeGreaterThan(0)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('返回的字段值与原始数据一致', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        (items) => {
          const result = simulateList(items)

          for (const resultItem of result.items) {
            const original = items.find((i) => i.id === resultItem.id)
            expect(original).toBeDefined()
            if (original) {
              expect(resultItem.title).toBe(original.title)
              expect(resultItem.category).toBe(original.category)
              expect(resultItem.coverUrl).toBe(original.coverUrl)
              expect(resultItem.description).toBe(original.description)
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('category 值来自预定义的 8 种分类之一', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        (items) => {
          const result = simulateList(items)

          for (const item of result.items) {
            expect(SHOWCASE_CATEGORIES).toContain(item.category)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 3: 分页正确性
// ========================

describe('分页正确性 Property (Property 3)', () => {
  it('返回条目数 = min(pageSize, total - (page-1)*pageSize)', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 0,
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 5 }),  // page
        fc.integer({ min: 1, max: 10 }), // pageSize
        (items, page, pageSize) => {
          const result = simulateList(items, { page, pageSize })

          const expectedCount = Math.max(
            0,
            Math.min(pageSize, result.total - (page - 1) * pageSize)
          )
          expect(result.items.length).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('total 等于符合筛选条件的总条目数', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        (items, page, pageSize) => {
          const result = simulateList(items, { page, pageSize, publishedOnly: true })

          const publishedCount = items.filter((i) => i.isPublished).length
          expect(result.total).toBe(publishedCount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不同页的结果集不重叠', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 5,
          maxLength: 30,
        }),
        fc.integer({ min: 2, max: 5 }), // pageSize
        (items, pageSize) => {
          const page1 = simulateList(items, { page: 1, pageSize })
          const page2 = simulateList(items, { page: 2, pageSize })

          const ids1 = new Set(page1.items.map((i) => i.id))
          const ids2 = new Set(page2.items.map((i) => i.id))

          // 两页没有重叠
          for (const id of ids2) {
            expect(ids1.has(id)).toBe(false)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('所有页合并后等于全部数据', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 2, max: 5 }), // pageSize
        (items, pageSize) => {
          const allIds = new Set<string>()
          const totalPages = Math.ceil(items.length / pageSize)

          for (let page = 1; page <= totalPages; page++) {
            const result = simulateList(items, { page, pageSize })
            for (const item of result.items) {
              allIds.add(item.id)
            }
          }

          expect(allIds.size).toBe(items.length)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('items.length 不超过 pageSize', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        (items, page, pageSize) => {
          const result = simulateList(items, { page, pageSize })

          expect(result.items.length).toBeLessThanOrEqual(pageSize)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 4: 分类筛选正确性
// ========================

describe('分类筛选正确性 Property (Property 4)', () => {
  it('筛选后所有案例的 category 等于所选分类', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 30,
        }),
        categoryArb,
        (items, category) => {
          const result = simulateList(items, { category, pageSize: 100 })

          for (const item of result.items) {
            expect(item.category).toBe(category)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不遗漏属于该分类的任何已发布案例', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 1,
          maxLength: 30,
        }),
        categoryArb,
        (items, category) => {
          const result = simulateList(items, { category, pageSize: 100 })

          const expectedCount = items.filter(
            (i) => i.isPublished && i.category === category
          ).length

          expect(result.total).toBe(expectedCount)
          expect(result.items.length).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不同分类筛选结果互不包含', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb.map((item) => ({ ...item, isPublished: true })), {
          minLength: 5,
          maxLength: 30,
        }),
        categoryArb,
        categoryArb,
        (items, cat1, cat2) => {
          fc.pre(cat1 !== cat2)

          const result1 = simulateList(items, { category: cat1, pageSize: 100 })
          const result2 = simulateList(items, { category: cat2, pageSize: 100 })

          const ids1 = new Set(result1.items.map((i) => i.id))
          const ids2 = new Set(result2.items.map((i) => i.id))

          for (const id of ids2) {
            expect(ids1.has(id)).toBe(false)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('无分类筛选时返回所有已发布案例', () => {
    fc.assert(
      fc.property(
        fc.array(caseItemArb, { minLength: 1, maxLength: 20 }),
        (items) => {
          const result = simulateList(items, { pageSize: 100 })
          const expectedCount = items.filter((i) => i.isPublished).length

          expect(result.total).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })
})
