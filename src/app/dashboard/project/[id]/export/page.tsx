'use client'

/**
 * 导出页面
 *
 * 集成 ResolutionSelector 和 ExportStatusDisplay 组件，
 * 实现 3 秒间隔轮询 export-status API，连续 3 次失败后展示连接异常提示。
 * 导出按钮点击后调用 Export API 并携带 target_resolution。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { ResolutionSelector, type Resolution } from '@/components/export/ResolutionSelector'
import { ExportStatusDisplay, type ExportStatus } from '@/components/export/ExportStatusDisplay'

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

interface ExportStatusData {
  status: ExportStatus | null
  resolution: string | null
  videoUrl: string | null
  errorMessage: string | null
  refundedCredits: number | null
  createdAt: string | null
}

export default function ExportPage() {
  const params = useParams()
  const projectId = params.id as string

  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [selectedResolution, setSelectedResolution] = useState<Resolution>('480p')
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [exportStatus, setExportStatus] = useState<ExportStatusData | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const consecutiveFailsRef = useRef(0)
  const pollingRef = useRef(false)

  // 加载项目信息
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

  // 加载用户余额
  const loadBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/balance')
      if (res.ok) {
        const data = await res.json()
        setCreditBalance(data.balance)
      }
    } catch {
      // 余额查询失败不阻塞
    }
  }, [])

  // 轮询导出状态
  const pollExportStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/export-status`)
      if (res.ok) {
        const data = await res.json()
        setExportStatus(data)
        consecutiveFailsRef.current = 0
        setConnectionError(false)

        // 状态为终态时停止轮询
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          pollingRef.current = false
        }
      } else {
        consecutiveFailsRef.current++
        if (consecutiveFailsRef.current >= 3) {
          setConnectionError(true)
        }
      }
    } catch {
      consecutiveFailsRef.current++
      if (consecutiveFailsRef.current >= 3) {
        setConnectionError(true)
      }
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
    loadBalance()
  }, [loadProject, loadBalance])

  // 初始加载时也获取一次导出状态
  useEffect(() => {
    pollExportStatus()
  }, [pollExportStatus])

  // 3 秒轮询
  useEffect(() => {
    if (!pollingRef.current) return

    const interval = setInterval(() => {
      if (pollingRef.current) {
        pollExportStatus()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [pollExportStatus, exportStatus?.status])

  // 当 exportStatus 变为活跃状态时启动轮询
  useEffect(() => {
    if (exportStatus?.status === 'MERGING' || exportStatus?.status === 'UPSCALING') {
      pollingRef.current = true
    }
  }, [exportStatus?.status])

  // 触发导出
  const handleExport = async () => {
    setExporting(true)
    setError('')
    setConnectionError(false)
    consecutiveFailsRef.current = 0

    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_resolution: selectedResolution }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 402) {
          setError(`积分不足：需要 ${data.required} 积分，当前余额 ${data.current}`)
          await loadBalance()
        } else {
          setError(data.message || '导出失败')
        }
        return
      }

      // 导出已入队，开始轮询
      pollingRef.current = true
      setExportStatus({ status: 'MERGING', resolution: selectedResolution, videoUrl: null, errorMessage: null, refundedCredits: null, createdAt: null })
    } catch {
      setError('网络错误，请重试')
    } finally {
      setExporting(false)
    }
  }

  // 重试导出
  const handleRetry = () => {
    setExportStatus(null)
    setError('')
  }

  // 统计
  const groups = project?.shotGroups || []
  const totalGroups = groups.length
  const completedGroups = groups.filter((g) => g.genStatus === 'SUCCEEDED').length
  const allCompleted = totalGroups > 0 && completedGroups === totalGroups
  const progressPercent = totalGroups > 0 ? Math.round((completedGroups / totalGroups) * 100) : 0

  // 计算总时长
  const totalDuration = groups
    .filter((g) => g.genStatus === 'SUCCEEDED')
    .reduce((sum, g) => sum + (g.genDuration || 0), 0)

  // 720p/1080p 超分统一免费，不做积分阻断
  const insufficientCredits = false

  // 是否正在导出中（有活跃状态）
  const isExportActive = exportStatus?.status === 'MERGING' || exportStatus?.status === 'UPSCALING'

  return (
    <div className="min-h-screen bg-[#09090b] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* 头部 */}
        <div>
          <h1 className="text-xl font-semibold text-white">合并导出</h1>
          <p className="mt-1 text-sm text-[var(--cine-text-2)]">
            {project?.name || '加载中...'} — 将所有分镜组视频按顺序合并为一个完整视频
          </p>
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

        {/* 导出状态展示（活跃/已完成/已失败时） */}
        {exportStatus?.status && (
          <ExportStatusDisplay
            status={exportStatus.status}
            resolution={exportStatus.resolution ?? undefined}
            videoUrl={exportStatus.videoUrl ?? undefined}
            errorMessage={exportStatus.errorMessage ?? undefined}
            refundedCredits={exportStatus.refundedCredits}
            onRetry={handleRetry}
          />
        )}

        {/* 连接异常提示 */}
        {connectionError && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <p className="text-sm text-yellow-400">连接异常：无法获取导出状态，请检查网络连接</p>
          </div>
        )}

        {/* 分辨率选择器 + 导出按钮（无活跃导出时展示，已完成也可重新选择分辨率导出） */}
        {!isExportActive && (
          <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4 space-y-4">
            <ResolutionSelector
              totalDuration={totalDuration}
              onSelect={setSelectedResolution}
              selectedResolution={selectedResolution}
              creditBalance={creditBalance}
            />

            {!allCompleted && (
              <p className="text-xs text-yellow-400/70">
                还有 {totalGroups - completedGroups} 个分镜组未完成生成，请先完成所有分镜组
              </p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handleExport}
              disabled={!allCompleted || exporting || insufficientCredits}
              className="rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)] disabled:cursor-not-allowed disabled:bg-[var(--cine-gold)]/50 disabled:text-[var(--cine-text-2)]"
            >
              {exporting ? '提交中...' : insufficientCredits ? '积分不足' : exportStatus?.status === 'COMPLETED' ? '重新导出（选择新分辨率）' : '开始导出'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
