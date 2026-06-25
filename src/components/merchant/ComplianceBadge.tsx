'use client'

/**
 * ComplianceBadge — 合规状态徽章
 *
 * 根据 riskLevel 显示不同颜色和文案：
 * - LOW = 绿色 "合规通过"
 * - MEDIUM = 黄色 "有小问题"
 * - HIGH = 橙色 "有风险"
 * - BLOCKED = 红色 "不能发布"
 *
 * 暖色调、大圆角、大字体，面向非技术用户
 * Requirements: 15.2, 15.4
 * 隐藏所有技术参数，使用日常用语
 */

import { Check, AlertTriangle, ShieldAlert, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComplianceRiskLevel } from '@/types/merchant'

interface ComplianceBadgeProps {
  /** 合规风险等级 */
  riskLevel: ComplianceRiskLevel
}

/** 各风险等级的展示配置 */
const RISK_CONFIG: Record<ComplianceRiskLevel, {
  Icon: typeof Check
  label: string
  bgClass: string
  iconClass: string
  textClass: string
}> = {
  LOW: {
    Icon: Check,
    label: '合规通过',
    bgClass: 'bg-green-50 border border-green-200',
    iconClass: 'text-green-600',
    textClass: 'text-green-700',
  },
  MEDIUM: {
    Icon: AlertTriangle,
    label: '有小问题',
    bgClass: 'bg-yellow-50 border border-yellow-200',
    iconClass: 'text-yellow-600',
    textClass: 'text-yellow-700',
  },
  HIGH: {
    Icon: ShieldAlert,
    label: '有风险',
    bgClass: 'bg-orange-50 border border-orange-200',
    iconClass: 'text-orange-600',
    textClass: 'text-orange-700',
  },
  BLOCKED: {
    Icon: Ban,
    label: '不能发布',
    bgClass: 'bg-red-50 border border-red-200',
    iconClass: 'text-red-600',
    textClass: 'text-red-700',
  },
}

export function ComplianceBadge({ riskLevel }: ComplianceBadgeProps) {
  const config = RISK_CONFIG[riskLevel]

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium',
        config.bgClass
      )}
      role="status"
      aria-label={`合规状态: ${config.label}`}
    >
      <config.Icon className={cn('h-4 w-4', config.iconClass)} />
      <span className={config.textClass}>{config.label}</span>
    </div>
  )
}
