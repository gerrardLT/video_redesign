'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ShotGroupInfo {
  id: string
  groupIndex: number
  genStatus: string
  genVideoUrl: string | null
  genDuration: number
}

interface ProjectInfo {
  id: string
  name: string
  status: string
  videoUrl: string | null
  exportedVideoUrl: string | null
  errorMsg: string | null
  shotGroups: ShotGroupInfo[]
}

export default function ExportPage() {
  const params = useParams()
  const projectId = params.id as string

  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(false)

  // 加载项目信息（含 shotGroups)
  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setProject(data.project)
      }
    } catch {
      // 忽略
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  // 轮询导出状态
  useEffect(() => {
    if (!polling) return

    const interval = setInterval(async () => {
      await loadProject()
      if (project?.status === 'EXPORTED' || project?.status === 'FAILED') {
        setPolling(false)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [polling, project?.status, loadProject])

  // 触发导出
  const handleExport = async () => {
    setExporting(true)
    setError('')

    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '导出失败')
        return
      }

      setPolling(true)
      await loadProject()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setExporting(false)
    }
  }

  // 重试导出
  const handleRetry = async () => {
    setError('')
    await handleExport()
  }

  // 统计（基于分镜组)
  const groups = project?.shotGroups || []
  const totalGroups = groups.length
  const completedGroups = groups.filter((g) => g.genStatus === 'SUCCEEDED').length
  const allCompleted = totalGroups > 0 && completedGroups === totalGroups
  const progressPercent = totalGroups > 0 ? Math.round((completedGroups / totalGroups) * 100) : 0

  return (
    <div className="min-h-screen bg-[#09090b] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* 头部 */}
        <div>
          <h1 className="text-xl font-semibold text-white">合并导出</h1>
          <p className="mt-1 text-sm text-[var(--cine-text-2)]">
            {project?.name || '加载中...'} — 将所有分镜组视频按顺序合并为一个完整视频
          </p>
          <p className="mt-1 text-xs text-[var(--cine-text-3)]">合并导出免费，不消耗积分</p>
        </div>

        {/* 分镜组时间线 */}
        <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--cine-text-2)]">分镜组时间线</h2>
          <div className="space-y-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--cine-line)] p-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cine-gold-dim)] text-xs font-medium text-[var(--cine-gold)]">
                  {group.groupIndex + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--cine-text-3)]">
                      第 {group.groupIndex + 1} 组 · {Math.round(group.genDuration)}s
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--cine-surface)]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        group.genStatus === 'SUCCEEDED'
                          ? 'bg-green-500'
                          : group.genStatus === 'GENERATING'
                          ? 'bg-purple-500 animate-pulse'
                          : group.genStatus === 'FAILED'
                          ? 'bg-red-500'
                          : 'bg-[var(--cine-surface)]'
                      }`}
                      style={{ width: group.genStatus === 'SUCCEEDED' ? '100%' : '0%' }}
                    />
                  </div>
                </div>
                <span
                  className={`text-[10px] font-medium ${
                    group.genStatus === 'SUCCEEDED'
                      ? 'text-[var(--cine-green)]'
                      : group.genStatus === 'FAILED'
                      ? 'text-red-400'
                      : 'text-[var(--cine-text-3)]'
                  }`}
                >
                  {group.genStatus === 'SUCCEEDED' ? '✓' : group.genStatus === 'FAILED' ? '✗' : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* 整体进度 */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-[var(--cine-text-2)]">
              已完成 {completedGroups}/{totalGroups} 个分镜组
            </span>
            <span className="text-xs font-medium text-[var(--cine-gold)]">{progressPercent}%</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[var(--cine-surface)]">
            <div
              className="h-full rounded-full bg-[var(--cine-gold)] transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 导出状态/操作 */}
        <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
          {project?.status === 'EXPORTED' && project.exportedVideoUrl ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-green-500/10 px-2 py-1 text-xs font-medium text-[var(--cine-green)]">
                  导出完成
                </span>
              </div>
              {/* 视频预览 */}
              <div className="overflow-hidden rounded-lg bg-black">
                <video
                  src={project.exportedVideoUrl}
                  controls
                  className="w-full"
                  playsInline
                />
              </div>
              {/* 下载按钮 */}
              <a
                href={project.exportedVideoUrl}
                download
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载视频
              </a>
            </div>
          ) : project?.status === 'GENERATING' || polling ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-purple-500/10 px-2 py-1 text-xs font-medium text-purple-400 animate-pulse">
                  合并中...
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--cine-surface)]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-purple-500/50" />
              </div>
              <p className="text-xs text-[var(--cine-text-3)]">正在合并分镜组视频，请稍候...</p>
            </div>
          ) : project?.status === 'FAILED' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400">
                  导出失败
                </span>
              </div>
              <p className="text-xs text-red-400/70">{project.errorMsg || '合并过程中出现错误'}</p>
              <button
                onClick={handleRetry}
                className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
              >
                重试导出
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {!allCompleted && (
                <p className="text-xs text-yellow-400/70">
                  还有 {totalGroups - completedGroups} 个分镜组未完成生成，请先完成所有分镜组
                </p>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                onClick={handleExport}
                disabled={!allCompleted || exporting}
                className="rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)] disabled:cursor-not-allowed disabled:bg-[var(--cine-gold)]/50 disabled:text-[var(--cine-text-2)]"
              >
                {exporting ? '提交中...' : '开始合并导出'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
