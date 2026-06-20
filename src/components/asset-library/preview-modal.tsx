'use client'

/**
 * 资产全屏预览模态框组件
 *
 * 功能：
 * - 全屏模态框展示资产原图（通过 /api/media/{key} 鉴权路径加载）
 * - 顶部工具栏：资产名称、缩放比例显示（百分比）、缩放按钮（+/-/重置）、下载按钮、关闭按钮
 * - 底部信息栏：分类徽章、创建日期、文件大小
 * - CSS transform 实现缩放和平移
 * - 鼠标滚轮缩放（以鼠标位置为缩放中心）
 * - 拖拽平移（仅当图片超出视口时启用）
 * - Escape 键 / 点击遮罩关闭
 * - 图片加载失败显示错误占位 + 重试按钮
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ZoomIn, ZoomOut, RotateCcw, Download, X, ImageOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  clampScale,
  clampPan,
  zoomAtPoint,
  MIN_SCALE,
  MAX_SCALE,
  type ViewTransform,
} from '@/lib/preview-transform'
import type { AssetLibraryItem } from '@/components/asset-library/asset-grid'

// ========================
// 类型定义
// ========================

interface PreviewModalProps {
  asset: AssetLibraryItem | null  // null 时关闭
  onClose: () => void
  onDownload: (assetId: string) => void
}

/** 缩放步进常量 */
const ZOOM_STEP = 0.25
/** 滚轮缩放步进 */
const WHEEL_ZOOM_STEP = 0.1

/** 分类标签映射 */
const CATEGORY_LABELS: Record<string, { label: string; className: string }> = {
  CHARACTER: { label: '角色', className: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  MATERIAL: { label: '素材', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  AUDIO: { label: '音频', className: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
}

// ========================
// 工具函数
// ========================

/** 格式化文件大小为可读字符串 */
function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '未知大小'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/** 格式化日期为 yyyy-MM-dd */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  } catch {
    return dateStr
  }
}

// ========================
// 组件
// ========================

export function PreviewModal({ asset, onClose, onDownload }: PreviewModalProps) {
  // 视图变换状态
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, panX: 0, panY: 0 })
  // 图片加载状态
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  // 图片自然尺寸
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 })
  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  // 视口容器引用
  const viewportRef = useRef<HTMLDivElement>(null)
  // 重试计数器（用于强制重新加载图片）
  const [retryCount, setRetryCount] = useState(0)

  // 每次 asset 切换时重置状态
  useEffect(() => {
    if (asset) {
      setTransform({ scale: 1, panX: 0, panY: 0 })
      setImgLoaded(false)
      setImgError(false)
      setImgSize({ width: 0, height: 0 })
      setRetryCount(0)
    }
  }, [asset?.id])

  // 获取视口尺寸
  const getViewportSize = useCallback(() => {
    if (!viewportRef.current) return { width: 800, height: 600 }
    const rect = viewportRef.current.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }, [])

  // 缩放按钮：放大
  const handleZoomIn = useCallback(() => {
    setTransform((prev) => {
      const newScale = clampScale(prev.scale + ZOOM_STEP)
      const viewport = getViewportSize()
      const pan = clampPan(prev.panX, prev.panY, newScale, imgSize.width, imgSize.height, viewport.width, viewport.height)
      return { scale: newScale, ...pan }
    })
  }, [getViewportSize, imgSize])

  // 缩放按钮：缩小
  const handleZoomOut = useCallback(() => {
    setTransform((prev) => {
      const newScale = clampScale(prev.scale - ZOOM_STEP)
      const viewport = getViewportSize()
      const pan = clampPan(prev.panX, prev.panY, newScale, imgSize.width, imgSize.height, viewport.width, viewport.height)
      return { scale: newScale, ...pan }
    })
  }, [getViewportSize, imgSize])

  // 缩放按钮：重置
  const handleZoomReset = useCallback(() => {
    setTransform({ scale: 1, panX: 0, panY: 0 })
  }, [])

  // 鼠标滚轮缩放（以鼠标位置为缩放中心）
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!viewportRef.current) return

    const rect = viewportRef.current.getBoundingClientRect()
    // 鼠标相对于视口中心的坐标
    const mouseX = e.clientX - rect.left - rect.width / 2
    const mouseY = e.clientY - rect.top - rect.height / 2

    // 滚轮方向：向上放大，向下缩小
    const delta = e.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP

    setTransform((prev) => {
      const result = zoomAtPoint(prev.scale, delta, mouseX, mouseY, prev.panX, prev.panY)
      const viewport = getViewportSize()
      const pan = clampPan(result.panX, result.panY, result.scale, imgSize.width, imgSize.height, viewport.width, viewport.height)
      return { scale: result.scale, ...pan }
    })
  }, [getViewportSize, imgSize])

  // 拖拽平移：mousedown
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 仅左键触发
    if (e.button !== 0) return
    // 检查图片是否超出视口（超出时才允许拖拽）
    const viewport = getViewportSize()
    const scaledWidth = transform.scale * imgSize.width
    const scaledHeight = transform.scale * imgSize.height
    if (scaledWidth <= viewport.width && scaledHeight <= viewport.height) return

    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: transform.panX,
      panY: transform.panY,
    }
  }, [transform, getViewportSize, imgSize])

  // 拖拽平移：mousemove
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return
    e.preventDefault()

    const deltaX = e.clientX - dragStartRef.current.x
    const deltaY = e.clientY - dragStartRef.current.y
    const newPanX = dragStartRef.current.panX + deltaX
    const newPanY = dragStartRef.current.panY + deltaY

    const viewport = getViewportSize()
    const pan = clampPan(newPanX, newPanY, transform.scale, imgSize.width, imgSize.height, viewport.width, viewport.height)
    setTransform((prev) => ({ ...prev, ...pan }))
  }, [isDragging, getViewportSize, transform.scale, imgSize])

  // 拖拽平移：mouseup
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // 图片加载成功
  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setImgSize({ width: img.naturalWidth, height: img.naturalHeight })
    setImgLoaded(true)
    setImgError(false)
  }, [])

  // 图片加载失败
  const handleImgError = useCallback(() => {
    setImgError(true)
    setImgLoaded(false)
  }, [])

  // 重试加载
  const handleRetry = useCallback(() => {
    setImgError(false)
    setImgLoaded(false)
    setRetryCount((c) => c + 1)
  }, [])

  // 构造图片 URL（使用原始 URL，API 层已返回可访问的路径）
  const imageUrl = asset ? asset.url : ''
  const imgSrcWithRetry = retryCount > 0 ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}_retry=${retryCount}` : imageUrl

  // 缩放百分比显示
  const scalePercent = Math.round(transform.scale * 100)

  // 判断是否可拖拽（图片超出视口）
  const viewport = getViewportSize()
  const canDrag = (transform.scale * imgSize.width > viewport.width) || (transform.scale * imgSize.height > viewport.height)

  // 分类标签
  const categoryInfo = asset ? CATEGORY_LABELS[asset.category] : null

  return (
    <Dialog.Root open={!!asset} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <Dialog.Portal>
        {/* 遮罩层 */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" />

        {/* 全屏模态框内容 */}
        <Dialog.Popup className="fixed inset-0 z-50 flex flex-col">
          {/* 顶部工具栏 */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-4 backdrop-blur-md">
            {/* 左侧：资产名称 */}
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="truncate text-sm font-medium text-white">
                {asset?.displayName ?? ''}
              </h2>
            </div>

            {/* 中间：缩放控制 */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleZoomOut}
                disabled={transform.scale <= MIN_SCALE}
                className="text-white/70 hover:text-white hover:bg-white/10"
                aria-label="缩小"
              >
                <ZoomOut className="size-4" />
              </Button>

              <span className="min-w-[3.5rem] text-center text-xs font-medium text-white/80">
                {scalePercent}%
              </span>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleZoomIn}
                disabled={transform.scale >= MAX_SCALE}
                className="text-white/70 hover:text-white hover:bg-white/10"
                aria-label="放大"
              >
                <ZoomIn className="size-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleZoomReset}
                className="text-white/70 hover:text-white hover:bg-white/10"
                aria-label="重置缩放"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>

            {/* 右侧：下载 + 关闭 */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => asset && onDownload(asset.id)}
                className="text-white/70 hover:text-white hover:bg-white/10"
                aria-label="下载"
              >
                <Download className="size-4" />
              </Button>

              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-white/70 hover:text-white hover:bg-white/10"
                    aria-label="关闭"
                  />
                }
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
          </div>

          {/* 图片展示区域 */}
          <div
            ref={viewportRef}
            className={`relative flex-1 overflow-hidden ${canDrag ? 'cursor-grab' : 'cursor-default'} ${isDragging ? 'cursor-grabbing' : ''}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* 图片加载失败占位 */}
            {imgError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="flex size-20 items-center justify-center rounded-full bg-white/5">
                  <ImageOff className="size-8 text-white/40" />
                </div>
                <p className="text-sm text-white/60">图片加载失败</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  className="border-white/20 text-white/80 hover:bg-white/10"
                >
                  重试
                </Button>
              </div>
            )}

            {/* 图片（CSS transform 实现缩放和平移） */}
            {!imgError && asset && (
              <div className="flex h-full w-full items-center justify-center">
                <img
                  key={`${asset.id}-${retryCount}`}
                  src={imgSrcWithRetry}
                  alt={asset.displayName}
                  className="max-h-full max-w-full select-none transition-transform duration-75"
                  style={{
                    transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`,
                    transformOrigin: 'center center',
                  }}
                  onLoad={handleImgLoad}
                  onError={handleImgError}
                  draggable={false}
                />
              </div>
            )}
          </div>

          {/* 底部信息栏 */}
          <div className="flex h-10 shrink-0 items-center gap-4 border-t border-white/10 bg-black/60 px-4 backdrop-blur-md">
            {/* 分类徽章 */}
            {categoryInfo && (
              <Badge
                variant="outline"
                className={`text-[11px] ${categoryInfo.className}`}
              >
                {categoryInfo.label}
              </Badge>
            )}

            {/* 创建日期 */}
            {asset && (
              <span className="text-xs text-white/50">
                {formatDate(asset.createdAt)}
              </span>
            )}

            {/* 文件大小 */}
            {asset && (
              <span className="text-xs text-white/50">
                {formatFileSize(asset.fileSize)}
              </span>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
