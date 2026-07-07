'use client'

/**
 * 参考素材上传组件
 *
 * 设计：
 * - 单一上传区域（渐变边框 + 脉动光效），拖拽或点击上传
 * - 已上传素材横向排列，点击弹出预览
 * - 预览弹窗支持 ESC / 点击外部 / X 按钮关闭
 */

import { useCallback, useRef, useState, useEffect } from 'react'
import { X, Music } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { validateFile } from '@/lib/video/workspace-validators'
import { MAX_WORKSPACE_ASSETS, MODEL_DURATION_OPTIONS } from '@/constants/workspace'
import { toast } from 'sonner'
import type { WorkspaceAsset } from '@/types/workspace'

/** 获取视频文件时长（秒）— 客户端通过创建 video 元素读取 */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      reject(new Error('无法读取视频时长'))
    }
    video.src = URL.createObjectURL(file)
  })
}

export function AssetUploader() {
  const assets = useWorkspaceStore((s) => s.assets)
  const addAsset = useWorkspaceStore((s) => s.addAsset)
  const removeAsset = useWorkspaceStore((s) => s.removeAsset)
  const updateAsset = useWorkspaceStore((s) => s.updateAsset)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<WorkspaceAsset | null>(null)

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (assets.length >= MAX_WORKSPACE_ASSETS) {
        toast.error(`最多上传 ${MAX_WORKSPACE_ASSETS} 个参考素材`)
        break
      }
      const validation = validateFile(file.name, file.type, file.size)
      if (!validation.valid) { toast.error(validation.reason); continue }

      // 视频时长校验：不超过当前模型最大允许时长，不低于最小时长
      if (validation.type === 'video') {
        const model = useWorkspaceStore.getState().model
        const durations = MODEL_DURATION_OPTIONS[model]
        const minDuration = durations[0]
        const maxDuration = durations[durations.length - 1]
        try {
          const duration = await getVideoDuration(file)
          if (duration < minDuration) {
            toast.error(`视频 "${file.name}" 时长 ${Math.round(duration)}s 低于 ${model === 'seedance' ? 'Seedance' : 'HappyHorse'} 最小限制 ${minDuration}s`)
            continue
          }
          if (duration > maxDuration) {
            toast.error(`视频 "${file.name}" 时长 ${Math.round(duration)}s 超出 ${model === 'seedance' ? 'Seedance' : 'HappyHorse'} 最大限制 ${maxDuration}s`)
            continue
          }
        } catch { /* 无法检测时长则跳过校验 */ }
      }

      const tempId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const added = addAsset({
        id: tempId, fileName: file.name, fileSize: file.size,
        type: validation.type, mimeType: file.type,
        ossUrl: '', uploadProgress: 0, status: 'uploading',
      })
      if (!added) { toast.error(`已达上限`); break }

      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/workspace/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '上传失败')
        const data = await res.json()
        updateAsset(tempId, { ossUrl: data.url, thumbUrl: data.thumbUrl, uploadProgress: 100, status: 'uploaded' })
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : '上传失败'}`)
        updateAsset(tempId, { status: 'failed', uploadProgress: 0 })
      }
    }
  }, [assets.length, addAsset, updateAsset])

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        {/* 上传按钮 — 虚线方块「+ 参考图」风格 */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleUpload(e.dataTransfer.files) }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          className={`
            relative w-14 h-14 shrink-0 rounded-lg cursor-pointer transition-all duration-200
            flex flex-col items-center justify-center gap-0.5
            border border-dashed border-[var(--cine-line-2)]
            hover:border-[var(--cine-gold)]/60 hover:bg-[var(--cine-gold)]/5
            ${isDragOver ? 'border-[var(--cine-gold)] bg-[var(--cine-gold)]/5 scale-105' : ''}
          `}
        >
          <span className="text-sm text-[var(--cine-text-3)]">+</span>
          <span className="text-[9px] text-[var(--cine-text-3)]">参考图</span>
          {assets.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--cine-gold)] text-[var(--cine-bg)] text-[8px] font-bold flex items-center justify-center shadow-sm">
              {assets.length}
            </span>
          )}
        </div>

        {/* 已上传素材缩略图 — 杂志堆叠，hover 展开 */}
        {assets.length > 0 && (
          <div
            className="relative flex items-center group/stack shrink-0"
            style={{ width: assets.length > 1 ? `${32 + (assets.length - 1) * 14}px` : '36px', height: '36px' }}
          >
            {assets.map((asset, i) => (
              <div
                key={asset.id}
                className="absolute w-9 h-9 rounded-lg overflow-hidden border-2 border-[var(--cine-surface)] shadow-sm cursor-pointer transition-all duration-300 ease-out hover:z-20"
                style={{
                  left: `${i * 14}px`,
                  transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (2 + i)}deg)`,
                  zIndex: i + 1,
                }}
                onClick={() => asset.status === 'uploaded' && setPreviewAsset(asset)}
                onMouseEnter={(e) => {
                  // hover 展开：当前项归正，其他项散开
                  const el = e.currentTarget
                  el.style.transform = 'rotate(0deg) scale(1.15)'
                  el.style.zIndex = '30'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget
                  el.style.transform = `rotate(${(i % 2 === 0 ? -1 : 1) * (2 + i)}deg)`
                  el.style.zIndex = String(i + 1)
                }}
              >
                {asset.thumbUrl ? (
                  <img src={asset.thumbUrl} alt={asset.fileName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] bg-[var(--cine-surface)]">
                    {asset.type === 'audio' ? '🎵' : asset.type === 'video' ? '🎬' : '🖼'}
                  </div>
                )}
                {asset.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  </div>
                )}
                {asset.status === 'failed' && (
                  <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center text-[9px] text-white font-bold">!</div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeAsset(asset.id) }}
                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                >
                  <X className="w-2 h-2" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/aac"
          onChange={(e) => { if (e.target.files?.length) { handleUpload(e.target.files); e.target.value = '' } }}
          className="hidden"
        />
      </div>

      {/* 预览弹窗 */}
      {previewAsset && (
        <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} onRemove={() => { removeAsset(previewAsset.id); setPreviewAsset(null) }} />
      )}
    </>
  )
}

/** 素材预览弹窗 — 支持 ESC / 外部点击 / X 按钮关闭 */
function AssetPreviewModal({ asset, onClose, onRemove }: { asset: WorkspaceAsset; onClose: () => void; onRemove: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-w-lg w-full mx-4 rounded-2xl overflow-hidden bg-[var(--cine-surface)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* X 关闭 */}
        <button onClick={onClose} className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>

        {/* 内容 */}
        <div className="p-4">
          {asset.type === 'image' && asset.ossUrl && (
            <img src={asset.ossUrl} alt={asset.fileName} className="w-full rounded-lg max-h-[60vh] object-contain bg-black/20" />
          )}
          {asset.type === 'video' && asset.ossUrl && (
            <video src={asset.ossUrl} controls autoPlay className="w-full rounded-lg max-h-[60vh]" />
          )}
          {asset.type === 'audio' && asset.ossUrl && (
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[var(--cine-gold)]/10 flex items-center justify-center">
                <Music className="w-8 h-8 text-[var(--cine-gold)]" />
              </div>
              <audio src={asset.ossUrl} controls autoPlay className="w-full" />
            </div>
          )}
        </div>

        {/* 底栏 */}
        <div className="px-4 pb-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm text-[var(--cine-text)] truncate">{asset.fileName}</div>
            <div className="text-[10px] text-[var(--cine-text-3)] mt-0.5">
              {asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : '音频'} · {(asset.fileSize / (1024 * 1024)).toFixed(1)}MB
            </div>
          </div>
          <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 ml-4">
            移除素材
          </button>
        </div>
      </div>
    </div>
  )
}
