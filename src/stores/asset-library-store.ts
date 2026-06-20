import { create } from 'zustand'
import { toast } from 'sonner'
import type { AssetLibraryItem } from '@/components/asset-library/asset-grid'

/** 资产库分类类型 */
export type AssetCategory = 'CHARACTER' | 'MATERIAL' | 'AUDIO'

/** 资产过期状态筛选类型 */
export type ExpiryFilter = 'all' | 'expiring_soon' | 'active' | 'expired'

/** 网络请求超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 30_000

/**
 * 带 30s 超时的 fetch 封装
 * 超时后自动 abort 并弹出 toast 提示
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    return response
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      toast.error('网络请求超时，请重试')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

interface AssetLibraryState {
  // 查询条件
  category: AssetCategory | null
  keyword: string
  page: number
  pageSize: number
  /** 过期状态筛选（null 表示不筛选，等同于 'all'） */
  expiryFilter: ExpiryFilter | null

  // 预览状态
  /** 当前预览资产（null 表示关闭预览） */
  previewAsset: AssetLibraryItem | null

  // 操作 loading 状态
  /** 下载操作进行中的资产 ID */
  downloadingAssetId: string | null
  /** 应用到角色操作进行中 */
  applyingToCharacter: boolean

  // Actions - 查询条件
  setCategory: (category: AssetCategory | null) => void
  setKeyword: (keyword: string) => void
  setPage: (page: number) => void
  setExpiryFilter: (filter: ExpiryFilter | null) => void
  reset: () => void

  // Actions - 资产操作
  /** 收藏资产（将临时资产升级为永久资产） */
  bookmarkAsset: (assetId: string, category?: string) => Promise<void>
  /** 续期资产（从当前时间起延长 14 天有效期） */
  renewAsset: (assetId: string) => Promise<void>

  // Actions - 预览
  /** 设置当前预览资产（打开预览弹窗） */
  setPreviewAsset: (asset: AssetLibraryItem) => void
  /** 清除预览资产（关闭预览弹窗） */
  clearPreviewAsset: () => void

  // Actions - 下载
  /** 下载资产：调用下载 API 获取签名 URL → 触发浏览器下载 */
  downloadAsset: (assetId: string) => Promise<void>

  // Actions - 跨项目应用
  /** 应用资产到角色：调用应用 API 更新目标角色的 imageUrl */
  applyToCharacter: (
    assetId: string,
    targetProjectId: string,
    targetCharacterId: string
  ) => Promise<{ projectName: string; characterName: string }>
}

const initialState = {
  category: null as AssetCategory | null,
  keyword: '',
  page: 1,
  pageSize: 20,
  expiryFilter: null as ExpiryFilter | null,
  previewAsset: null as AssetLibraryItem | null,
  downloadingAssetId: null as string | null,
  applyingToCharacter: false,
}

export const useAssetLibraryStore = create<AssetLibraryState>((set) => ({
  ...initialState,

  setCategory: (category) => set({ category, page: 1 }),

  setKeyword: (keyword) => set({ keyword, page: 1 }),

  setPage: (page) => set({ page }),

  setExpiryFilter: (expiryFilter) => set({ expiryFilter, page: 1 }),

  reset: () => set({ ...initialState }),

  bookmarkAsset: async (assetId, category) => {
    const response = await fetchWithTimeout(`/api/assets/${assetId}/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category || 'CHARACTER' }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data?.error?.message || '收藏失败')
    }
  },

  renewAsset: async (assetId) => {
    const response = await fetchWithTimeout(`/api/assets/${assetId}/renew`, {
      method: 'POST',
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data?.error || '续期失败')
    }
  },

  // 预览操作
  setPreviewAsset: (asset) => set({ previewAsset: asset }),
  clearPreviewAsset: () => set({ previewAsset: null }),

  // 下载操作：调用 API 获取签名 URL → 创建临时 <a> 元素触发浏览器下载
  downloadAsset: async (assetId) => {
    set({ downloadingAssetId: assetId })
    try {
      const response = await fetchWithTimeout(
        `/api/asset-library/${assetId}/download`
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message = data?.error || '下载链接生成失败，请重试'
        toast.error(message)
        throw new Error(message)
      }

      const { downloadUrl, fileName } = await response.json() as {
        downloadUrl: string
        fileName: string
      }

      // 创建临时 <a> 元素触发浏览器下载
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileName
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error: unknown) {
      // AbortError 已在 fetchWithTimeout 中处理 toast
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      // 非超时的其他异常不重复 toast（上面已有处理）
    } finally {
      set({ downloadingAssetId: null })
    }
  },

  // 跨项目应用：调用 apply API 更新目标角色 imageUrl
  applyToCharacter: async (assetId, targetProjectId, targetCharacterId) => {
    set({ applyingToCharacter: true })
    try {
      const response = await fetchWithTimeout(
        `/api/asset-library/${assetId}/apply-to-character`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetProjectId, targetCharacterId }),
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message = data?.error || '应用失败，请重试'
        toast.error(message)
        throw new Error(message)
      }

      const { character } = await response.json() as {
        character: {
          id: string
          name: string
          imageUrl: string
          projectId: string
          projectName?: string
        }
      }

      // 返回项目名和角色名用于外部显示 toast
      return {
        projectName: character.projectName || '',
        characterName: character.name,
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { projectName: '', characterName: '' }
      }
      throw error
    } finally {
      set({ applyingToCharacter: false })
    }
  },
}))
