/**
 * SSE 实时进度推送 — Zustand Store
 *
 * 管理 SSE 连接状态和进度事件数据。
 * - isConnected: SSE 连接是否活跃
 * - progressMap: 按 taskId 索引的最新进度事件
 * - lastEventId: 最后接收到的事件 ID
 *
 * 终态事件（completed/failed）到达后，延迟 5 秒从 progressMap 移除，
 * 让 UI 有时间展示完成/失败状态。
 */

import { create } from 'zustand'
import type { ProgressEventPayload } from '@/lib/sse/types'

interface SSEProgressState {
  /** SSE 连接是否活跃 */
  isConnected: boolean
  /** 按 taskId 索引的最新进度事件 */
  progressMap: Map<string, ProgressEventPayload>
  /** 最后接收到的事件 ID */
  lastEventId: number
  /** 设置连接状态 */
  setConnected: (status: boolean) => void
  /** 更新进度事件（终态事件 5 秒后自动移除） */
  updateProgress: (event: ProgressEventPayload) => void
  /** 手动清除指定任务的进度 */
  clearTask: (taskId: string) => void
  /** 重置所有状态 */
  resetAll: () => void
}

/** 终态事件类型，到达后 5 秒自动从 progressMap 移除 */
const TERMINAL_EVENT_TYPES = new Set(['completed', 'failed'])
/** 终态事件移除延迟（毫秒） */
const TERMINAL_REMOVE_DELAY_MS = 5000

export const useSSEProgressStore = create<SSEProgressState>((set, get) => ({
  isConnected: false,
  progressMap: new Map(),
  lastEventId: 0,

  setConnected: (status: boolean) => set({ isConnected: status }),

  updateProgress: (event: ProgressEventPayload) => {
    const { progressMap } = get()
    const newMap = new Map(progressMap)
    newMap.set(event.taskId, event)
    set({ progressMap: newMap })

    // 终态事件延迟 5 秒后自动从 progressMap 移除
    if (TERMINAL_EVENT_TYPES.has(event.eventType)) {
      setTimeout(() => {
        const { progressMap: currentMap } = get()
        const current = currentMap.get(event.taskId)
        // 仅在当前存储的仍是同一个终态事件时才移除
        if (current && current.eventType === event.eventType && current.timestamp === event.timestamp) {
          const updated = new Map(currentMap)
          updated.delete(event.taskId)
          set({ progressMap: updated })
        }
      }, TERMINAL_REMOVE_DELAY_MS)
    }
  },

  clearTask: (taskId: string) => {
    const { progressMap } = get()
    const newMap = new Map(progressMap)
    newMap.delete(taskId)
    set({ progressMap: newMap })
  },

  resetAll: () => set({
    isConnected: false,
    progressMap: new Map(),
    lastEventId: 0,
  }),
}))
