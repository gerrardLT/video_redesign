'use client'

/**
 * SSE 实时进度推送 — 客户端 Hook
 *
 * 使用浏览器原生 EventSource API 连接 /api/sse/progress，
 * 实时接收任务进度事件并写入 Zustand store。
 *
 * 轮询策略：
 * - SSE 连接成功 → 降低轮询频率到 60 秒（安全网）
 * - SSE 断连超过 10 秒 → 恢复高频轮询 3-5 秒
 *
 * EventSource 不支持自定义 header，通过 URL query param ?token=xxx 传递鉴权 token。
 */

import { useEffect, useRef, useCallback } from 'react'
import { useSSEProgressStore } from '@/stores/sse-progress-store'
import type { ProgressEventPayload, TaskType } from '@/lib/sse/types'

/** SSE 端点路径 */
const SSE_URL = '/api/sse/progress'

/** 需要监听的任务事件类型 */
const TASK_TYPES: TaskType[] = ['generation', 'parse', 'character', 'merge', 'chain']

/** SSE 断连后恢复高频轮询的等待时间（毫秒） */
const DISCONNECT_THRESHOLD_MS = 10_000

/** SSE 连接时的低频轮询间隔（毫秒） */
const LOW_FREQ_POLLING_INTERVAL = 60_000

/** SSE 断连时的高频轮询间隔（毫秒） */
const HIGH_FREQ_POLLING_INTERVAL = 4_000

export interface UseSSEProgressReturn {
  /** SSE 连接是否活跃 */
  isConnected: boolean
  /** 最新的进度事件（按 taskId 索引） */
  progressMap: Map<string, ProgressEventPayload>
  /** 手动触发重连 */
  reconnect: () => void
  /** 当前推荐的轮询间隔（毫秒） */
  pollingInterval: number
}

/**
 * SSE 实时进度推送 Hook
 *
 * @param token - 鉴权 token（完整 JWT token，从 cookie 获取），为 null 时不连接
 * @param enabled - 是否启用 SSE（用于 feature flag 控制），默认 true
 * @returns SSE 连接状态、进度数据、重连方法和推荐轮询间隔
 */
export function useSSEProgress(token: string | null, enabled = true): UseSSEProgressReturn {
  const { setConnected, updateProgress, isConnected, progressMap } = useSSEProgressStore()
  const eventSourceRef = useRef<EventSource | null>(null)
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingIntervalRef = useRef<number>(HIGH_FREQ_POLLING_INTERVAL)

  /** 清理 EventSource 连接和相关定时器 */
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current)
      disconnectTimerRef.current = null
    }
  }, [])

  /** 建立 SSE 连接 */
  const connect = useCallback(() => {
    if (!token || !enabled) return

    // 清理旧连接
    cleanup()

    const url = `${SSE_URL}?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    // 连接成功
    es.onopen = () => {
      setConnected(true)
      pollingIntervalRef.current = LOW_FREQ_POLLING_INTERVAL

      // 清除断连定时器
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current)
        disconnectTimerRef.current = null
      }
    }

    // 连接错误 — 浏览器会自动重连（遵循 retry 间隔）
    es.onerror = () => {
      setConnected(false)

      // 断连超过 10 秒未恢复 → 恢复高频轮询
      if (!disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => {
          pollingIntervalRef.current = HIGH_FREQ_POLLING_INTERVAL
          disconnectTimerRef.current = null
        }, DISCONNECT_THRESHOLD_MS)
      }
    }

    // 监听各任务类型事件
    for (const taskType of TASK_TYPES) {
      es.addEventListener(taskType, (messageEvent: MessageEvent) => {
        try {
          const event: ProgressEventPayload = JSON.parse(messageEvent.data)
          updateProgress(event)

          // 更新 lastEventId
          if (messageEvent.lastEventId) {
            const id = parseInt(messageEvent.lastEventId, 10)
            if (!isNaN(id)) {
              useSSEProgressStore.setState({ lastEventId: id })
            }
          }
        } catch {
          // JSON 解析失败，忽略
        }
      })
    }

    // 监听 snapshot 事件（重连后的全量快照）
    es.addEventListener('snapshot', (messageEvent: MessageEvent) => {
      try {
        const tasks: ProgressEventPayload[] = JSON.parse(messageEvent.data)
        for (const event of tasks) {
          updateProgress(event)
        }

        if (messageEvent.lastEventId) {
          const id = parseInt(messageEvent.lastEventId, 10)
          if (!isNaN(id)) {
            useSSEProgressStore.setState({ lastEventId: id })
          }
        }
      } catch {
        // JSON 解析失败，忽略
      }
    })
  }, [token, enabled, cleanup, setConnected, updateProgress])

  /** 手动重连 */
  const reconnect = useCallback(() => {
    cleanup()
    connect()
  }, [cleanup, connect])

  // 建立/断开连接
  useEffect(() => {
    if (token && enabled) {
      connect()
    } else {
      cleanup()
      setConnected(false)
      pollingIntervalRef.current = HIGH_FREQ_POLLING_INTERVAL
    }

    // 组件卸载时关闭 EventSource 连接
    return () => {
      cleanup()
      setConnected(false)
    }
  }, [token, enabled, connect, cleanup, setConnected])

  return {
    isConnected,
    progressMap,
    reconnect,
    // eslint-disable-next-line react-hooks/refs
    pollingInterval: pollingIntervalRef.current,
  }
}
