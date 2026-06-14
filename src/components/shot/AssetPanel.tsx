'use client'

import { useState, useCallback, useRef } from 'react'

interface Asset {
  id: string
  type: string
  url: string
  thumbUrl: string | null
  fileName: string | null
  isCharImage: boolean
  status: string
  sortOrder: number
  createdAt: string
}

interface AssetPanelProps {
  projectId: string
  shotId?: string
  assets: Asset[]
  onInsertAsset?: (displayNum: number) => void
  onUpdate?: () => void
}

/**
 * 计算素材显示编号
 * 规则：人物图排前面 [图1], [图2]...，然后普通上传图继续编号
 */
function computeDisplayNumbers(assets: Asset[]): Map<string, number> {
  const displayMap = new Map<string, number>()
  let num = 1

  // 先给人物图编号
  for (const asset of assets) {
    if (asset.isCharImage) {
      displayMap.set(asset.id, num++)
    }
  }

  // 再给普通素材编号
  for (const asset of assets) {
    if (!asset.isCharImage) {
      displayMap.set(asset.id, num++)
    }
  }

  return displayMap
}

export default function AssetPanel({
  projectId,
  assets,
  onInsertAsset,
  onUpdate,
}: AssetPanelProps) {
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const displayNumbers = computeDisplayNumbers(assets)

  // 清空全部素材
  const handleClearAll = useCallback(async () => {
    if (!confirm('确定要清空全部素材吗？此操作不可撤销。')) return

    setClearingAll(true)
    try {
      for (const asset of assets) {
        await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })
      }
      onUpdate?.()
    } catch (error) {
      console.error('清空素材失败:', error)
      alert('清空失败，请重试')
    } finally {
      setClearingAll(false)
    }
  }, [assets, onUpdate])

  // 上传文件
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      alert('仅支持 JPG、PNG、WebP 格式')
      return
    }

    // 校验文件大小 (30MB)
    if (file.size > 30 * 1024 * 1024) {
      alert('文件大小不能超过 30MB')
      return
    }

    setUploading(true)
    try {
      // 1. 获取预签名 URL
      const presignRes = await fetch('/api/assets/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        }),
      })

      if (!presignRes.ok) {
        const data = await presignRes.json()
        alert(data.error || '获取上传地址失败')
        return
      }

      const { assetId, uploadUrl } = await presignRes.json()

      // 2. 上传文件（MVP: 使用本地上传 API)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      })

      if (!uploadRes.ok) {
        alert('文件上传失败')
        return
      }

      const uploadData = await uploadRes.json()

      // 3. 确认上传
      await fetch('/api/assets/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          url: uploadData.url || `/uploads/${file.name}`,
        }),
      })

      onUpdate?.()
    } catch (error) {
      console.error('上传素材失败:', error)
      alert('上传失败，请重试')
    } finally {
      setUploading(false)
      // 重置 file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [projectId, onUpdate])

  // 删除素材
  const handleDelete = useCallback(async (assetId: string) => {
    if (!confirm('确定要删除此素材吗？')) return

    setDeleting(assetId)
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onUpdate?.()
      }
    } catch (error) {
      console.error('删除素材失败:', error)
    } finally {
      setDeleting(null)
    }
  }, [onUpdate])

  // 点击素材插入 [图N]
  const handleAssetClick = useCallback((assetId: string) => {
    const displayNum = displayNumbers.get(assetId)
    if (displayNum && onInsertAsset) {
      onInsertAsset(displayNum)
    }
  }, [displayNumbers, onInsertAsset])

  return (
    <div className="rounded-lg border border-[#222] bg-[var(--cine-surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">素材库</h3>
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={clearingAll}
              className="rounded bg-red-500/10 border border-red-500/30 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
            >
              {clearingAll ? '清空中...' : '清空全部'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded bg-[var(--cine-gold-dim)] border border-[var(--cine-gold)]/30 px-2 py-1 text-[11px] text-[var(--cine-gold)] hover:bg-[var(--cine-gold-dim)] disabled:opacity-40 transition-colors"
          >
            {uploading ? '上传中...' : '上传素材'}
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <p className="text-xs text-gray-500">暂无素材，点击上传或生成人物图</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {assets.map((asset) => {
            const displayNum = displayNumbers.get(asset.id)
            return (
              <div
                key={asset.id}
                className="group relative aspect-square rounded border border-[#333] bg-[var(--cine-bg)] overflow-hidden cursor-pointer hover:border-[var(--cine-gold)] transition-colors"
                onClick={() => handleAssetClick(asset.id)}
                title={`点击插入 [图${displayNum}]`}
              >
                {/* 缩略图 */}
                {asset.url && asset.status === 'UPLOADED' ? (
                  <img
                    src={asset.thumbUrl || asset.url}
                    alt={asset.fileName || '素材'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-[10px] text-gray-500">
                      {asset.status === 'PENDING' ? '上传中' : '无图'}
                    </span>
                  </div>
                )}

                {/* 编号标签 */}
                <div className="absolute top-0.5 left-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white font-mono">
                  [图{displayNum}]
                </div>

                {/* 人物图标记 */}
                {asset.isCharImage && (
                  <div className="absolute top-0.5 right-0.5 rounded bg-[var(--cine-gold)]/80 px-1 py-0.5 text-[10px] text-white">
                    人物
                  </div>
                )}

                {/* 删除按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(asset.id)
                  }}
                  disabled={deleting === asset.id}
                  className="absolute bottom-0.5 right-0.5 rounded bg-red-600/80 px-1 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  {deleting === asset.id ? '...' : '删除'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { computeDisplayNumbers }
