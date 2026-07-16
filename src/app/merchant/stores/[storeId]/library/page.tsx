'use client'

/**
 * 门店素材库 — /merchant/stores/[storeId]/library
 *
 * 复刻爆款（HappyHorse V-Edit）的 @素材来源。store 级共享、持久不过期的素材库，
 * 商家可在此上传、分类、预览、删除人物 / 产品 / 其他参考图（及短视频）。
 *
 * 与「镜头拍摄素材」「复刻临时下载源视频」区分：素材库条目 shotTaskId=null 且 expiresAt=null。
 *
 * API：
 * - GET    /api/merchant/stores/{storeId}/assets?type=&category=  列表（带签名 URL）
 * - POST   /api/merchant/stores/{storeId}/assets                  上传（multipart：file + category）
 * - DELETE /api/merchant/stores/{storeId}/assets/{assetId}        删除
 *
 * 视觉：沿用商家端禅意编辑式（zen-reveal + hairline separator + lucide 图标）。
 */

import { useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, ImagePlus, Loader2, Trash2, Film } from 'lucide-react'
import Link from 'next/link'
import { EmptyState, ZenButton } from '@/components/merchant'

// ─── SWR Fetcher ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || '请求失败')
  }
  return res.json()
}

// ─── 类型 ───

interface LibraryAsset {
  id: string
  type: string
  category: string | null
  filename: string
  thumbUrl: string
  url: string
  createdAt: string
}

// ─── 分类常量 ───

const FILTER_CATEGORIES: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'CHARACTER', label: '人物' },
  { key: 'PRODUCT', label: '产品' },
  { key: 'OTHER', label: '其他' },
]

/** 上传时可选的分类（不含「全部」） */
const UPLOAD_CATEGORIES: { key: string; label: string }[] = [
  { key: 'CHARACTER', label: '人物' },
  { key: 'PRODUCT', label: '产品' },
  { key: 'OTHER', label: '其他' },
]

const CATEGORY_LABELS: Record<string, string> = {
  CHARACTER: '人物',
  PRODUCT: '产品',
  OTHER: '其他',
}

// ─── 主页面 ───

export default function StoreLibraryPage() {
  const params = useParams<{ storeId: string }>()
  const { storeId } = params

  const [category, setCategory] = useState('')
  const [uploadCategory, setUploadCategory] = useState('CHARACTER')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const query = `/api/merchant/stores/${storeId}/assets${category ? `?category=${category}` : ''}`
  const { data, isLoading, mutate } = useSWR<{ assets: LibraryAsset[] }>(query, fetcher)
  const assets = data?.assets ?? []

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 允许重复选择同一文件：用完即清空 input
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', uploadCategory)
      const res = await fetch(`/api/merchant/stores/${storeId}/assets`, {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || '上传失败')
      }
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(assetId: string) {
    if (!confirm('确定删除该素材？删除后引用它的复刻任务将无法再使用。')) return
    setDeletingId(assetId)
    setError(null)
    try {
      const res = await fetch(`/api/merchant/stores/${storeId}/assets/${assetId}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error?.message || '删除失败')
      }
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-10">
      {/* 头部 */}
      <section className="zen-reveal py-5 border-b border-[var(--ll-hair)]">
        <Link
          href={`/merchant/stores/${storeId}`}
          className="inline-flex items-center gap-1 text-xs text-[var(--ll-text-3)] hover:text-[var(--ll-green)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回门店
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[var(--ll-text)] leading-snug">素材库</h1>
        <p className="mt-1 text-xs text-[var(--ll-text-3)]">
          上传人物 / 产品参考图，复刻爆款时可用「@素材」引用作为 AI 编辑参考
        </p>
      </section>

      {/* 上传区 */}
      <section className="zen-reveal py-5 border-b border-[var(--ll-hair)]">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[var(--ll-text-2)]">上传到分类</span>
          <div className="flex gap-1.5">
            {UPLOAD_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setUploadCategory(c.key)}
                className={
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-all ' +
                  (uploadCategory === c.key
                    ? 'bg-[var(--ll-green)] text-black'
                    : 'bg-[var(--ll-muted)] text-[var(--ll-text-2)] hover:text-[var(--ll-text)]')
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          className="hidden"
          onChange={handleUpload}
        />
        <ZenButton
          variant="primary"
          fullWidth
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" /> 上传中...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ImagePlus className="h-4 w-4" /> 上传素材
            </span>
          )}
        </ZenButton>
        <p className="mt-2 text-[11px] text-[var(--ll-text-3)] text-center">
          支持 JPG / PNG / WebP 图片或 MP4 短视频，单个最大 300MB
        </p>
        {error && (
          <p className="mt-2 text-xs text-red-400 bg-red-900/20 rounded-lg p-2">{error}</p>
        )}
      </section>

      {/* 分类筛选 */}
      <div className="zen-reveal flex gap-1.5 py-4">
        {FILTER_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={
              'px-3 py-1 rounded-full text-xs font-medium transition-all ' +
              (category === c.key
                ? 'bg-[var(--ll-green)] text-black'
                : 'bg-[var(--ll-muted)] text-[var(--ll-text-2)] hover:text-[var(--ll-text)]')
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 素材网格 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ll-text-3)]" />
        </div>
      ) : assets.length === 0 ? (
        <div className="py-10">
          <EmptyState
            illustration="upload"
            title="素材库还是空的"
            description="上传门店的人物出镜图、招牌菜特写，复刻爆款时即可作为 AI 参考"
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {assets.map((a) => (
            <div
              key={a.id}
              className="relative aspect-square rounded-lg overflow-hidden border border-[var(--ll-hair)] bg-[var(--ll-ceramic)] group"
            >
              {a.type === 'VIDEO' && !a.thumbUrl ? (
                <div className="w-full h-full flex items-center justify-center text-[var(--ll-text-3)]">
                  <Film className="h-6 w-6" strokeWidth={1.5} />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumbUrl} alt={a.filename} className="w-full h-full object-cover" />
              )}

              {/* 分类角标 */}
              {a.category && CATEGORY_LABELS[a.category] && (
                <span className="absolute top-1 left-1 text-[9px] font-medium text-white bg-black/60 rounded px-1.5 py-0.5">
                  {CATEGORY_LABELS[a.category]}
                </span>
              )}

              {/* 视频角标 */}
              {a.type === 'VIDEO' && (
                <span className="absolute bottom-1 left-1 text-white/90 bg-black/50 rounded p-0.5">
                  <Film className="h-3 w-3" />
                </span>
              )}

              {/* 删除按钮 */}
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                disabled={deletingId === a.id}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white/80 hover:text-red-400 hover:bg-black/80 transition-colors disabled:opacity-50"
                aria-label="删除素材"
              >
                {deletingId === a.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
