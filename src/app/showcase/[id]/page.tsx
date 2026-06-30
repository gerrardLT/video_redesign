'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface CaseDetail {
  id: string
  title: string
  category: string
  description: string
  coverUrl: string
  originalVideoUrl: string
  generatedVideoUrl: string
  createdAt: string
}

export default function ShowcaseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [caseItem, setCaseItem] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const originalVideoRef = useRef<HTMLVideoElement>(null)
  const generatedVideoRef = useRef<HTMLVideoElement>(null)
  const isSyncing = useRef(false)

  useEffect(() => {
    if (!id) return

    fetch(`/api/showcase/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('案例不存在')
        return res.json()
      })
      .then((data) => setCaseItem(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // 同步播放/暂停控制
  useEffect(() => {
    const originalVideo = originalVideoRef.current
    const generatedVideo = generatedVideoRef.current
    if (!originalVideo || !generatedVideo) return

    const handlePlay = (source: HTMLVideoElement, target: HTMLVideoElement) => {
      return () => {
        if (isSyncing.current) return
        isSyncing.current = true
        target.play().catch(() => {})
        isSyncing.current = false
      }
    }

    const handlePause = (source: HTMLVideoElement, target: HTMLVideoElement) => {
      return () => {
        if (isSyncing.current) return
        isSyncing.current = true
        target.pause()
        isSyncing.current = false
      }
    }

    const handleSeek = (source: HTMLVideoElement, target: HTMLVideoElement) => {
      return () => {
        if (isSyncing.current) return
        isSyncing.current = true
        target.currentTime = source.currentTime
        isSyncing.current = false
      }
    }

    const onOriginalPlay = handlePlay(originalVideo, generatedVideo)
    const onOriginalPause = handlePause(originalVideo, generatedVideo)
    const onOriginalSeek = handleSeek(originalVideo, generatedVideo)

    const onGeneratedPlay = handlePlay(generatedVideo, originalVideo)
    const onGeneratedPause = handlePause(generatedVideo, originalVideo)
    const onGeneratedSeek = handleSeek(generatedVideo, originalVideo)

    originalVideo.addEventListener('play', onOriginalPlay)
    originalVideo.addEventListener('pause', onOriginalPause)
    originalVideo.addEventListener('seeked', onOriginalSeek)

    generatedVideo.addEventListener('play', onGeneratedPlay)
    generatedVideo.addEventListener('pause', onGeneratedPause)
    generatedVideo.addEventListener('seeked', onGeneratedSeek)

    return () => {
      originalVideo.removeEventListener('play', onOriginalPlay)
      originalVideo.removeEventListener('pause', onOriginalPause)
      originalVideo.removeEventListener('seeked', onOriginalSeek)

      generatedVideo.removeEventListener('play', onGeneratedPlay)
      generatedVideo.removeEventListener('pause', onGeneratedPause)
      generatedVideo.removeEventListener('seeked', onGeneratedSeek)
    }
  }, [caseItem])

  // 加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--cine-bg)] px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 h-8 w-24 animate-pulse rounded bg-[var(--cine-surface)]" />
          <div className="mb-4 h-10 w-2/3 animate-pulse rounded bg-[var(--cine-surface)]" />
          <div className="mb-8 h-6 w-1/2 animate-pulse rounded bg-[var(--cine-surface)]" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="aspect-video animate-pulse rounded-xl bg-[var(--cine-surface)]" />
            <div className="aspect-video animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          </div>
        </div>
      </div>
    )
  }

  // 错误状态
  if (error || !caseItem) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--cine-bg)] px-4">
        <svg
          className="mb-4 h-16 w-16 text-[var(--cine-text-3)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="mb-4 text-lg text-[var(--cine-text-2)]">{error || '案例不存在'}</p>
        <button
          onClick={() => router.push('/showcase')}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)]"
        >
          返回案例列表
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--cine-bg)] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        {/* 返回按钮 */}
        <button
          onClick={() => router.push('/showcase')}
          className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--cine-text-2)] transition-colors hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          返回案例列表
        </button>

        {/* 标题与描述 */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white md:text-3xl">
              {caseItem.title}
            </h1>
            <span className="shrink-0 rounded-full bg-[var(--cine-gold-dim)] px-3 py-1 text-xs font-medium text-[var(--cine-gold)]">
              {caseItem.category}
            </span>
          </div>
          <p className="text-sm text-[var(--cine-text-2)] md:text-base">{caseItem.description}</p>
        </div>

        {/* 视频对比区域 */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* 原视频 */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-[var(--cine-text-2)]">原视频</h3>
            <div className="overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)]">
              <video
                ref={originalVideoRef}
                src={caseItem.originalVideoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black"
              >
                您的浏览器不支持视频播放
              </video>
            </div>
          </div>

          {/* 生成视频 */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-[var(--cine-text-2)]">AI 重塑效果</h3>
            <div className="overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)]">
              <video
                ref={generatedVideoRef}
                src={caseItem.generatedVideoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black"
              >
                您的浏览器不支持视频播放
              </video>
            </div>
          </div>
        </div>

        {/* 同步提示 */}
        <p className="mt-4 text-center text-xs text-[var(--cine-text-3)]">
          播放控制已同步：播放/暂停/跳转其中一个视频时，另一个视频将自动同步
        </p>
      </div>
    </div>
  )
}
