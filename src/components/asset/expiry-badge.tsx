'use client'

import type { ExpiryStatus } from '@/lib/expiry-status'

/**
 * 资产过期状态徽章组件
 *
 * 根据 ExpiryStatus 展示四种状态标签：
 * - permanent: 绿色标签 "永久"
 * - expiring_soon: 红色标签 "{N}天后过期"
 * - active: 默认/中性标签 "剩余{N}天"
 * - expired: 灰色标签 "已过期"
 */

interface ExpiryBadgeProps {
  /** 过期状态 */
  status: ExpiryStatus
  /** 剩余天数（permanent 和 expired 时为 null） */
  remainingDays: number | null
}

export default function ExpiryBadge({ status, remainingDays }: ExpiryBadgeProps) {
  switch (status) {
    case 'permanent':
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--cine-green)]/15 px-2 py-0.5 text-xs font-medium text-[var(--cine-green)]">
          永久
        </span>
      )

    case 'expiring_soon':
      return (
        <span className="inline-flex items-center rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
          {remainingDays}天后过期
        </span>
      )

    case 'active':
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--cine-surface)]/60 px-2 py-0.5 text-xs font-medium text-[var(--cine-text-secondary)]">
          剩余{remainingDays}天
        </span>
      )

    case 'expired':
      return (
        <span className="inline-flex items-center rounded-md bg-gray-500/15 px-2 py-0.5 text-xs font-medium text-gray-400">
          已过期
        </span>
      )

    default:
      return null
  }
}
