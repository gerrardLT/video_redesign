'use client'

/**
 * QualityReportBadge — 质量检测结果徽章
 *
 * 显示质量评分 + 通过/不通过状态
 * - 通过(passed=true)：绿色背景 + 勾号
 * - 不通过(passed=false)：红色/橙色背景 + 提示
 * - 致命问题(critical=true)：红色强调
 *
 * 暖色调、大圆角、大字体，面向非技术用户
 * Requirements: 15.2, 15.4
 * 隐藏所有技术参数，使用日常用语
 */

import { Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/shared/utils'

interface QualityReportBadgeProps {
  /** 质量评分 (0-100) */
  score: number
  /** 是否通过检测 */
  passed: boolean
  /** 是否有致命问题 */
  critical: boolean
}

export function QualityReportBadge({ score, passed, critical }: QualityReportBadgeProps) {
  // 根据状态决定展示样式
  const statusConfig = getStatusConfig(passed, critical)

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
        statusConfig.bgClass
      )}
      role="status"
      aria-label={`质量检测: ${statusConfig.label}，评分 ${score} 分`}
    >
      {/* 状态图标 */}
      <statusConfig.Icon className={cn('h-4 w-4', statusConfig.iconClass)} />

      {/* 评分 */}
      <span className={statusConfig.textClass}>{score}分</span>

      {/* 状态文案 */}
      <span className={cn('text-xs', statusConfig.textClass)}>
        {statusConfig.label}
      </span>
    </div>
  )
}

/** 根据 passed/critical 返回状态配置 */
function getStatusConfig(passed: boolean, critical: boolean) {
  if (passed) {
    return {
      Icon: Check,
      label: '合格',
      bgClass: 'bg-green-50 border border-green-200',
      iconClass: 'text-green-600',
      textClass: 'text-green-700',
    }
  }

  if (critical) {
    return {
      Icon: X,
      label: '需重拍',
      bgClass: 'bg-red-50 border border-red-200',
      iconClass: 'text-red-600',
      textClass: 'text-red-700',
    }
  }

  return {
    Icon: AlertTriangle,
    label: '待改善',
    bgClass: 'bg-amber-50 border border-amber-200',
    iconClass: 'text-amber-600',
    textClass: 'text-amber-700',
  }
}
