'use client'

/**
 * Progress 进度条组件
 * 基于原生 HTML 结构 + Tailwind CSS 实现的进度条
 */
import { cn } from '@/lib/utils'

interface ProgressProps {
  /** 进度值 (0-100) */
  value: number
  /** 自定义 className */
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full rounded-full bg-zinc-800 overflow-hidden', className)}
    >
      <div
        className="h-full rounded-full bg-green-500 transition-all duration-300 ease-out"
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}
