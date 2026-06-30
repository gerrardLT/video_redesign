'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'

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
  createdAt: string
  updatedAt: string
}

interface ShowcaseListResponse {
  items: CaseItem[]
  total: number
  page: number
  pageSize: number
}

interface CategoryItem {
  value: string
  label: string
}

// ========================
// 案例展示公开页面
// ========================

const PAGE_SIZE = 12

export default function ShowcasePage() {
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // 获取分类列表
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/showcase/categories')
        if (res.ok) {
          const data = await res.json()
          setCategories(data.categories || [])
        }
      } catch (err) {
        console.error('获取分类失败', err)
      }
    }
    fetchCategories()
  }, [])

  // 获取案例列表
  const fetchCases = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          pageSize: String(PAGE_SIZE),
        })
        if (activeCategory) {
          params.set('category', activeCategory)
        }

        const res = await fetch(`/api/showcase?${params.toString()}`)
        if (res.ok) {
          const data: ShowcaseListResponse = await res.json()
          if (append) {
            setCases((prev) => [...prev, ...data.items])
          } else {
            setCases(data.items)
          }
          setTotal(data.total)
          setPage(data.page)
        }
      } catch (err) {
        console.error('获取案例列表失败', err)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [activeCategory]
  )

  // 分类变化时重新'
  useEffect(() => {
    setCases([])
    setPage(1)
    fetchCases(1, false)
  }, [fetchCases])

  // 分类切换
  const handleCategoryChange = (category: string) => {
    setActiveCategory(category)
  }

  // 加载更多
  const handleLoadMore = () => {
    const nextPage = page + 1
    fetchCases(nextPage, true)
  }

  const hasMore = cases.length < total

  return (
    <div className="min-h-screen bg-[var(--cine-bg)] text-white">
      {/* 页面头部 */}
      <header className="border-b border-[var(--cine-line-2)] bg-[var(--cine-bg-80)] backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight">
            案例展示
          </h1>
          <p className="mt-2 text-sm text-[var(--cine-text-2)]">
            探索 AI 视频重塑的无限可能，查看真实案例效果对比
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 分类筛选栏 */}
        <nav className="mb-8" aria-label="案例分类筛选">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleCategoryChange('')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeCategory === ''
                  ? 'bg-[var(--cine-gold)] text-white'
                  : 'bg-[var(--cine-surface)] text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-white'
              }`}
              aria-pressed={activeCategory === ''}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeCategory === cat.value
                    ? 'bg-[var(--cine-gold)] text-white'
                    : 'bg-[var(--cine-surface)] text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-white'
                }`}
                aria-pressed={activeCategory === cat.value}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </nav>

        {/* 案例卡片网格 */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 text-5xl">🎬</div>
            <p className="text-lg text-[var(--cine-text-2)]">暂无案例，敬请期待</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cases.map((item) => (
              <CaseCard key={item.id} item={item} categories={categories} />
            ))}
          </div>
        )}

        {/* 查看更多案例按钮 */}
        {!loading && hasMore && (
          <div className="mt-10 flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-6 py-3 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? (
                <>
                  <LoadingSpinner />
                  加载中?..
                </>
              ) : (
                '查看更多案例'
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// ========================
// 案例卡片组件
// ========================

function CaseCard({
  item,
  categories,
}: {
  item: CaseItem
  categories: CategoryItem[]
}) {
  const categoryLabel =
    categories.find((c) => c.value === item.category)?.label || item.category

  return (
    <Link
      href={`/showcase/${item.id}`}
      className="group block rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] transition-all hover:border-[var(--cine-gold)]/50 hover:shadow-lg hover:shadow-[var(--cine-gold)]/5"
    >
      {/* 封面图?*/}
      <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-[var(--cine-surface)]">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--cine-text-3)]">
            <svg
              className="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
        )}
      </div>

      {/* 卡片内容 */}
      <div className="p-4">
        {/* 分类标签 */}
        <span className="inline-block rounded-md bg-[var(--cine-gold-dim)] px-2 py-0.5 text-xs font-medium text-[var(--cine-gold)]">
          {categoryLabel}
        </span>

        {/* 标题 */}
        <h3 className="mt-2 text-base font-semibold text-white line-clamp-1 group-hover:text-[var(--cine-gold)] transition-colors">
          {item.title}
        </h3>

        {/* 简单?*/}
        <p className="mt-1 text-sm text-[var(--cine-text-2)] line-clamp-2">
          {item.description}
        </p>
      </div>
    </Link>
  )
}

// ========================
// 加载旋转动画
// ========================

function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
