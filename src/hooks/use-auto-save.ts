import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions {
  shotId: string
  delay?: number
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * 自动保存 Hook
 * 防抖 1 秒后自动调用 PUT /api/shots/[id]
 */
export function useAutoSave({ shotId, delay = 1000, onSuccess, onError }: UseAutoSaveOptions) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 清除定时器
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 执行保存
  const save = useCallback(
    async (data: Record<string, unknown>) => {
      // 取消上一次未完成的请求
      if (abortRef.current) {
        abortRef.current.abort()
      }

      const controller = new AbortController()
      abortRef.current = controller

      setStatus('saving')

      try {
        const res = await fetch(`/api/shots/${shotId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error('保存失败')
        }

        setStatus('saved')
        onSuccess?.()

        // 2 秒后恢复为 idle
        setTimeout(() => setStatus('idle'), 2000)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setStatus('error')
        onError?.(err instanceof Error ? err : new Error('保存失败'))
      }
    },
    [shotId, onSuccess, onError]
  )

  // 触发防抖保存
  const triggerSave = useCallback(
    (data: Record<string, unknown>) => {
      clearTimer()
      setStatus('idle')
      timerRef.current = setTimeout(() => {
        save(data)
      }, delay)
    },
    [clearTimer, save, delay]
  )

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearTimer()
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [clearTimer])

  return { status, triggerSave, saveNow: save }
}
