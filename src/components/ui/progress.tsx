'use client'

/**
 * Progress 进度条组件
 * 基于原生 HTML 结构 + Tailwind CSS 实现的进度条
 */
import { cn } from '@/lib/shared/utils'

interface ProgressProps {
  /** 进度值 (0-100) */
  value: number
  /** 自定义 className（应用于轨道容器） */
  className?: string
  /** 自定义指示器 className，默认使用全局绿色 */
  indicatorClassName?: string
}

export function Progress({ value, className, indicatorClassName }: ProgressProps) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full rounded-full overflow-hidden bg-[var(--ll-green)]/10', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-300 ease-out bg-[var(--ll-green)]', indicatorClassName)}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}
