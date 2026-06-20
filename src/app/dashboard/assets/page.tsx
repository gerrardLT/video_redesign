'use client'

/**
 * 资产库主页面
 *
 * 组合 AssetFilterBar（分类 Tab + 搜索）和 AssetGrid（资产网格 + 分页），
 * 集成 PreviewModal（全屏预览/缩放）和 CharacterApplyDialog（跨项目应用角色图）。
 *
 * 操作流程：
 * - 下载：调用 store.downloadAsset(assetId)（内部获取签名 URL → 触发浏览器下载）
 * - 预览：设置 store.setPreviewAsset → 打开 PreviewModal
 * - 应用到角色：打开 CharacterApplyDialog → 选择确认后调用 store.applyToCharacter
 *
 * Requirements: 1.1, 2.2, 3.1, 3.6, 4.3
 */

import { useEffect, useState, useCallback } from 'react'
import { AssetFilterBar } from '@/components/asset-library/asset-filter-bar'
import { AssetGrid, type AssetLibraryItem } from '@/components/asset-library/asset-grid'
import { PreviewModal } from '@/components/asset-library/preview-modal'
import { CharacterApplyDialog } from '@/components/asset-library/character-apply-dialog'
import { useAssetLibraryStore } from '@/stores/asset-library-store'

/** 分类计数数据结构 */
interface CategoryCounts {
  CHARACTER: number
  MATERIAL: number
  AUDIO: number
  total: number
}

/** 分页资产列表响应 */
interface PaginatedAssets {
  items: AssetLibraryItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export default function AssetLibraryPage() {
  const { category, keyword, page, pageSize } = useAssetLibraryStore()

  // Store actions
  const setPreviewAsset = useAssetLibraryStore((s) => s.setPreviewAsset)
  const clearPreviewAsset = useAssetLibraryStore((s) => s.clearPreviewAsset)
  const previewAsset = useAssetLibraryStore((s) => s.previewAsset)
  const downloadAsset = useAssetLibraryStore((s) => s.downloadAsset)

  // 资产列表数据
  const [assets, setAssets] = useState<PaginatedAssets>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  })
  const [counts, setCounts] = useState<CategoryCounts | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // CharacterApplyDialog 状态管理
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyTargetAsset, setApplyTargetAsset] = useState<AssetLibraryItem | null>(null)

  /** 获取资产列表 */
  const fetchAssets = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (keyword) params.set('keyword', keyword)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      const res = await fetch(`/api/asset-library?${params.toString()}`)
      if (res.ok) {
        const data: PaginatedAssets = await res.json()
        setAssets(data)
      }
    } catch (error) {
      console.error('[AssetLibraryPage] 获取资产列表失败:', error)
    } finally {
      setIsLoading(false)
    }
  }, [category, keyword, page, pageSize])

  /** 获取分类计数 */
  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/asset-library/counts')
      if (res.ok) {
        const data: CategoryCounts = await res.json()
        setCounts(data)
      }
    } catch (error) {
      console.error('[AssetLibraryPage] 获取分类计数失败:', error)
    }
  }, [])

  // 筛选条件变化时重新获取列表
  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  // 初始加载和删除后刷新计数
  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  /** 删除资产：调用 DELETE API，成功后刷新列表和计数 */
  const handleDelete = async (assetId: string) => {
    try {
      const res = await fetch(`/api/asset-library/${assetId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        // 删除成功，刷新列表和计数
        await Promise.all([fetchAssets(), fetchCounts()])
      } else {
        const data = await res.json()
        console.error('[AssetLibraryPage] 删除失败:', data.error?.message)
      }
    } catch (error) {
      console.error('[AssetLibraryPage] 删除请求失败:', error)
    }
  }

  /** 预览操作：设置 store 中的预览资产，触发 PreviewModal 打开 */
  const handlePreview = useCallback(
    (item: AssetLibraryItem) => {
      setPreviewAsset(item)
    },
    [setPreviewAsset]
  )

  /** 下载操作：调用 store.downloadAsset（内部获取签名 URL + 触发浏览器下载） */
  const handleDownload = useCallback(
    async (assetId: string) => {
      await downloadAsset(assetId)
    },
    [downloadAsset]
  )

  /** 应用到角色操作：打开 CharacterApplyDialog */
  const handleApplyToCharacter = useCallback((item: AssetLibraryItem) => {
    setApplyTargetAsset(item)
    setApplyDialogOpen(true)
  }, [])

  /** CharacterApplyDialog 成功回调 */
  const handleApplySuccess = useCallback((_projectName: string, _characterName: string) => {
    // toast 已在 CharacterApplyDialog 内部处理
    setApplyDialogOpen(false)
    setApplyTargetAsset(null)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {/* 页面标题 */}
      <h1 className="text-2xl font-bold text-white">资产库</h1>

      {/* 筛选栏：分类 Tab + 搜索框 */}
      <AssetFilterBar counts={counts} />

      {/* 资产网格：卡片列表 + 分页 */}
      <AssetGrid
        items={assets.items}
        total={assets.total}
        page={assets.page}
        pageSize={assets.pageSize}
        totalPages={assets.totalPages}
        isLoading={isLoading}
        onDelete={handleDelete}
        onPreview={handlePreview}
        onDownload={handleDownload}
        onApplyToCharacter={handleApplyToCharacter}
      />

      {/* 全屏预览模态框 */}
      <PreviewModal
        asset={previewAsset}
        onClose={clearPreviewAsset}
        onDownload={handleDownload}
      />

      {/* 角色图跨项目应用对话框 */}
      {applyTargetAsset && (
        <CharacterApplyDialog
          assetId={applyTargetAsset.id}
          assetUrl={applyTargetAsset.url}
          open={applyDialogOpen}
          onOpenChange={(open) => {
            setApplyDialogOpen(open)
            if (!open) setApplyTargetAsset(null)
          }}
          onSuccess={handleApplySuccess}
        />
      )}
    </div>
  )
}
