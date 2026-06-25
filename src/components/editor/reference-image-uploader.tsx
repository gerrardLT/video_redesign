'use client'

/**
 * ReferenceImageUploader — 参考图拖拽上传组件
 *
 * 功能：
 * - 支持 Drag & Drop 拖拽上传和点击上传两种方式
 * - dragenter/dragover 时展示高亮边框反馈
 * - 文件校验：类型 JPEG/PNG/WEBP、大小 ≤ 20MB
 * - 上传中展示进度，成功后显示缩略图网格
 * - 鼠标悬停缩略图时展示 320px 宽放大预览浮层
 * - 点击 X 移除图片
 */

import { useState, useCallback, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validateReferenceImage } from '@/lib/placeholder-utils'
import { toast } from 'sonner'
import type { ReferenceImage } from '@/stores/happyhorse-store'

interface ReferenceImageUploaderProps {
  /** 当前图片列表 */
  images: ReferenceImage[]
  /** 最大数量（默认 5） */
  maxCount?: number
  /** 图片列表变化回调 */
  onImagesChange: (images: ReferenceImage[]) => void
  /** 上传单张图片回调（返回上传后的 URL） */
  onUpload: (file: File) => Promise<{ url: string; thumbnailUrl?: string }>
  /** 移除图片回调 */
  onRemove: (id: string) => void
  /** 是否禁用 */
  disabled?: boolean
}

export function ReferenceImageUploader({
  images,
  maxCount = 5,
  onImagesChange,
  onUpload,
  onRemove,
  disabled = false,
}: ReferenceImageUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  /** 处理文件列表（拖拽或选择） */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)

      for (const file of fileArray) {
        if (images.length >= maxCount) {
          toast.error(`最多上传 ${maxCount} 张参考图`)
          break
        }

        // 校验文件
        const validation = validateReferenceImage({ type: file.type, size: file.size })
        if (!validation.valid) {
          toast.error(validation.reason || '文件校验失败')
          continue
        }

        // 生成临时 ID 和预览
        const tempId = crypto.randomUUID()
        const previewUrl = URL.createObjectURL(file)

        // 添加上传中的占位
        const uploadingImage: ReferenceImage = {
          id: tempId,
          file,
          url: previewUrl,
          status: 'uploading',
        }
        onImagesChange([...images, uploadingImage])

        // 执行上传
        try {
          const result = await onUpload(file)
          // 更新为成功状态
          const updatedImages = images.map((img) =>
            img.id === tempId
              ? { ...img, url: result.url, thumbnailUrl: result.thumbnailUrl, status: 'success' as const }
              : img
          )
          onImagesChange([...updatedImages, {
            id: tempId,
            url: result.url,
            thumbnailUrl: result.thumbnailUrl,
            status: 'success',
          }])
        } catch {
          toast.error(`参考图上传失败: ${file.name}`)
          // 标记为失败状态
          onImagesChange(images.filter((img) => img.id !== tempId))
          URL.revokeObjectURL(previewUrl)
        }
      }
    },
    [images, maxCount, onImagesChange, onUpload]
  )

  // Drag & Drop 事件处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      dragCounterRef.current = 0

      if (disabled) return

      const files = e.dataTransfer.files
      if (files.length > 0) {
        processFiles(files)
      }
    },
    [disabled, processFiles]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        processFiles(files)
      }
      // 重置 input
      e.target.value = ''
    },
    [processFiles]
  )

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-300 block">
        参考图（可选，最多 {maxCount} 张）
      </label>

      {/* 拖拽上传区域 */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-lg border-2 border-dashed p-3 transition-all',
          isDragOver
            ? 'border-green-500 bg-green-500/5'
            : 'border-zinc-700 hover:border-zinc-600',
          disabled && 'opacity-50 pointer-events-none'
        )}
      >
        {/* 已上传缩略图网格 */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((img, index) => (
              <div
                key={img.id}
                className="relative group"
                onMouseEnter={() => setHoveredImageId(img.id)}
                onMouseLeave={() => setHoveredImageId(null)}
              >
                {/* 缩略图 */}
                <div className="w-16 h-16 rounded-md overflow-hidden border border-zinc-700">
                  <img
                    src={img.thumbnailUrl || img.url}
                    alt={`参考图 ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {/* 上传中覆层 */}
                  {img.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* 移除按钮 */}
                <button
                  onClick={() => onRemove(img.id)}
                  className="absolute -top-1 -right-1 p-0.5 bg-zinc-800 border border-zinc-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`移除参考图 ${index + 1}`}
                >
                  <X className="w-3 h-3 text-zinc-400" />
                </button>

                {/* 序号标识 */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-zinc-300 py-0.5">
                  图{index + 1}
                </div>

                {/* 悬浮放大预览浮层 */}
                {hoveredImageId === img.id && img.status === 'success' && (
                  <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none">
                    <div className="w-80 rounded-lg overflow-hidden border border-zinc-600 shadow-xl bg-zinc-900">
                      <img
                        src={img.url}
                        alt={`参考图 ${index + 1} 预览`}
                        className="w-full h-auto"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 上传入口 */}
        {images.length < maxCount && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex items-center justify-center gap-2 w-full py-2 text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>{isDragOver ? '释放以上传' : '拖拽或点击上传参考图'}</span>
          </button>
        )}

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />
      </div>

      <p className="text-xs text-zinc-600">
        支持 JPEG/PNG/WEBP，单张 ≤20MB。上传后自动在 Prompt 中插入 [Image N] 引用。
      </p>
    </div>
  )
}
