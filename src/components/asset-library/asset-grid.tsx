'use client'

/**
 * 资产网格组件
 * 以响应式网格布局展示资产卡片，支持操作叠层（预览/下载/删除/应用到角色）、
 * 删除确认、分页、空状态和加载态
 *
 * 操作叠层规则：
 * - 所有类别：预览（Eye）、下载（Download）、删除（Trash2）
 * - CHARACTER 类别额外：应用到角色（UserPlus）
 * - 点击缩略图区域触发预览
 * - 操作进行中对应按钮显示 Loader2 旋转 + disabled
 */

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Trash2, ImageOff, Package, Eye, Download, UserPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssetLibraryStore } from '@/stores/asset-library-store'

/** 资产分类类型 */
type AssetCategory = 'CHARACTER' | 'MATERIAL' | 'AUDIO'

/** 单条资产展示数据 */
export interface AssetLibraryItem {
  id: string
  displayName: string
  category: AssetCategory
  type: string
  url: string
  thumbUrl: string | null
  projectName: string | null
  fileSize: number | null
  createdAt: string
}

/** AssetCard 组件 Props */
export interface AssetCardProps {
  item: AssetLibraryItem
  onPreview: (item: AssetLibraryItem) => void
  onDownload: (assetId: string) => void
  onDelete: (assetId: string) => void
  onApplyToCharacter?: (item: AssetLibraryItem) => void // 仅 CHARACTER 类别
}

interface AssetGridProps {
  items: AssetLibraryItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  isLoading: boolean
  onDelete: (assetId: string) => void
  onPreview?: (item: AssetLibraryItem) => void
  onDownload?: (assetId: string) => void
  onApplyToCharacter?: (item: AssetLibraryItem) => void
}

/** 分类徽章颜色映射 */
const CATEGORY_STYLES: Record<AssetCategory, { label: string; className: string }> = {
  CHARACTER: { label: '角色', className: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  MATERIAL: { label: '素材', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  AUDIO: { label: '音频', className: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
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

export function AssetGrid({
  items,
  total,
  page,
  pageSize,
  totalPages,
  isLoading,
  onDelete,
  onPreview,
  onDownload,
  onApplyToCharacter,
}: AssetGridProps) {
  const setPage = useAssetLibraryStore((s) => s.setPage)
  const [deleteTarget, setDeleteTarget] = useState<AssetLibraryItem | null>(null)

  // 加载态：骨架屏网格
  if (isLoading) {
    return <LoadingSkeleton pageSize={pageSize} />
  }

  // 空状态
  if (items.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 资产网格 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <AssetCard
            key={item.id}
            item={item}
            onPreview={onPreview ?? (() => {})}
            onDownload={onDownload ?? (() => {})}
            onDelete={(assetId) => {
              const target = items.find((i) => i.id === assetId)
              if (target) setDeleteTarget(target)
            }}
            onApplyToCharacter={
              item.category === 'CHARACTER' ? onApplyToCharacter : undefined
            }
          />
        ))}
      </div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      )}

      {/* 删除确认对话框 */}
      <DeleteConfirmDialog
        item={deleteTarget}
        onConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ========================
// 子组件
// ========================

/** 资产卡片 - 带操作叠层 */
function AssetCard({
  item,
  onPreview,
  onDownload,
  onDelete,
  onApplyToCharacter,
}: AssetCardProps) {
  const [imgError, setImgError] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const categoryStyle = CATEGORY_STYLES[item.category]
  const imgSrc = item.thumbUrl || item.url

  /** 处理下载点击（带 loading 状态） */
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloadLoading) return
    setDownloadLoading(true)
    try {
      await onDownload(item.id)
    } finally {
      setDownloadLoading(false)
    }
  }

  /** 处理应用到角色点击（带 loading 状态） */
  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (applyLoading || !onApplyToCharacter) return
    setApplyLoading(true)
    try {
      await onApplyToCharacter(item)
    } finally {
      setApplyLoading(false)
    }
  }

  /** 处理预览点击 */
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPreview(item)
  }

  /** 处理删除点击 */
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(item.id)
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] transition-colors hover:border-[var(--cine-gold)]/30">
      {/* 缩略图区域 - 点击触发预览 */}
      <div
        className="relative aspect-square cursor-pointer overflow-hidden bg-[var(--cine-bg-soft)]"
        onClick={handlePreview}
      >
        {!imgError && imgSrc ? (
          <img
            src={imgSrc}
            alt={item.displayName}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageOff className="size-8 text-[var(--cine-text-3)]" />
          </div>
        )}

        {/* 操作叠层（Hover 时显示） */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
          {/* 预览按钮 */}
          <ActionTooltipButton
            label="预览"
            onClick={handlePreview}
            icon={<Eye className="size-4" />}
          />

          {/* 下载按钮 */}
          <ActionTooltipButton
            label="下载"
            onClick={handleDownload}
            disabled={downloadLoading}
            icon={
              downloadLoading
                ? <Loader2 className="size-4 animate-spin" />
                : <Download className="size-4" />
            }
          />

          {/* 删除按钮 */}
          <ActionTooltipButton
            label="删除"
            onClick={handleDelete}
            icon={<Trash2 className="size-4" />}
            variant="destructive"
          />

          {/* 应用到角色按钮（仅 CHARACTER 类别） */}
          {item.category === 'CHARACTER' && onApplyToCharacter && (
            <ActionTooltipButton
              label="应用到角色"
              onClick={handleApply}
              disabled={applyLoading}
              icon={
                applyLoading
                  ? <Loader2 className="size-4 animate-spin" />
                  : <UserPlus className="size-4" />
              }
            />
          )}
        </div>
      </div>

      {/* 信息区域 */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {/* 名称 */}
        <p className="truncate text-sm font-medium text-[var(--cine-text)]" title={item.displayName}>
          {item.displayName}
        </p>

        {/* 分类徽章 */}
        <span
          className={`inline-flex w-fit items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${categoryStyle.className}`}
        >
          {categoryStyle.label}
        </span>

        {/* 项目名 */}
        {item.projectName && (
          <p className="truncate text-xs text-[var(--cine-text-3)]" title={item.projectName}>
            {item.projectName}
          </p>
        )}

        {/* 创建日期 */}
        <p className="text-xs text-[var(--cine-text-3)]">
          {formatDate(item.createdAt)}
        </p>
      </div>
    </div>
  )
}

// ========================
// 操作按钮 + Tooltip 子组件
// ========================

/** 操作按钮带 Tooltip 提示 */
function ActionTooltipButton({
  label,
  onClick,
  icon,
  disabled = false,
  variant = 'default',
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  icon: React.ReactNode
  disabled?: boolean
  variant?: 'default' | 'destructive'
}) {
  const baseClasses =
    'flex size-8 items-center justify-center rounded-lg backdrop-blur-sm transition-all disabled:cursor-not-allowed disabled:opacity-50'
  const variantClasses =
    variant === 'destructive'
      ? 'bg-black/60 text-[var(--cine-text-2)] hover:bg-[var(--cine-red)]/80 hover:text-white'
      : 'bg-black/60 text-[var(--cine-text-2)] hover:bg-white/20 hover:text-white'

  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <button
              type="button"
              disabled={disabled}
              onClick={onClick}
              className={`${baseClasses} ${variantClasses}`}
              aria-label={label}
            />
          }
        >
          {icon}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={6}>
            <Tooltip.Popup className="rounded-md bg-[var(--cine-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--cine-text)] shadow-lg border border-[var(--cine-line-2)]">
              {label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

/** 删除确认对话框 */
function DeleteConfirmDialog({
  item,
  onConfirm,
  onCancel,
}: {
  item: AssetLibraryItem | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog.Root open={!!item} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            {/* 警告图标 */}
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--cine-red-dim)]">
              <Trash2 className="size-5 text-[var(--cine-red)]" />
            </div>

            {/* 标题 */}
            <Dialog.Title className="text-center text-lg font-semibold text-white">
              确认删除
            </Dialog.Title>

            {/* 描述 */}
            <Dialog.Description className="mt-2 text-center text-sm text-[var(--cine-text-2)]">
              确定要删除「{item?.displayName}」吗？此操作不可撤销。
            </Dialog.Description>

            {/* 操作按钮 */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onCancel}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={onConfirm}
              >
                删除
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** 分页控件 */
function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--cine-line)] pt-4">
      <p className="text-xs text-[var(--cine-text-3)]">
        共 {total} 项
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <span className="min-w-[4rem] text-center text-sm text-[var(--cine-text-2)]">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

/** 空状态 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--cine-bg-soft)]">
        <Package className="size-7 text-[var(--cine-text-3)]" />
      </div>
      <p className="text-sm text-[var(--cine-text-2)]">暂无资产</p>
      <p className="mt-1 text-xs text-[var(--cine-text-3)]">
        生成角色图或上传素材后，资产将显示在这里
      </p>
    </div>
  )
}

/** 加载骨架屏 */
function LoadingSkeleton({ pageSize }: { pageSize: number }) {
  // 最多展示 8 个骨架卡片，避免页面过长
  const count = Math.min(pageSize, 8)
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)]"
        >
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
