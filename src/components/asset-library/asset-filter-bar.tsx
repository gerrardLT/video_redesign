'use client'

/**
 * 资产库筛选栏组件
 * 提供分类 Tab 切换（全部/角色图/素材/音频）和关键字搜索输入
 * - 每个 Tab 显示对应分类的资产数量
 * - 搜索输入框使用 300ms debounce 延迟触发
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAssetLibraryStore, type AssetCategory } from '@/stores/asset-library-store'

interface AssetFilterBarProps {
  counts: {
    CHARACTER: number
    MATERIAL: number
    AUDIO: number
    total: number
  } | null
}

/** 分类 Tab 配置 */
const CATEGORY_TABS: { label: string; value: AssetCategory | null }[] = [
  { label: '全部', value: null },
  { label: '角色图', value: 'CHARACTER' },
  { label: '素材', value: 'MATERIAL' },
  { label: '音频', value: 'AUDIO' },
]

export function AssetFilterBar({ counts }: AssetFilterBarProps) {
  const { category, keyword, setCategory, setKeyword } = useAssetLibraryStore()

  // 本地输入值，与 store 中的 keyword 通过 debounce 同步
  const [localKeyword, setLocalKeyword] = useState(keyword)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 当 store keyword 被外部重置时同步本地状态
  useEffect(() => {
    setLocalKeyword(keyword)
  }, [keyword])

  // 清理 debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  /** 搜索输入变化，300ms debounce 后更新 store */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setLocalKeyword(value)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        setKeyword(value)
      }, 300)
    },
    [setKeyword]
  )

  /** 获取对应分类的数量显示文本 */
  const getCountText = (tabValue: AssetCategory | null): string => {
    if (!counts) return ''
    if (tabValue === null) return `(${counts.total})`
    const count = counts[tabValue]
    return `(${count})`
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* 分类 Tab 按钮组 */}
      <div className="flex items-center gap-1" role="tablist" aria-label="资产分类筛选">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.label}
            role="tab"
            aria-selected={category === tab.value}
            onClick={() => setCategory(tab.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              category === tab.value
                ? 'bg-[var(--cine-gold)] text-[var(--cine-bg)]'
                : 'text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-[var(--cine-text-1)]'
            )}
          >
            {tab.label}
            {counts && (
              <span className={cn(
                'text-xs',
                category === tab.value
                  ? 'text-[var(--cine-bg)]/80'
                  : 'text-[var(--cine-text-3)]'
              )}>
                {getCountText(tab.value)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 搜索输入框 */}
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--cine-text-3)]" />
        <input
          type="text"
          value={localKeyword}
          onChange={handleSearchChange}
          placeholder="搜索资产名称..."
          aria-label="搜索资产"
          className={cn(
            'w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]',
            'py-1.5 pl-9 pr-3 text-sm text-[var(--cine-text-1)]',
            'placeholder:text-[var(--cine-text-3)]',
            'focus:border-[var(--cine-gold)] focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]/50',
            'transition-colors'
          )}
        />
      </div>
    </div>
  )
}
