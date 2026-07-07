'use client'

/**
 * 任务 / 通知中心 — /merchant/stores/[storeId]/task-center
 *
 * 全局任务与通知中心前端（需求 9.2, 9.3, 9.4）。
 *
 * 功能：
 * - 任务中心：按「当前所选门店」作用域聚合进行中的任务（待拍摄 / 渲染中 / 待导出 / 待发布），
 *   每项点击直达对应可操作页面（shoot / variants 等），体现「可干预」（需求 9.4）。
 * - 近实时刷新（需求 9.2）：复用既有 progress-publisher（SSE）。通过 useSSEProgress 维持
 *   SSE 长连接，当收到任意进度事件（如渲染完成）时自动重新拉取任务中心数据，
 *   使状态变化近实时反映；SSE 不可用时按 SWR 兜底轮询。
 * - 通知中心：承接过期 / 发布 / 抓取失效 / 里程碑提醒，支持已读 / 未读（需求 9.3）；
 *   点击未读通知标记已读，若带 actionHref 则直达对应页面。
 *
 * 数据来源（后端已就绪，本页纯前端）：
 * - GET   /api/stores/{storeId}/task-center        进行中任务聚合（TaskCenterItem[]）
 * - GET   /api/stores/{storeId}/notifications       门店作用域通知列表（StoreNotification[]）
 * - PATCH /api/notifications/{notificationId}/read   标记通知已读
 *
 * 作用域：统一以路径中的 storeId 为作用域键，与门店切换器 / 通知中心一致，不跨店混合。
 *
 * Requirements: 9.2, 9.3, 9.4
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  Camera,
  Clapperboard,
  Download,
  Send,
  Bell,
  Inbox,
  ChevronRight,
  Loader2,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  Megaphone,
  Trophy,
  CalendarClock,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useSSEProgress } from '@/hooks/use-sse-progress'
import { useSSEProgressStore } from '@/stores/sse-progress-store'
import { toast } from 'sonner'

// ========================
// 数据获取
// ========================

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || '请求失败')
  }
  return res.json()
}

// ========================
// 类型（对应后端 task-center-service / StoreNotification）
// ========================

/** 任务中心条目（对应 TaskCenterItem） */
interface TaskCenterItem {
  type: 'SHOOT' | 'RENDER' | 'EXPORT' | 'PUBLISH'
  briefId: string
  variantId?: string
  status: string
  actionHref: string
}

/** 门店作用域通知（对应 Prisma StoreNotification） */
interface StoreNotification {
  id: string
  storeId: string
  type: string
  title: string
  body: string
  actionHref: string | null
  read: boolean
  createdAt: string
}

// ========================
// 展示常量
// ========================

/** 任务类型 → 图标 + 主题色（卡片左侧图标） */
const TASK_META: Record<
  TaskCenterItem['type'],
  { icon: typeof Camera; color: string; bg: string }
> = {
  SHOOT: { icon: Camera, color: 'text-[var(--ll-green)]', bg: 'bg-[var(--ll-green-light)]' },
  RENDER: { icon: Clapperboard, color: 'text-[var(--ll-info)]', bg: 'bg-[var(--ll-info-dim)]' },
  EXPORT: { icon: Download, color: 'text-purple-600', bg: 'bg-purple-100' },
  PUBLISH: { icon: Send, color: 'text-[var(--ll-gold-ink)]', bg: 'bg-[var(--ll-gold-lightest)]' },
}

/** 任务类型 → 主操作按钮文案 */
const TASK_ACTION_LABEL: Record<TaskCenterItem['type'], string> = {
  SHOOT: '去拍摄',
  RENDER: '查看进度',
  EXPORT: '去导出',
  PUBLISH: '去发布',
}

/** 通知类型 → 图标 + 主题色 */
const NOTIFICATION_META: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  EXPIRY: { icon: CalendarClock, color: 'text-[var(--ll-danger)]', bg: 'bg-[var(--ll-danger-dim)]' },
  PUBLISH_REMINDER: { icon: Megaphone, color: 'text-[var(--ll-warning)]', bg: 'bg-[var(--ll-warning-dim)]' },
  CRAWL_FAILED: { icon: AlertTriangle, color: 'text-[var(--ll-warning)]', bg: 'bg-[var(--ll-warning-dim)]' },
  MILESTONE: { icon: Trophy, color: 'text-[var(--ll-gold-ink)]', bg: 'bg-[var(--ll-gold-lightest)]' },
}

/** 标签页 */
type TabKey = 'TASKS' | 'NOTIFICATIONS'

// ========================
// 工具函数
// ========================

/** 格式化相对时间（刚刚 / X 分钟前 / X 小时前 / X月X日 HH:mm） */
function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const t = new Date(iso).getTime()
  const diffMin = Math.floor((now - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} 小时前`
  const d = new Date(iso)
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${mm}`
}

// ========================
// 主页面
// ========================

export default function TaskCenterPage() {
  const params = useParams<{ storeId: string }>()
  const storeId = params.storeId
  const router = useRouter()

  const [tab, setTab] = useState<TabKey>('TASKS')

  // 任务中心数据：SSE 兜底轮询 30s（SSE 正常时主要靠事件驱动刷新）
  const {
    data: taskData,
    error: taskError,
    isLoading: taskLoading,
    mutate: mutateTasks,
  } = useSWR<{ tasks: TaskCenterItem[] }>(
    storeId ? `/api/stores/${storeId}/task-center` : null,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 30_000 }
  )

  // 通知中心数据
  const {
    data: notifData,
    error: notifError,
    isLoading: notifLoading,
    mutate: mutateNotifs,
  } = useSWR<{ notifications: StoreNotification[] }>(
    storeId ? `/api/stores/${storeId}/notifications` : null,
    fetcher,
    { revalidateOnFocus: true }
  )

  // ─── SSE 近实时刷新（需求 9.2）───
  // 复用既有 progress-publisher（SSE）：维持长连接并订阅进度事件 store。
  // token 传 storeId 作为「启用」开关（实际鉴权由同源 Cookie + middleware 注入 x-user-id 完成，
  // 与 shoot 页一致）；任意进度事件到达即重新拉取任务中心，使渲染完成等状态近实时反映。
  const { isConnected } = useSSEProgress(storeId ?? null, true)
  const progressMap = useSSEProgressStore((s) => s.progressMap)

  useEffect(() => {
    // progressMap 引用变化 = 收到新的进度事件 → 刷新任务中心
    if (progressMap.size > 0) {
      mutateTasks()
    }
  }, [progressMap, mutateTasks])

  const tasks = taskData?.tasks ?? []
  const notifications = notifData?.notifications ?? []
  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* 标题 + SSE 连接状态 — v3 Zen: serif 标题 */}
      <div className="flex items-center justify-between pt-1 zen-reveal">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
          <h1 className="text-[var(--text-title)] font-semibold font-[var(--font-serif)]">任务与通知</h1>
        </div>
        {/* 近实时连接状态指示（需求 9.2）：连接时显示实时，断连回退轮询刷新 */}
        <span
          className={`flex items-center gap-1 text-[11px] ${
            isConnected ? 'text-[var(--ll-green)]' : 'text-[var(--ll-text-3)]'
          }`}
          title={isConnected ? '已连接，状态实时刷新' : '未连接，定时刷新中'}
        >
          {isConnected ? <Wifi className="h-3.5 w-3.5" strokeWidth={1.5} /> : <WifiOff className="h-3.5 w-3.5" strokeWidth={1.5} />}
          {isConnected ? '实时' : '定时刷新'}
        </span>
      </div>

      {/* 标签切换 — v3 Zen: 绿色选中态 */}
      <div className="flex gap-2 zen-reveal">
        <Button
          type="button"
          variant={tab === 'TASKS' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('TASKS')}
        >
          进行中任务 {tasks.length > 0 ? tasks.length : ''}
        </Button>
        <Button
          type="button"
          variant={tab === 'NOTIFICATIONS' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('NOTIFICATIONS')}
        >
          通知 {unreadCount > 0 ? `· ${unreadCount} 未读` : ''}
        </Button>
      </div>

      {tab === 'TASKS' ? (
        <TaskList
          tasks={tasks}
          isLoading={taskLoading}
          error={taskError as Error | undefined}
          onRetry={() => mutateTasks()}
          onOpen={(href) => router.push(href)}
        />
      ) : (
        <NotificationList
          storeId={storeId}
          notifications={notifications}
          isLoading={notifLoading}
          error={notifError as Error | undefined}
          onRetry={() => mutateNotifs()}
          onChanged={() => mutateNotifs()}
          onNavigate={(href) => router.push(href)}
        />
      )}
    </div>
  )
}

// ========================
// 任务列表
// ========================

function TaskList({
  tasks,
  isLoading,
  error,
  onRetry,
  onOpen,
}: {
  tasks: TaskCenterItem[]
  isLoading: boolean
  error?: Error
  onRetry: () => void
  onOpen: (href: string) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-red-500">{error.message || '加载失败'}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Inbox className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">当前没有进行中的任务</p>
        <p className="text-xs text-gray-400">待拍摄、渲染中、待导出、待发布的内容会出现在这里</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tasks.map((task, idx) => {
        const meta = TASK_META[task.type]
        const Icon = meta.icon
        return (
          <Card
            key={`${task.type}-${task.briefId}-${task.variantId ?? idx}`}
            className="flex items-center gap-3 rounded-2xl border-gray-100 p-4 cursor-pointer transition-colors hover:border-amber-200 hover:bg-amber-50/40"
            onClick={() => onOpen(task.actionHref)}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.bg}`}
            >
              {task.type === 'RENDER' ? (
                <Loader2 className={`h-5 w-5 animate-spin ${meta.color}`} />
              ) : (
                <Icon className={`h-5 w-5 ${meta.color}`} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800">{task.status}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {TASK_ACTION_LABEL[task.type]} ›
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" />
          </Card>
        )
      })}
    </div>
  )
}

// ========================
// 通知列表
// ========================

function NotificationList({
  storeId,
  notifications,
  isLoading,
  error,
  onRetry,
  onChanged,
  onNavigate,
}: {
  storeId: string
  notifications: StoreNotification[]
  isLoading: boolean
  error?: Error
  onRetry: () => void
  onChanged: () => void
  onNavigate: (href: string) => void
}) {
  const [marking, setMarking] = useState<string | null>(null)

  /** 标记单条已读（如带 actionHref 则跳转） */
  async function handleClick(n: StoreNotification) {
    // 已读通知直接跳转（若有目标页）
    if (n.read) {
      if (n.actionHref) onNavigate(n.actionHref)
      return
    }
    setMarking(n.id)
    try {
      const res = await fetch(`/api/stores/${storeId}/notifications/${n.id}/read`, { method: 'PATCH' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error?.message || '标记已读失败')
        return
      }
      onChanged()
      if (n.actionHref) onNavigate(n.actionHref)
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setMarking(null)
    }
  }

  /** 一键全部标记已读 */
  async function handleMarkAll() {
    const unread = notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    setMarking('ALL')
    try {
      await Promise.all(
        unread.map((n) =>
          fetch(`/api/stores/${storeId}/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => null)
        )
      )
      onChanged()
      toast.success('已全部标记为已读')
    } finally {
      setMarking(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-red-500">{error.message || '加载失败'}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Bell className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">暂无通知</p>
      </div>
    )
  }

  const hasUnread = notifications.some((n) => !n.read)

  return (
    <div className="space-y-3">
      {/* 全部已读 */}
      {hasUnread && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-amber-600 hover:text-amber-700"
            onClick={handleMarkAll}
            disabled={marking === 'ALL'}
          >
            {marking === 'ALL' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            全部标记已读
          </Button>
        </div>
      )}

      {notifications.map((n) => {
        const meta = NOTIFICATION_META[n.type] ?? {
          icon: Bell,
          color: 'text-gray-500',
          bg: 'bg-gray-100',
        }
        const Icon = meta.icon
        return (
          <Card
            key={n.id}
            className={`flex items-start gap-3 rounded-2xl p-4 transition-colors ${
              n.read
                ? 'border-gray-100 bg-white'
                : 'border-amber-200 bg-amber-50/50'
            } ${n.actionHref || !n.read ? 'cursor-pointer hover:border-amber-300' : ''}`}
            onClick={() => handleClick(n)}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.bg}`}
            >
              <Icon className={`h-4 w-4 ${meta.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-gray-800">{n.title}</p>
                {!n.read && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="未读" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{n.body}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(n.createdAt)}
                </span>
                {n.actionHref && (
                  <Badge variant="outline" className="border-amber-200 text-[10px] text-amber-600">
                    点击查看
                  </Badge>
                )}
              </div>
            </div>
            {marking === n.id && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
          </Card>
        )
      })}
    </div>
  )
}
