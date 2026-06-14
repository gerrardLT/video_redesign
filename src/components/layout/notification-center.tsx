'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ========================
// Types
// ========================

interface NotificationMeta {
  link?: string
  assetId?: string
  projectId?: string
  orderId?: string
  expiresAt?: string
  [key: string]: string | undefined
}

interface NotificationItem {
  id: string
  type: string
  title: string
  content: string
  meta: NotificationMeta | null
  isRead: boolean
  createdAt: string
}

// ========================
// 相对时间工具函数
// ========================

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const target = new Date(isoString).getTime()
  const diffMs = now - target

  if (diffMs < 0) return '刚刚'

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  if (days < 30) return `${Math.floor(days / 7)}周前`
  return `${Math.floor(days / 30)}个月前`
}

// ========================
// NotificationCenter 组件
// ========================

export function NotificationCenter() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 获取未读数量
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count)
      }
    } catch {
      // 静默失败，不影响用户体验
    }
  }, [])

  // 获取通知列表
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?pageSize=20')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications)
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }, [])

  // 每 30 秒轮询未读数量
  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [fetchUnreadCount])

  // 打开面板时加载通知列表
  useEffect(() => {
    if (isOpen) {
      fetchNotifications()
    }
  }, [isOpen, fetchNotifications])

  // 点击面板外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // 标记单条已读
  const handleMarkAsRead = async (notification: NotificationItem) => {
    if (!notification.isRead) {
      try {
        await fetch(`/api/notifications/${notification.id}/read`, {
          method: 'PATCH',
        })
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
        )
        setUnreadCount((prev) => Math.max(0, prev - 1))
      } catch {
        // 静默失败
      }
    }

    // 如果 meta 中有 link 则跳转
    if (notification.meta?.link) {
      setIsOpen(false)
      router.push(notification.meta.link)
    }
  }

  // 全部标记已读
  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/notifications/read-all', { method: 'PATCH' })
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch {
      // 静默失败
    }
  }

  return (
    <div className="relative">
      {/* 铃铛按钮 */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
        aria-label="通知中心"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* 未读数量徽标 */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 通知面板 */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-2xl sm:w-96"
          role="dialog"
          aria-label="通知列表"
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between border-b border-[var(--cine-line-2)] px-4 py-3">
            <h3 className="text-sm font-semibold text-white">通知</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-[var(--cine-gold)] transition-colors hover:text-[#818cf8]"
              >
                全部已读
              </button>
            )}
          </div>

          {/* 通知列表 */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--cine-line-2)] border-t-[var(--cine-gold)]" />
              </div>
            ) : notifications.length === 0 ? (
              /* 空状态 */
              <div className="flex flex-col items-center justify-center py-10 text-[var(--cine-text-3)]">
                <svg
                  className="mb-2 h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <span className="text-sm">暂无通知</span>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      onClick={() => handleMarkAsRead(notification)}
                      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--cine-surface)]"
                    >
                      {/* 未读状态指示 - 左侧蓝色圆点 */}
                      <div className="flex shrink-0 pt-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            notification.isRead ? 'bg-transparent' : 'bg-[var(--cine-gold)]'
                          }`}
                        />
                      </div>

                      {/* 通知内容 */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm leading-snug ${
                            notification.isRead ? 'text-[var(--cine-text-2)]' : 'font-medium text-white'
                          }`}
                        >
                          {notification.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--cine-text-3)]">
                          {notification.content}
                        </p>
                        <p className="mt-1 text-xs text-[var(--cine-text-3)]">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
