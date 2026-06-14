'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { type VideoPlatform } from '@/constants/platform-patterns'

// ========================
// Types
// ========================

type ImportTaskStatus = 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED'

interface ImportStatusResponse {
  taskId: string
  status: ImportTaskStatus
  progress: number
  errorMsg?: string | null
  platform?: VideoPlatform | null
}

interface ImportProgressProps {
  projectId: string
}

// ========================
// 常量
// ========================

const POLL_INTERVAL = 2000 // 2 秒轮询间隔

// ========================
// 平台图标组件
// ========================

function PlatformIcon({ platform }: { platform: VideoPlatform | null | undefined }) {
  if (!platform) return null

  switch (platform) {
    case 'douyin':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cine-surface)]" aria-label="抖音">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#fe2c55]" fill="currentColor" aria-hidden="true">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.88 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.28 0 .56.04.82.1V9.39a6.17 6.17 0 00-.82-.06A6.28 6.28 0 003.2 15.6a6.28 6.28 0 006.29 6.28 6.28 6.28 0 006.28-6.28V9.01a8.28 8.28 0 004.85 1.56V7.12a4.84 4.84 0 01-1.03-.43z" />
          </svg>
        </span>
      )
    case 'kuaishou':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cine-surface)]" aria-label="快手">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#ff4500]" fill="currentColor" aria-hidden="true">
            <path d="M12.52 2c-.58 3.02-2.8 5.4-5.7 6.2v3.8c1.5-.3 2.9-.9 4.1-1.8v9.6h3.6V2h-2z" />
            <circle cx="9.5" cy="17" r="3" />
          </svg>
        </span>
      )
    case 'weixin':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cine-surface)]" aria-label="微信视频号">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#07c160]" fill="currentColor" aria-hidden="true">
            <path d="M8.69 3C4.97 3 2 5.77 2 9.17c0 1.87.9 3.55 2.3 4.68l-.5 2.5 2.7-1.4c.7.2 1.4.32 2.19.32.34 0 .67-.02 1-.06a5.17 5.17 0 01-.2-1.38c0-3.17 2.86-5.75 6.38-5.75.36 0 .71.03 1.06.08C16.68 5.13 13.05 3 8.69 3zm-2.6 4.25a1.13 1.13 0 110 2.25 1.13 1.13 0 010-2.25zm4.93 0a1.13 1.13 0 110 2.25 1.13 1.13 0 010-2.25zM15.87 9.58c-2.97 0-5.38 2.17-5.38 4.83 0 2.67 2.41 4.84 5.38 4.84.56 0 1.1-.08 1.62-.22l2.12 1.1-.39-1.96c1.16-.94 1.9-2.28 1.9-3.76 0-2.66-2.4-4.83-5.25-4.83zm-1.92 3.38a.94.94 0 110 1.87.94.94 0 010-1.87zm3.75 0a.94.94 0 110 1.87.94.94 0 010-1.87z" />
          </svg>
        </span>
      )
    default:
      return null
  }
}

// ========================
// 状态文案工具函数
// ========================

function getStatusText(status: ImportTaskStatus): string {
  switch (status) {
    case 'PENDING':
      return '准备中...'
    case 'DOWNLOADING':
      return '正在下载视频...'
    case 'COMPLETED':
      return '下载完成'
    case 'FAILED':
      return '下载失败'
    default:
      return '未知状态'
  }
}

function getPlatformLabel(platform: VideoPlatform | null | undefined): string {
  if (!platform) return ''
  switch (platform) {
    case 'douyin':
      return '抖音'
    case 'kuaishou':
      return '快手'
    case 'weixin':
      return '微信视频号'
    default:
      return ''
  }
}

// ========================
// ImportProgress Component
// ========================

export function ImportProgress({ projectId }: ImportProgressProps) {
  const [statusData, setStatusData] = useState<ImportStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 停止轮询
  const stopPolling = useRef(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  })

  // 轮询请求
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/import-status`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('未找到导入任务')
        } else {
          setError('查询状态失败')
        }
        return
      }

      const data: ImportStatusResponse = await res.json()
      setStatusData(data)
      setError(null)

      // 下载完成或失败后停止轮询
      if (data.status === 'COMPLETED' || data.status === 'FAILED') {
        stopPolling.current()
      }
    } catch {
      setError('网络请求失败，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // 开始轮询
  useEffect(() => {
    // 首次立即请求
    fetchStatus()

    // 设置轮询定时器
    timerRef.current = setInterval(fetchStatus, POLL_INTERVAL)

    return () => {
      stopPolling.current()
    }
  }, [fetchStatus])

  // 加载中占位
  if (loading && !statusData) {
    return (
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-5">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 animate-pulse rounded-lg bg-[var(--cine-surface)]" />
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--cine-surface)]" />
        </div>
      </div>
    )
  }

  // 请求错误
  if (error && !statusData) {
    return (
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-5">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <ErrorIcon />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!statusData) return null

  const { status, progress, errorMsg, platform } = statusData
  const isActive = status === 'PENDING' || status === 'DOWNLOADING'
  const isCompleted = status === 'COMPLETED'
  const isFailed = status === 'FAILED'

  return (
    <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-5">
      {/* 顶部：平台图标 + 状态文字 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={platform} />
          <div>
            <p className="text-sm font-medium text-white">
              {platform ? `从${getPlatformLabel(platform)}导入` : '视频导入'}
            </p>
            <p className="text-xs text-[var(--cine-text-2)]">{getStatusText(status)}</p>
          </div>
        </div>

        {/* 状态指示器 */}
        {isActive && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--cine-gold)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--cine-gold)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--cine-gold)]" />
            </span>
            进行中
          </span>
        )}

        {isCompleted && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--cine-green)]">
            <CheckIcon />
            完成
          </span>
        )}

        {isFailed && (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <ErrorIcon />
            失败
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="mb-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--cine-surface)]">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isFailed
                ? 'bg-red-500'
                : isCompleted
                  ? 'bg-green-500'
                  : 'bg-[var(--cine-gold)]'
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="导入进度"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs text-[var(--cine-text-3)]">
            {isActive && '正在从平台下载视频...'}
            {isCompleted && '视频已成功导入'}
            {isFailed && '导入过程中遇到问题'}
          </span>
          <span className="text-xs font-medium text-[var(--cine-text-2)]">{progress}%</span>
        </div>
      </div>

      {/* 失败状态：展示错误信息 */}
      {isFailed && errorMsg && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5">
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-xs text-red-300">{errorMsg}</p>
        </div>
      )}

      {/* 完成状态：展示查看项目链接 */}
      {isCompleted && (
        <div className="mt-3">
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cine-gold)] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            查看项目
          </Link>
        </div>
      )}
    </div>
  )
}

// ========================
// SVG 图标组件
// ========================

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
