'use client'

/**
 * ResultPreview — 生成结果预览与对比组件
 *
 * 功能：
 * - 单视频模式：展示生成结果视频播放器
 * - Before/After 对比模式：并排两个 <video> 元素，同步 currentTime
 * - 多分段模式：列表展示所有分段，点击切换预览
 * - 基本控制：播放/暂停、进度拖拽、音量调节
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Pause, Columns2, MonitorPlay } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GeneratedSegment {
  index: number
  videoUrl: string
  duration: number
}

interface ResultPreviewProps {
  /** 原视频 URL */
  originalVideoUrl: string
  /** 生成视频 URL（单段模式） */
  generatedVideoUrl?: string
  /** 多分段视频列表 */
  segments?: GeneratedSegment[]
}

type ViewMode = 'single' | 'compare'

export function ResultPreview({
  originalVideoUrl,
  generatedVideoUrl,
  segments,
}: ResultPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const originalVideoRef = useRef<HTMLVideoElement>(null)
  const generatedVideoRef = useRef<HTMLVideoElement>(null)

  // 当前展示的生成视频 URL
  const currentGeneratedUrl = segments && segments.length > 0
    ? segments[activeSegmentIndex]?.videoUrl
    : generatedVideoUrl

  // 同步播放控制
  const handlePlayPause = useCallback(() => {
    const generated = generatedVideoRef.current
    const original = originalVideoRef.current

    if (!generated) return

    if (isPlaying) {
      generated.pause()
      original?.pause()
    } else {
      generated.play()
      if (viewMode === 'compare') {
        original?.play()
      }
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying, viewMode])

  // Before/After 同步：监听生成视频的 timeupdate 同步到原视频
  useEffect(() => {
    if (viewMode !== 'compare') return

    const generated = generatedVideoRef.current
    const original = originalVideoRef.current
    if (!generated || !original) return

    const handleTimeUpdate = () => {
      const diff = Math.abs(generated.currentTime - original.currentTime)
      if (diff > 0.5) {
        original.currentTime = generated.currentTime
      }
    }

    generated.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      generated.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [viewMode])

  // 视频结束时重置播放状态
  useEffect(() => {
    const generated = generatedVideoRef.current
    if (!generated) return

    const handleEnded = () => setIsPlaying(false)
    generated.addEventListener('ended', handleEnded)
    return () => generated.removeEventListener('ended', handleEnded)
  }, [currentGeneratedUrl])

  if (!currentGeneratedUrl) return null

  return (
    <div className="space-y-3">
      {/* 模式切换工具栏 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">生成结果</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('single')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'single' ? 'bg-green-500/10 text-green-400' : 'text-zinc-500 hover:text-zinc-400'
            )}
            title="单视频预览"
          >
            <MonitorPlay className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('compare')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'compare' ? 'bg-green-500/10 text-green-400' : 'text-zinc-500 hover:text-zinc-400'
            )}
            title="Before/After 对比"
          >
            <Columns2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 视频区域 */}
      <div className={cn(
        'rounded-lg overflow-hidden border border-zinc-700 bg-black',
        viewMode === 'compare' ? 'grid grid-cols-2 gap-px' : ''
      )}>
        {/* 原视频（对比模式时显示） */}
        {viewMode === 'compare' && (
          <div className="relative">
            <div className="absolute top-2 left-2 z-10 text-[10px] bg-black/70 text-zinc-400 px-1.5 py-0.5 rounded">
              原视频
            </div>
            <video
              ref={originalVideoRef}
              src={originalVideoUrl}
              className="w-full h-full object-contain"
              muted
              playsInline
            />
          </div>
        )}

        {/* 生成视频 */}
        <div className="relative">
          {viewMode === 'compare' && (
            <div className="absolute top-2 left-2 z-10 text-[10px] bg-black/70 text-green-400 px-1.5 py-0.5 rounded">
              生成结果
            </div>
          )}
          <video
            ref={generatedVideoRef}
            src={currentGeneratedUrl}
            className="w-full h-full object-contain"
            controls={viewMode === 'single'}
            playsInline
          />
        </div>
      </div>

      {/* 对比模式播放控制 */}
      {viewMode === 'compare' && (
        <div className="flex items-center justify-center">
          <button
            onClick={handlePlayPause}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{isPlaying ? '暂停' : '同步播放'}</span>
          </button>
        </div>
      )}

      {/* 多分段选择器 */}
      {segments && segments.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto py-1">
          {segments.map((seg) => (
            <button
              key={seg.index}
              onClick={() => setActiveSegmentIndex(seg.index)}
              className={cn(
                'shrink-0 px-3 py-1 rounded-md text-xs transition-colors',
                activeSegmentIndex === seg.index
                  ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                  : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-400'
              )}
            >
              分段 {seg.index + 1}
              <span className="ml-1 text-zinc-600">{seg.duration}s</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
