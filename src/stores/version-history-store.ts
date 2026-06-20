/**
 * 版本历史状态管理 — Zustand Store
 *
 * 管理分镜组（ShotGroup）的版本历史列表、加载状态、对比模式。
 * - versions: 当前分镜组的版本列表（按 versionNumber 降序）
 * - stats: 版本数量/上限统计
 * - compareMode: A/B 对比模式开关
 *
 * switchVersion 成功后同步更新 shot-store 中对应 ShotGroup 的
 * genVideoUrl/genCoverUrl/lastFrameUrl，确保 UI 即时响应。
 *
 * Requirements: 3.1, 5.3, 6.5
 */

import { create } from 'zustand'
import { useShotStore } from './shot-store'

/** 版本条目（与 GET /api/shot-groups/[id]/versions 返回格式对齐） */
export interface VersionItem {
  id: string
  versionNumber: number
  videoUrl: string
  coverUrl: string | null
  lastFrameUrl: string | null
  promptExcerpt: string
  promptSnapshot: string
  costEstimate: number
  isCurrent: boolean
  createdAt: string
}

interface VersionHistoryState {
  /** 当前加载的版本所属分镜组 ID（用于防止跨组污染） */
  currentShotGroupId: string | null
  /** 版本列表（按 versionNumber 降序） */
  versions: VersionItem[]
  /** 版本数量/上限统计 */
  stats: { count: number; limit: number } | null
  /** 是否正在加载 */
  isLoading: boolean
  /** 错误信息 */
  error: string | null

  /** A/B 对比模式开关 */
  compareMode: boolean
  /** 对比模式下选中的两个版本 ID */
  compareVersionIds: [string, string] | null

  /** 获取版本列表 */
  fetchVersions: (shotGroupId: string) => Promise<void>
  /** 切换当前版本（同步更新 shot-store） */
  switchVersion: (shotGroupId: string, versionId: string) => Promise<void>
  /** 删除版本 */
  deleteVersion: (shotGroupId: string, versionId: string) => Promise<void>
  /** 进入 A/B 对比模式 */
  enterCompareMode: (versionA: string, versionB: string) => void
  /** 退出 A/B 对比模式 */
  exitCompareMode: () => void
}

export const useVersionHistoryStore = create<VersionHistoryState>((set, get) => ({
  currentShotGroupId: null,
  versions: [],
  stats: null,
  isLoading: false,
  error: null,
  compareMode: false,
  compareVersionIds: null,

  fetchVersions: async (shotGroupId: string) => {
    set({ isLoading: true, error: null, currentShotGroupId: shotGroupId })
    try {
      const res = await fetch(`/api/shot-groups/${shotGroupId}/versions`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `请求失败 (${res.status})`)
      }
      const data: { versions: VersionItem[]; stats: { count: number; limit: number } } = await res.json()
      set({ versions: data.versions, stats: data.stats, isLoading: false, currentShotGroupId: shotGroupId })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取版本列表失败'
      set({ error: message, isLoading: false })
    }
  },

  switchVersion: async (shotGroupId: string, versionId: string) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(`/api/shot-groups/${shotGroupId}/versions/${versionId}/switch`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `切换版本失败 (${res.status})`)
      }
      const data: {
        version: VersionItem
        shotGroup: { genVideoUrl: string; genCoverUrl: string | null; lastFrameUrl: string | null }
      } = await res.json()

      // 更新本 store 的版本列表：目标版本变为 isCurrent=true，其余为 false
      const { versions } = get()
      const updatedVersions = versions.map((v) => ({
        ...v,
        isCurrent: v.id === versionId,
      }))
      set({ versions: updatedVersions, isLoading: false })

      // 同步更新 shot-store 中对应 ShotGroup 的字段
      useShotStore.getState().updateShot(shotGroupId, {
        genVideoUrl: data.shotGroup.genVideoUrl,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '切换版本失败'
      set({ error: message, isLoading: false })
    }
  },

  deleteVersion: async (shotGroupId: string, versionId: string) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(`/api/shot-groups/${shotGroupId}/versions/${versionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `删除版本失败 (${res.status})`)
      }

      // 从列表中移除已删除的版本，更新 stats
      const { versions, stats } = get()
      const updatedVersions = versions.filter((v) => v.id !== versionId)
      const updatedStats = stats
        ? { ...stats, count: stats.count - 1 }
        : null
      set({ versions: updatedVersions, stats: updatedStats, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除版本失败'
      set({ error: message, isLoading: false })
    }
  },

  enterCompareMode: (versionA: string, versionB: string) => {
    set({ compareMode: true, compareVersionIds: [versionA, versionB] })
  },

  exitCompareMode: () => {
    set({ compareMode: false, compareVersionIds: null })
  },
}))
