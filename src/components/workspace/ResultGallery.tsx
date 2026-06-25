'use client'

/**
 * 结果画廊组件
 *
 * 网格布局展示视频缩略图，支持「发现」和「我的作品」Tab。
 * 分页加载（每页 12 个），滚动到底部自动加载下一页。
 * 新作品生成完成自动插入列表顶部。
 */

import { useState, useEffect, useCallback } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { cn } from '@/lib/utils'
import type { GalleryItem, GalleryTab } from '@/types/workspace'

export function ResultGallery() {
  const generateStatus = useWorkspaceStore((s) => s.generateStatus)
  const [tab, setTab] = useState<GalleryTab>('discover')
  const [items, setItems] = useState<GalleryItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null)

  // 加载画廊数据
  const loadGallery = useCallback(async (pageNum: number, reset = false) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspace/gallery?tab=${tab}&page=${pageNum}&pageSize=12`)
      if (!res.ok) throw new Error('加载失败')

      const data = await res.json()
      if (reset) {
        setItems(data.items)
      } else {
        // 追加时去重（防止分页重复）
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id))
          const newItems = data.items.filter((i: GalleryItem) => !existingIds.has(i.id))
          return [...prev, ...newItems]
        })
      }
      setHasMore(data.hasMore)
    } catch {
      // 加载失败不阻塞
    } finally {
      setLoading(false)
    }
  }, [tab])

  // Tab 切换时重置
  useEffect(() => {
    setPage(1)
    setItems([])
    loadGallery(1, true)
  }, [tab, loadGallery])

  // 生成完成后刷新画廊
  useEffect(() => {
    if (generateStatus === 'completed') {
      setPage(1)
      loadGallery(1, true)
    }
  }, [generateStatus, loadGallery])

  // 无限滚动（observer 持久化，通过 ref callback 管理）
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loading) {
            setPage((prev) => {
              const next = prev + 1
              loadGallery(next)
              return next
            })
          }
        },
        { threshold: 0.1 }
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [hasMore, loading, loadGallery]
  )

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 pb-12">
      {/* Tab 切换 */}
      <div className="flex items-center gap-3 mb-4">
        <TabButton active={tab === 'discover'} onClick={() => setTab('discover')}>
          发现
        </TabButton>
        <TabButton active={tab === 'my'} onClick={() => setTab('my')}>
          我的作品
        </TabButton>
      </div>

      {/* 网格布局 */}
      {items.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              onClick={() => setPreviewItem(item)}
              className="rounded-xl overflow-hidden border border-[var(--cine-line-2)] bg-[var(--cine-surface)] hover:border-[var(--cine-line)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
            >
              <div className="aspect-video bg-gradient-to-br from-[var(--cine-surface)] to-[var(--cine-line-2)] overflow-hidden">
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={item.prompt.substring(0, 20)}
                    loading="lazy"
                    width={320}
                    height={180}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl group-hover:scale-[1.03] transition-transform">
                    🎬
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-[11px] text-[var(--cine-text-2)] truncate">{item.prompt.substring(0, 40)}</div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--cine-text-3)]">
                  <span>{item.model === 'seedance' ? 'Seedance' : 'HappyHorse'}</span>
                  <span>·</span>
                  <span>{item.duration}s</span>
                  <span>·</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !loading ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🎬</div>
          <div className="text-sm text-[var(--cine-text-3)] mb-4">
            {tab === 'my' ? '还没有作品，试试输入描述开始创作吧' : '暂无公开作品'}
          </div>
          {tab === 'my' && (
            <button
              onClick={() => document.querySelector('textarea')?.focus()}
              className="px-4 py-2 rounded-lg bg-[var(--cine-gold)] text-[var(--cine-bg)] text-xs font-medium hover:brightness-110 transition-all"
            >
              ✨ 开始创作
            </button>
          )}
        </div>
      ) : null}

      {/* 加载更多触发点 */}
      <div ref={loadMoreRef} className="h-4" />

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="rounded-xl overflow-hidden border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
              <div className="aspect-video bg-[var(--cine-line-2)] animate-pulse" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-3 w-3/4 bg-[var(--cine-line-2)] rounded animate-pulse" />
                <div className="h-2.5 w-1/2 bg-[var(--cine-line-2)] rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 视频预览弹窗 */}
      {previewItem && (
        <VideoPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </section>
  )
}

/** 视频预览弹窗：ESC 关闭 + 右上角 X 按钮 */
function VideoPreviewModal({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden bg-[var(--cine-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
          aria-label="关闭预览"
        >
          ✕
        </button>

        <video
          src={item.videoUrl}
          controls
          autoPlay
          preload="metadata"
          className="w-full aspect-video"
        />
        <div className="p-4">
          <div className="text-sm text-[var(--cine-text)]">{item.prompt}</div>
          <div className="text-xs text-[var(--cine-text-3)] mt-1">
            {item.model === 'seedance' ? 'Seedance 2.0' : 'HappyHorse'}
            {' · '}{item.duration}s
            {' · '}{item.aspectRatio}
            {' · '}{new Date(item.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-1.5 rounded-full text-sm transition-all',
        active
          ? 'bg-[var(--cine-text)] text-[var(--cine-bg)] font-medium'
          : 'text-[var(--cine-text-3)] hover:text-[var(--cine-text-2)]'
      )}
    >
      {children}
    </button>
  )
}
