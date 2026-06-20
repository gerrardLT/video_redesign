'use client'

import { useState, useCallback } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

/** 角色资产数据结构（来自 /api/asset-library/characters） */
interface CharacterAssetItem {
  id: string
  displayName: string
  category: 'CHARACTER'
  type: string
  url: string
  thumbUrl: string | null
  projectName: string | null
  fileSize: number | null
  createdAt: string
}

interface ProjectCharacterPickerProps {
  /** 当前角色图 URL（已选择的） */
  currentImageUrl?: string | null
  /** 选择回调：传回选中资产的 URL */
  onSelect: (imageUrl: string) => void
  /** 触发按钮文案 */
  triggerLabel?: string
}

/**
 * 项目角色图选择器
 * 从用户资产库中选择 CHARACTER 类型资产，将其 OSS URL 赋值给 Character.imageUrl。
 * 使用 Dialog 弹窗展示可用角色图列表，支持加载状态和空状态。
 */
export function ProjectCharacterPicker({
  currentImageUrl,
  onSelect,
  triggerLabel = '从资产库选择',
}: ProjectCharacterPickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CharacterAssetItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 打开弹窗时获取角色资产列表 */
  const fetchCharacters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/asset-library/characters')
      if (!res.ok) {
        throw new Error('获取角色图列表失败')
      }
      const data = await res.json()
      setItems(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取角色图列表失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  /** Dialog 打开/关闭回调 */
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      fetchCharacters()
    }
  }

  /** 选择某个角色图资产 */
  const handleSelect = (item: CharacterAssetItem) => {
    onSelect(item.url)
    setOpen(false)
  }

  /** 格式化日期为 yyyy-MM-dd */
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger
        render={
          <Button variant="outline" size="sm" type="button">
            {triggerLabel}
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            {/* 标题区域 */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--cine-gold-dim)]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-[var(--cine-gold)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-white">
                  选择角色图
                </Dialog.Title>
                <Dialog.Description className="text-sm text-[var(--cine-text-2)]">
                  从资产库中选择已有角色图作为人物参考
                </Dialog.Description>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="max-h-[60vh] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <svg
                    className="h-6 w-6 animate-spin text-[var(--cine-gold)]"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
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
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span className="ml-2 text-sm text-[var(--cine-text-2)]">加载中...</span>
                </div>
              )}

              {error && !loading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <p className="text-sm text-red-400">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={fetchCharacters}
                  >
                    重试
                  </Button>
                </div>
              )}

              {!loading && !error && items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12 text-[var(--cine-text-3)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  <p className="mt-3 text-sm text-[var(--cine-text-3)]">
                    暂无可用角色图
                  </p>
                </div>
              )}

              {!loading && !error && items.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {items.map((item) => {
                    const isSelected = currentImageUrl === item.url
                    const thumbnailUrl = item.thumbUrl ?? item.url

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className={`group relative flex flex-col overflow-hidden rounded-lg border transition-all hover:border-[var(--cine-gold)]/60 hover:shadow-md ${
                          isSelected
                            ? 'border-[var(--cine-gold)] ring-2 ring-[var(--cine-gold)]/30'
                            : 'border-[var(--cine-line-2)]'
                        }`}
                      >
                        {/* 缩略图 */}
                        <div className="relative aspect-square w-full overflow-hidden bg-[var(--cine-surface)]">
                          <img
                            src={thumbnailUrl}
                            alt={item.displayName}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                          {/* 已选中标记 */}
                          {isSelected && (
                            <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cine-gold)]">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-3 w-3 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* 信息区域 */}
                        <div className="px-2 py-2">
                          <p className="truncate text-xs font-medium text-white">
                            {item.displayName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--cine-text-3)]">
                            {formatDate(item.createdAt)}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 底部关闭按钮 */}
            <div className="mt-5 flex justify-end">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
              >
                关闭
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
