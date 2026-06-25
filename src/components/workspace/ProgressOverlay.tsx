'use client'

/**
 * 进度指示组件（非模态）
 *
 * 在创作卡片下方展示内联进度条，不阻塞其他操作。
 * 复用现有 useSSEProgress Hook 和 sse-progress-store。
 */

import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSSEProgressStore } from '@/stores/sse-progress-store'

const STAGE_LABELS: Record<string, string> = {
  QUEUED: '排队中...',
  GENERATING: '生成中...',
  SUBMITTED: '已提交...',
}

export function ProgressOverlay() {
  const currentJobId = useWorkspaceStore((s) => s.currentJobId)
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId)
  const generateStatus = useWorkspaceStore((s) => s.generateStatus)
  const setGenerateStatus = useWorkspaceStore((s) => s.setGenerateStatus)

  const progressMap = useSSEProgressStore((s) => s.progressMap)
  const progress = currentProjectId ? progressMap.get(currentProjectId) : null

  const stage = progress?.stage || 'GENERATING'
  const percent = progress?.progress || 0

  // 监听完成/失败事件
  useEffect(() => {
    if (!progress) return
    if (progress.eventType === 'completed') {
      setGenerateStatus('completed')
    } else if (progress.eventType === 'failed') {
      setGenerateStatus('failed')
    }
  }, [progress?.eventType, setGenerateStatus])

  if (generateStatus !== 'submitting' && generateStatus !== 'generating') {
    return null
  }

  return (
    <div className="w-full max-w-[720px] mx-auto mt-3 px-4">
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--cine-text-2)]">
            {STAGE_LABELS[stage] || '处理中...'}
          </span>
          <span className="text-xs text-[var(--cine-text-3)]">{percent}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-[var(--cine-line-2)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--cine-gold)] transition-all duration-500 relative overflow-hidden"
            style={{ width: `${Math.max(3, percent)}%` }}
          >
            {/* 斜条纹动画 */}
            <div
              className="absolute inset-0 animate-[shimmer_1.5s_linear_infinite]"
              style={{
                backgroundImage: 'linear-gradient(45deg, transparent 25%, rgba(255,255,255,0.15) 25%, rgba(255,255,255,0.15) 50%, transparent 50%, transparent 75%, rgba(255,255,255,0.15) 75%)',
                backgroundSize: '12px 12px',
              }}
            />
          </div>
        </div>
        {currentJobId && (
          <div className="text-[10px] text-[var(--cine-text-3)] mt-1.5">
            任务 {currentJobId.slice(0, 8)}...
          </div>
        )}
      </div>
    </div>
  )
}
