'use client'

/**
 * SubscriptionQuotaBar — 额度用量条
 *
 * 显示当前使用量/总额度，进度条颜色根据剩余百分比变化：
 * - 剩余 > 50%：绿色（充足）
 * - 剩余 20%-50%：黄色（提醒）
 * - 剩余 < 20%：红色（紧张）
 *
 * 暖色调、大圆角、大字体，面向非技术用户
 * Requirements: 15.2, 15.4
 */

import { cn } from '@/lib/utils'

interface SubscriptionQuotaBarProps {
  /** 当前已使用量 */
  current: number
  /** 额度上限 */
  limit: number
  /** 额度名称标签 (如 "视频生成次数") */
  label: string
}

export function SubscriptionQuotaBar({ current, limit, label }: SubscriptionQuotaBarProps) {
  // 计算使用百分比
  const usagePercent = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0
  // 剩余百分比
  const remainingPercent = 100 - usagePercent

  // 根据剩余百分比选择进度条颜色
  const barColor = getBarColor(remainingPercent)
  const textColor = getTextColor(remainingPercent)

  return (
    <div className="w-full space-y-2">
      {/* 标签和数值 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-amber-900">{label}</span>
        <span className={cn('text-sm font-bold', textColor)}>
          {current} / {limit}
        </span>
      </div>

      {/* 进度条 */}
      <div
        className="w-full h-3 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label}: 已使用 ${current}，共 ${limit}`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            barColor
          )}
          style={{ width: `${usagePercent}%` }}
        />
      </div>

      {/* 剩余提示 */}
      <p className={cn('text-xs', textColor)}>
        {remainingPercent > 50
          ? `还剩 ${limit - current} 次可用`
          : remainingPercent > 20
            ? `剩余不多了，还有 ${limit - current} 次`
            : remainingPercent > 0
              ? `即将用完，仅剩 ${limit - current} 次`
              : '额度已用完'
        }
      </p>
    </div>
  )
}

/** 根据剩余百分比返回进度条颜色 class */
function getBarColor(remainingPercent: number): string {
  if (remainingPercent > 50) return 'bg-green-400'
  if (remainingPercent > 20) return 'bg-yellow-400'
  return 'bg-red-400'
}

/** 根据剩余百分比返回文字颜色 class */
function getTextColor(remainingPercent: number): string {
  if (remainingPercent > 50) return 'text-green-700'
  if (remainingPercent > 20) return 'text-yellow-700'
  return 'text-red-600'
}
