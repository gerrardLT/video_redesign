'use client'

import { useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 版本卡片组件 Props
 * 用于展示单个生成版本的缩略图、元信息和操作按钮
 */
export interface VersionItemCardProps {
  version: {
    id: string
    versionNumber: number
    videoUrl: string
    coverUrl: string | null
    promptExcerpt: string
    costEstimate: number
    isCurrent: boolean
    createdAt: string // ISO 8601
  }
  /** 对比模式选中状态 */
  isSelected?: boolean
  /** 设为当前版本回调 */
  onSwitch?: (versionId: string) => void
  /** 删除版本回调 */
  onDelete?: (versionId: string) => void
  /** 对比模式选择回调 */
  onSelect?: (versionId: string) => void
}

/**
 * 格式化相对时间
 * 根据时间差返回简短的中文相对时间描述
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 30) return `${diffDay} 天前`

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * 版本卡片组件
 * 展示单个生成版本的缩略图、版本号、prompt 摘要、生成时间、积分消耗
 * 支持当前版本高亮、操作按钮、A/B 对比选中状态
 */
export function VersionItemCard({
  version,
  isSelected = false,
  onSwitch,
  onDelete,
  onSelect,
}: VersionItemCardProps) {
  const handleSwitch = useCallback(() => {
    onSwitch?.(version.id)
  }, [onSwitch, version.id])

  const handleDelete = useCallback(() => {
    onDelete?.(version.id)
  }, [onDelete, version.id])

  const handleSelect = useCallback(() => {
    onSelect?.(version.id)
  }, [onSelect, version.id])

  return (
    <Card
      className={cn(
        'relative cursor-pointer transition-all duration-200',
        'bg-[var(--cine-surface)] ring-[var(--cine-line)]',
        'hover:ring-[var(--cine-line-2)]',
        isSelected && 'ring-2 ring-[var(--cine-gold)] shadow-[0_0_12px_rgba(199,168,119,0.15)]',
        version.isCurrent && !isSelected && 'ring-[var(--cine-gold-dim)]'
      )}
      onClick={handleSelect}
      role="article"
      aria-label={`版本 ${version.versionNumber}${version.isCurrent ? '（当前版本）' : ''}`}
      aria-selected={isSelected}
    >
      <CardContent className="p-3">
        <div className="flex gap-3">
          {/* 缩略图 */}
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-[var(--cine-bg-soft)]">
            {version.coverUrl ? (
              <img
                src={version.coverUrl}
                alt={`版本 ${version.versionNumber} 封面`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg
                  className="h-6 w-6 text-[var(--cine-text-3)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
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

            {/* 版本号徽标（左上角） */}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono text-white">
              v{version.versionNumber}
            </span>
          </div>

          {/* 信息区域 */}
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {/* 版本号 + 当前版本徽标 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-[var(--cine-text)]">
                    版本 {version.versionNumber}
                  </span>
                  {version.isCurrent && (
                    <Badge
                      variant="default"
                      className="bg-[var(--cine-gold)] text-[var(--cine-ink)] text-[10px] h-4 px-1.5"
                    >
                      当前
                    </Badge>
                  )}
                </div>

                {/* Prompt 摘要 */}
                <p className="mt-0.5 truncate text-xs text-[var(--cine-text-2)]">
                  {version.promptExcerpt}
                </p>
              </div>
            </div>

            {/* 底部信息：时间 + 积分 */}
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--cine-text-3)]">
              <span>{formatRelativeTime(version.createdAt)}</span>
              <span className="flex items-center gap-0.5">
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                  />
                </svg>
                {version.costEstimate} 积分
              </span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--cine-line)] pt-2">
          {!version.isCurrent && (
            <Button
              variant="ghost"
              size="xs"
              className="text-[var(--cine-gold)] hover:bg-[var(--cine-gold-dim)] hover:text-[var(--cine-gold)]"
              onClick={(e) => {
                e.stopPropagation()
                handleSwitch()
              }}
              aria-label={`设为当前版本：版本 ${version.versionNumber}`}
            >
              设为当前版本
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'text-[var(--cine-text-3)]',
              version.isCurrent
                ? 'cursor-not-allowed opacity-40'
                : 'hover:bg-[var(--cine-red-dim)] hover:text-[var(--cine-red)]'
            )}
            onClick={(e) => {
              e.stopPropagation()
              if (!version.isCurrent) {
                handleDelete()
              }
            }}
            disabled={version.isCurrent}
            aria-label={
              version.isCurrent
                ? '当前版本不可删除'
                : `删除版本 ${version.versionNumber}`
            }
          >
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
