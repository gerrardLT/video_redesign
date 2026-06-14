'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SearchResult {
  id: string
  title: string
  slug: string
  section: string
}

export function HelpSearchClient() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const performSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      setResults([])
      setShowResults(false)
      return
    }

    setIsSearching(true)
    try {
      const res = await fetch(`/api/help-articles/search?q=${encodeURIComponent(keyword)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.articles || [])
        setShowResults(true)
      }
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)

    // Debounce: 300ms
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      performSearch(value)
    }, 300)
  }

  // 点击外部关闭搜索结果
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 清理 debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const sectionLabel = (section: string) => {
    switch (section) {
      case 'quickstart':
        return '快速入门'
      case 'guide':
        return '操作说明'
      case 'faq':
        return 'FAQ'
      default:
        return section
    }
  }

  return (
    <div ref={containerRef} className="relative mx-auto mt-8 max-w-lg">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--cine-text-3)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (results.length > 0) setShowResults(true)
          }}
          placeholder="搜索帮助文章..."
          className="w-full rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-bg)] py-3 pl-12 pr-4 text-sm text-white placeholder-[var(--cine-text-3)] outline-none transition-colors focus:border-[var(--cine-gold)] focus:ring-1 focus:ring-[var(--cine-gold)]"
          aria-label="搜索帮助文章"
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-xl">
          {results.length > 0 ? (
            <ul className="py-2">
              {results.map((article) => (
                <li key={article.id}>
                  <a
                    href={`/help/${article.slug}`}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--cine-surface)]"
                  >
                    <span className="text-sm text-[var(--cine-text)]">{article.title}</span>
                    <span className="ml-2 shrink-0 rounded-md bg-[var(--cine-gold-dim)] px-2 py-0.5 text-xs text-[var(--cine-gold)]">
                      {sectionLabel(article.section)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-[var(--cine-text-3)]">
              未找到相关文章
            </div>
          )}
        </div>
      )}
    </div>
  )
}
