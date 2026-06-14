'use client'

// ========================
// Types
// ========================

type ExpiryStatus = 'safe' | 'warning' | 'urgent' | 'today' | 'expired'

interface AssetExpiryBadgeProps {
  expiresAt: string | null // ISO 日期字符串
  status: string
  onRegenerate?: () => void
}

// ========================
// 辅助函数
// ========================

/**
 * 计算剩余有效天数
 * @returns 剩余天数，0 表示今日过期或已过期
 */
export function getRemainingDays(expiresAt: string | null): number {
  if (!expiresAt) return 0
  const now = new Date()
  const expiry = new Date(expiresAt)
  const diff = expiry.getTime() - now.getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

/**
 * 获取过期状态类型
 * @returns ExpiryStatus 枚举值
 */
export function getExpiryStatus(expiresAt: string | null, status: string): ExpiryStatus {
  // 已标记为 EXPIRED 或无过期时间且状态为 EXPIRED
  if (status === 'EXPIRED') return 'expired'

  if (!expiresAt) return 'safe'

  const now = new Date()
  const expiry = new Date(expiresAt)

  // 已过期
  if (expiry <= now) return 'expired'

  const days = getRemainingDays(expiresAt)

  if (days < 1) return 'today'
  if (days <= 3) return 'urgent'
  if (days <= 7) return 'warning'
  return 'safe'
}

// ========================
// AssetExpiryBadge Component
// ========================

export default function AssetExpiryBadge({
  expiresAt,
  status,
  onRegenerate,
}: AssetExpiryBadgeProps) {
  const expiryStatus = getExpiryStatus(expiresAt, status)
  const remainingDays = getRemainingDays(expiresAt)

  return (
    <div className="flex items-center gap-2">
      {/* 有效期状态标签 */}
      <ExpiryLabel expiryStatus={expiryStatus} remainingDays={remainingDays} />

      {/* 已过期时展示操作区域 */}
      {expiryStatus === 'expired' && (
        <div className="flex items-center gap-2">
          {/* 禁用下载按钮 */}
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md bg-[var(--cine-surface)] px-2.5 py-1 text-xs text-gray-500 opacity-50"
            title="资产已过期，无法下载"
          >
            <DownloadIcon />
            下载
          </button>

          {/* 重新生成入口 */}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--cine-gold)] px-2.5 py-1 text-xs font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)]"
            >
              <RegenerateIcon />
              重新生成
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ========================
// 内部子组件
// ========================

function ExpiryLabel({
  expiryStatus,
  remainingDays,
}: {
  expiryStatus: ExpiryStatus
  remainingDays: number
}) {
  switch (expiryStatus) {
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
          <ExpiredIcon />
          已过期
        </span>
      )
    case 'today':
      return (
        <span className="text-xs font-medium text-red-400">
          今日过期
        </span>
      )
    case 'urgent':
      return (
        <span className="text-xs font-medium text-orange-400">
          即将过期（{remainingDays}天)
        </span>
      )
    case 'warning':
      return (
        <span className="text-xs font-medium text-yellow-400">
          剩余 {remainingDays} 天
        </span>
      )
    case 'safe':
      return (
        <span className="text-xs font-medium text-[var(--cine-green)]">
          剩余 {remainingDays} 天
        </span>
      )
    default:
      return null
  }
}

// ========================
// SVG 图标组件
// ========================

function ExpiredIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function RegenerateIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
