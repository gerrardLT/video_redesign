'use client'

/**
 * SSE 渲染进度推送集成 Hook
 *
 * 使用 EventSource 连接现有 /api/sse/progress 端点，
 * 监听 render 类型事件，自动更新 content-brief-store 的 renderProgress。
 * 渲染完成后自动 mutate SWR 缓存（视频版本列表）。
 *
 * 复用现有 SSE 基础设施（progress-publisher → Redis Pub/Sub → SSE route）。
 *
 * Requirements: 7.5, 15.4
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useContentBriefStore } from '@/stores/content-brief-store'
import { mutate } from 'swr'
import type { ProgressEventPayload } from '@/lib/sse/types'

/** SSE 端点路径 */
const SSE_URL = '/api/sse/progress'

export interface UseRenderProgressOptions {
  /** 鉴权 token（userId），为 null 时不连接 */
  token: string | null
  /** 当前关注的内容任务 ID，仅接收此 ID 的渲染事件 */
  contentBriefId: string | null
  /** 是否启用，默认 true */
  enabled?: boolean
}

export interface UseRenderProgressReturn {
  /** 当前渲染进度（0-100），null 表示未在渲染 */
  renderProgress: number | null
  /** SSE 连接是否活跃 */
  isConnected: boolean
}

/**
 * 渲染进度 SSE Hook
 *
 * 监听 SSE 事件流中的 render 类型事件，筛选指定 contentBriefId，
 * 自动更新 Zustand store 的 renderProgress 状态。
 * 接收到 completed/failed 事件后自动 mutate SWR 视频版本缓存。
 *
 * @param options - 连接配置
 */
export function useRenderProgress(options: UseRenderProgressOptions): UseRenderProgressReturn {
  const { token, contentBriefId, enabled = true } = options
  const { setRenderProgress, renderProgress } = useContentBriefStore()
  const eventSourceRef = useRef<EventSource | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  /** 清理 EventSource 连接 */
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
  }, [])

  /** 处理渲染进度事件 */
  const handleRenderEvent = useCallback(
    (event: ProgressEventPayload) => {
      // 仅处理关注的 contentBriefId
      if (contentBriefId && event.taskId !== contentBriefId) {
        return
      }

      switch (event.eventType) {
        case 'progress_update':
        case 'state_change':
          // 更新渲染进度
          if (typeof event.progress === 'number') {
            setRenderProgress(event.progress)
          }
          break

        case 'completed':
          // 渲染完成：设置进度 100%，然后清除
          setRenderProgress(100)
          // 延迟 1 秒后清除进度状态，让 UI 展示完成
          setTimeout(() => {
            setRenderProgress(null)
          }, 1500)
          // 自动刷新 SWR 缓存：视频版本列表 + 内容任务详情
          if (contentBriefId) {
            mutate(`/api/content-briefs/${contentBriefId}/variants`)
            mutate(`/api/content-briefs/${contentBriefId}`)
          }
          break

        case 'failed':
          // 渲染失败：清除进度
          setRenderProgress(null)
          // 刷新内容任务详情（状态变为 FAILED）
          if (contentBriefId) {
            mutate(`/api/content-briefs/${contentBriefId}`)
          }
          break
      }
    },
    [contentBriefId, setRenderProgress]
  )

  useEffect(() => {
    if (!token || !enabled) {
      // 清理连接但不触发 state 更新（由 cleanup return 处理）
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    // 清理旧连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    const url = `${SSE_URL}?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      setIsConnected(true)
    }

    es.onerror = () => {
      setIsConnected(false)
      // EventSource 会自动重连（遵循服务端 retry 指令）
    }

    // 监听 message 事件（默认事件类型，所有进度事件都通过 message 发送）
    es.onmessage = (messageEvent: MessageEvent) => {
      try {
        const event: ProgressEventPayload = JSON.parse(messageEvent.data)
        // 仅处理 render 类型的事件
        if (event.taskType === 'render' || event.taskType === 'generation') {
          handleRenderEvent(event)
        }
      } catch {
        // JSON 解析失败，忽略
      }
    }

    // 同时监听具名事件类型（兼容不同发布方式）
    const namedHandler = (messageEvent: MessageEvent) => {
      try {
        const event: ProgressEventPayload = JSON.parse(messageEvent.data)
        handleRenderEvent(event)
      } catch {
        // JSON 解析失败，忽略
      }
    }

    es.addEventListener('render', namedHandler)
    es.addEventListener('generation', namedHandler)

    return () => {
      es.removeEventListener('render', namedHandler)
      es.removeEventListener('generation', namedHandler)
      cleanup()
    }
  }, [token, enabled, cleanup, handleRenderEvent])

  return {
    renderProgress,
    isConnected,
  }
}
