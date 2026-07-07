'use client'

/**
 * ProgressIndicator — 生成进度动画组件
 *
 * 从 SSE Progress Store 订阅指定 taskId 的进度事件，展示：
 * - 脉冲环 CSS 动画
 * - 百分比进度条
 * - 预估剩余时间文本
 * - 终态时停止动画，展示成功/失败图标
 */

import { useMemo } from 'react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useSSEProgressStore } from '@/stores/sse-progress-store'
import { Progress } from '@/components/ui/progress'
import { formatRemainingTime } from '@/lib/shared/placeholder-utils'
import { cn } from '@/lib/shared/utils'

interface ProgressIndicatorProps {
  /** 任务 ID，从 SSE store 读取进度 */
  taskId: string
  /** 任务类型（固定为 generation） */
  taskType?: 'generation'
}

export function ProgressIndicator({ taskId }: ProgressIndicatorProps) {
  const progressMap = useSSEProgressStore((s) => s.progressMap)
  const isConnected = useSSEProgressStore((s) => s.isConnected)

  const event = progressMap.get(taskId)

  const progress = event?.progress ?? 0
  const estimatedRemaining = event?.estimatedRemainingSeconds
  const eventType = event?.eventType
  const stage = event?.stage

  // 判断任务状态
  const isCompleted = eventType === 'completed'
  const isFailed = eventType === 'failed' || eventType === 'chain_group_failed'
  const isTerminal = isCompleted || isFailed
  const isRunning = !isTerminal && (eventType === 'progress_update' || eventType === 'state_change')

  // 格式化剩余时间
  const remainingText = useMemo(() => {
    if (estimatedRemaining == null || estimatedRemaining <= 0) return null
    return formatRemainingTime(estimatedRemaining)
  }, [estimatedRemaining])

  return (
    <div className="space-y-3 py-3">
      {/* 状态头部 */}
      <div className="flex items-center gap-3">
        {/* 状态图标/动画 */}
        {isCompleted && (
          <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
        )}
        {isFailed && (
          <XCircle className="w-6 h-6 text-red-400 shrink-0" />
        )}
        {isRunning && (
          <div className="relative w-6 h-6 shrink-0">
            {/* 脉冲环动画 */}
            <div className="absolute inset-0 rounded-full border-2 border-green-500/30 animate-ping" />
            <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
          </div>
        )}
        {!event && (
          <div className="relative w-6 h-6 shrink-0">
            <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
          </div>
        )}

        {/* 状态文本 */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-medium',
            isCompleted && 'text-green-400',
            isFailed && 'text-red-400',
            isRunning && 'text-zinc-200',
            !event && 'text-zinc-400'
          )}>
            {isCompleted && '生成完成'}
            {isFailed && '生成失败'}
            {isRunning && (stage || '生成中...')}
            {!event && (!isConnected ? '连接中...' : '等待进度...')}
          </p>
          {remainingText && isRunning && (
            <p className="text-xs text-zinc-500">{remainingText}</p>
          )}
        </div>

        {/* 百分比数字 */}
        {isRunning && (
          <span className="text-sm font-mono text-green-400 tabular-nums">
            {Math.round(progress)}%
          </span>
        )}
      </div>

      {/* 进度条 */}
      {!isTerminal && (
        <Progress value={progress} className="h-1.5" />
      )}
    </div>
  )
}
