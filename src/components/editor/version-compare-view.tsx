'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useVersionHistoryStore } from '@/stores/version-history-store'

/**
 * A/B 版本对比组件 Props
 * 用于将两个生成版本并排播放，支持同步播放控制和版本切换
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export interface VersionCompareViewProps {
  /** 分镜组 ID */
  shotGroupId: string
  /** 版本 A 的 ID */
  versionAId: string
  /** 版本 B 的 ID */
  versionBId: string
  /** 关闭对比视图回调 */
  onClose?: () => void
}

/**
 * A/B 版本对比视图组件
 *
 * - 双视频并排等宽面板布局（50/50）
 * - 同步播放控制：play/pause/seek 操作同时影响两个视频
 * - 每个面板上方显示版本号和 prompt 摘要
 * - 提供"使用此版本"按钮，点击后调用 switchVersion 并退出对比模式
 * - 使用 useRef 控制 HTMLVideoElement 同步，isSyncing ref 防止循环触发
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export function VersionCompareView({
  shotGroupId,
  versionAId,
  versionBId,
  onClose,
}: VersionCompareViewProps) {
  const { versions, switchVersion, exitCompareMode } = useVersionHistoryStore()

  // 根据 ID 查找版本数据
  const versionA = versions.find((v) => v.id === versionAId)
  const versionB = versions.find((v) => v.id === versionBId)

  // 视频元素引用
  const videoRefA = useRef<HTMLVideoElement>(null)
  const videoRefB = useRef<HTMLVideoElement>(null)

  // 同步锁：防止 onPlay/onPause/onSeeked 事件循环触发
  const isSyncing = useRef(false)

  // 播放状态（用于控制按钮图标）
  const [isPlaying, setIsPlaying] = useState(false)

  /**
   * 同步播放：当一个视频开始播放时，另一个也播放
   */
  const handlePlay = useCallback((source: 'A' | 'B') => {
    if (isSyncing.current) return
    isSyncing.current = true

    const target = source === 'A' ? videoRefB.current : videoRefA.current
    if (target && target.paused) {
      target.play().catch(() => {
        // 浏览器可能阻止自动播放，静默处理
      })
    }
    setIsPlaying(true)

    isSyncing.current = false
  }, [])

  /**
   * 同步暂停：当一个视频暂停时，另一个也暂停
   */
  const handlePause = useCallback((source: 'A' | 'B') => {
    if (isSyncing.current) return
    isSyncing.current = true

    const target = source === 'A' ? videoRefB.current : videoRefA.current
    if (target && !target.paused) {
      target.pause()
    }
    setIsPlaying(false)

    isSyncing.current = false
  }, [])

  /**
   * 同步跳转：当一个视频 seek 完成后，另一个跳转到相同时间点
   */
  const handleSeeked = useCallback((source: 'A' | 'B') => {
    if (isSyncing.current) return
    isSyncing.current = true

    const sourceEl = source === 'A' ? videoRefA.current : videoRefB.current
    const targetEl = source === 'A' ? videoRefB.current : videoRefA.current
    if (sourceEl && targetEl) {
      const timeDiff = Math.abs(sourceEl.currentTime - targetEl.currentTime)
      // 仅在时间差异超过 0.1s 时同步，避免不必要的跳转
      if (timeDiff > 0.1) {
        targetEl.currentTime = sourceEl.currentTime
      }
    }

    isSyncing.current = false
  }, [])

  /**
   * 中央控制：播放/暂停切换
   */
  const handleTogglePlay = useCallback(() => {
    const videoA = videoRefA.current
    const videoB = videoRefB.current
    if (!videoA || !videoB) return

    isSyncing.current = true

    if (isPlaying) {
      videoA.pause()
      videoB.pause()
      setIsPlaying(false)
    } else {
      videoA.play().catch(() => {})
      videoB.play().catch(() => {})
      setIsPlaying(true)
    }

    isSyncing.current = false
  }, [isPlaying])

  /**
   * "使用此版本"按钮点击后：切换版本并退出对比模式
   */
  const handleUseVersion = useCallback(
    async (versionId: string) => {
      await switchVersion(shotGroupId, versionId)
      exitCompareMode()
      onClose?.()
    },
    [shotGroupId, switchVersion, exitCompareMode, onClose]
  )

  /**
   * 关闭对比视图
   */
  const handleClose = useCallback(() => {
    // 暂停两个视频
    videoRefA.current?.pause()
    videoRefB.current?.pause()
    exitCompareMode()
    onClose?.()
  }, [exitCompareMode, onClose])

  // 视频结束时同步暂停状态
  useEffect(() => {
    const videoA = videoRefA.current
    const videoB = videoRefB.current

    const handleEnded = () => {
      setIsPlaying(false)
    }

    videoA?.addEventListener('ended', handleEnded)
    videoB?.addEventListener('ended', handleEnded)

    return () => {
      videoA?.removeEventListener('ended', handleEnded)
      videoB?.removeEventListener('ended', handleEnded)
    }
  }, [])

  // 版本数据未找到时的提示
  if (!versionA || !versionB) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--cine-bg)] text-[var(--cine-text-2)]">
        <p>无法加载对比版本数据</p>
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full flex-col bg-[var(--cine-bg)]"
      role="region"
      aria-label="A/B 版本对比视图"
    >
      {/* 顶部工具栏：标题 + 关闭按钮 */}
      <div className="flex items-center justify-between border-b border-[var(--cine-line)] px-4 py-3">
        <h2 className="text-sm font-medium text-[var(--cine-text)]">
          版本对比
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleClose}
          aria-label="关闭对比视图"
          className="text-[var(--cine-text-2)] hover:text-[var(--cine-text)]"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </Button>
      </div>

      {/* 双视频面板区域 */}
      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* 面板 A */}
        <ComparePanel
          version={versionA}
          videoRef={videoRefA}
          label="A"
          onPlay={() => handlePlay('A')}
          onPause={() => handlePause('A')}
          onSeeked={() => handleSeeked('A')}
          onUseVersion={() => handleUseVersion(versionA.id)}
        />

        {/* 面板 B */}
        <ComparePanel
          version={versionB}
          videoRef={videoRefB}
          label="B"
          onPlay={() => handlePlay('B')}
          onPause={() => handlePause('B')}
          onSeeked={() => handleSeeked('B')}
          onUseVersion={() => handleUseVersion(versionB.id)}
        />
      </div>

      {/* 底部中央同步控制栏 */}
      <div className="flex items-center justify-center border-t border-[var(--cine-line)] py-3">
        <Button
          variant="ghost"
          size="default"
          onClick={handleTogglePlay}
          className="gap-2 text-[var(--cine-text)] hover:text-[var(--cine-gold)]"
          aria-label={isPlaying ? '暂停同步播放' : '同步播放'}
        >
          {isPlaying ? (
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          <span className="text-sm">{isPlaying ? '暂停' : '同步播放'}</span>
        </Button>
      </div>
    </div>
  )
}

/**
 * 单个对比面板的 Props
 */
interface ComparePanelProps {
  version: {
    id: string
    versionNumber: number
    videoUrl: string
    promptExcerpt: string
    isCurrent: boolean
  }
  videoRef: React.RefObject<HTMLVideoElement | null>
  label: string
  onPlay: () => void
  onPause: () => void
  onSeeked: () => void
  onUseVersion: () => void
}

/**
 * 单个对比面板组件
 * 包含版本信息头部、视频播放器、"使用此版本"按钮
 */
function ComparePanel({
  version,
  videoRef,
  label,
  onPlay,
  onPause,
  onSeeked,
  onUseVersion,
}: ComparePanelProps) {
  return (
    <div
      className="flex flex-1 flex-col overflow-hidden rounded-lg border border-[var(--cine-line)] bg-[var(--cine-surface)]"
      role="group"
      aria-label={`对比面板 ${label}：版本 ${version.versionNumber}`}
    >
      {/* 面板头部：版本号 + prompt 摘要 */}
      <div className="flex items-center gap-2 border-b border-[var(--cine-line)] px-3 py-2">
        <Badge
          variant="default"
          className={
            version.isCurrent
              ? 'bg-[var(--cine-gold)] text-[var(--cine-ink)] text-xs'
              : 'bg-[var(--cine-bg-soft)] text-[var(--cine-text-2)] text-xs'
          }
        >
          版本 {version.versionNumber}
        </Badge>
        {version.isCurrent && (
          <span className="text-[10px] text-[var(--cine-gold)]">当前</span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--cine-text-2)]">
          {version.promptExcerpt}
        </span>
      </div>

      {/* 视频播放器 */}
      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          src={version.videoUrl}
          className="h-full w-full object-contain"
          controls
          preload="metadata"
          onPlay={onPlay}
          onPause={onPause}
          onSeeked={onSeeked}
          aria-label={`版本 ${version.versionNumber} 视频`}
        />
      </div>

      {/* 底部操作区 */}
      <div className="flex items-center justify-center border-t border-[var(--cine-line)] px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUseVersion}
          disabled={version.isCurrent}
          className={
            version.isCurrent
              ? 'cursor-not-allowed opacity-40 text-[var(--cine-text-3)]'
              : 'text-[var(--cine-gold)] hover:bg-[var(--cine-gold-dim)] hover:text-[var(--cine-gold)]'
          }
          aria-label={
            version.isCurrent
              ? '已是当前版本'
              : `使用版本 ${version.versionNumber}`
          }
        >
          {version.isCurrent ? '已是当前版本' : '使用此版本'}
        </Button>
      </div>
    </div>
  )
}
