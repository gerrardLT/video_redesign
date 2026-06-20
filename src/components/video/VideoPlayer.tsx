'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

interface VideoPlayerProps {
  src: string
  poster?: string
  className?: string
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function VideoPlayer({ src, poster, className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      // play() 返回 Promise，失败时（如被 pause 中断或资源需重新加载）回退状态
      const playPromise = video.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true)
          })
          .catch(() => {
            // 播放失败（资源被释放、被中断等）—— 尝试重新加载后播放
            video.load()
            video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
          })
      }
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video || isSeeking) return
    setCurrentTime(video.currentTime)
  }, [isSeeking])

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setDuration(video.duration)
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const time = parseFloat(e.target.value)
    video.currentTime = time
    setCurrentTime(time)
  }, [])

  const handleEnded = useCallback(() => {
    setIsPlaying(false)
  }, [])

  /**
   * 处理视频加载/播放错误：自动尝试重新加载（解决长时间挂起后连接断开无法播放的问题）
   * 浏览器在页面空闲时可能关闭 HTTP Range 连接，导致 <video> 进入 error 状态
   */
  const handleError = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    // 尝试重新加载视频资源
    const currentPos = video.currentTime
    video.load()
    // 加载完成后恢复到之前的播放位置
    const onLoaded = () => {
      video.currentTime = currentPos
      video.removeEventListener('loadedmetadata', onLoaded)
    }
    video.addEventListener('loadedmetadata', onLoaded)
    setIsPlaying(false)
  }, [])

  /**
   * 处理视频缓冲停滞：当浏览器 3 秒未收到数据时触发
   * 通常是连接断开或网络抖动，尝试 load() 恢复
   */
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleStalled = useCallback(() => {
    // 延迟 5 秒后如果仍在 stalled 状态则触发重新加载
    if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current)
    stalledTimerRef.current = setTimeout(() => {
      const video = videoRef.current
      if (!video || !video.paused) return // 如果已经恢复播放则不处理
      if (video.readyState < 3) { // HAVE_FUTURE_DATA
        handleError()
      }
    }, 5000)
  }, [handleError])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('error', handleError)
    video.addEventListener('stalled', handleStalled)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('error', handleError)
      video.removeEventListener('stalled', handleStalled)
      if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current)
    }
  }, [handleTimeUpdate, handleLoadedMetadata, handleEnded, handleError, handleStalled])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`group relative overflow-hidden rounded-xl bg-black ${className}`}>
      {/* Video element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="h-full w-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Progress bar */}
        <div className="mb-2">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            onMouseDown={() => setIsSeeking(true)}
            onMouseUp={() => setIsSeeking(false)}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--cine-gold)]"
            style={{
              background: `linear-gradient(to right, var(--cine-gold) ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
            }}
            aria-label="视频进度"
          />
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Play/Pause button */}
            <button
              onClick={togglePlay}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cine-surface)] text-white transition-colors hover:bg-[var(--cine-line-2)]"
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Time display */}
            <span className="text-xs text-[var(--cine-text-2)]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Big play button (center, when paused) */}
      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="播放"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--cine-gold)]/80 text-[var(--cine-ink)] backdrop-blur-sm">
            <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
  )
}
