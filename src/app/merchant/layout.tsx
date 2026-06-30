'use client'

/**
 * 商家专属布局组件
 *
 * 面向非技术用户（餐饮商家）的极简布局：
 * - 顶部 Header：门店名称 + 进入视频重塑模块入口 + 通知图标（直达任务/通知中心，带真实未读红点）
 * - 底部导航：首页、日历、今日任务、我的（均为门店作用域路由）
 * - 暖色调、大圆角、大字体风格
 *
 * 底部导航路由说明：
 * 实际页面均在门店作用域下（/merchant/stores/{storeId}/...），不存在
 * /merchant/calendar、/merchant/today、/merchant/profile 等顶层路由。
 * 因此导航项在运行时按当前 storeId 拼接：
 * - 首页 → /merchant/stores/{storeId}
 * - 日历 → /merchant/stores/{storeId}/calendar
 * - 今日任务 → /merchant/stores/{storeId}/today
 * - 我的 → /merchant/stores/{storeId}/settings
 * storeId 优先取自当前路径（保证导航停留在正在查看的门店），否则回退到
 * /api/merchant/me 返回的首个门店。尚未确定门店或处于问诊页（/merchant/onboarding）
 * 时隐藏底部导航，避免出现指向不存在路由的 404，并避免遮挡问诊页的主操作按钮。
 *
 * 主框架与模块导航（merchant-billing-unification Req 8）：
 * 本地生活营销平台为主框架，视频重塑（/dashboard）为其下的一个能力模块。
 * 已重新评估并解除 local-life-marketing-platform Req 15.5
 * 「/merchant 与 /dashboard 完全隔离、禁止从商家界面跳转到 dashboard」的约束：
 * 二者共用同一套账号、积分与订阅体系，middleware 对 /merchant 与 /dashboard
 * 注入同一套 x-user-id / x-user-role，已登录会话在两区间导航无需重新认证，
 * 因此在主框架顶部提供进入视频重塑模块的导航入口。视频重塑模块内部页面结构
 * 与交互保持不变，仅调整其在主框架中的导航归属。
 *
 * Requirements: merchant-billing-unification 1.1, 8.1, 8.2, 8.3, 8.4（原 local-life 15.4）
 */

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Calendar, ClipboardList, User, Bell, Clapperboard } from 'lucide-react'
import { StoreSwitcher } from '@/components/merchant'

/**
 * 底部导航项配置。
 * sub 为相对门店首页的子路径（首页为空串），运行时与 storeId 拼接成完整路由。
 */
const NAV_ITEMS = [
  { key: 'home', label: '首页', icon: Home, sub: '' },
  { key: 'calendar', label: '日历', icon: Calendar, sub: '/calendar' },
  { key: 'today', label: '今日任务', icon: ClipboardList, sub: '/today' },
  { key: 'settings', label: '我的', icon: User, sub: '/settings' },
] as const

interface StoreInfo {
  storeId: string
  storeName: string
}

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [store, setStore] = useState<StoreInfo | null>(null)

  useEffect(() => {
    // 获取商家门店信息（含 storeId，供底部导航拼接门店作用域路由）
    fetch('/api/merchant/me')
      .then((res) => {
        if (res.status === 401) throw new Error('未登录')
        if (!res.ok) throw new Error('请求失败')
        return res.json()
      })
      .then((data) => {
        if (!data.hasMerchant) {
          // 还没创建商家，跳转问诊页
          router.push('/merchant/onboarding')
          return
        }
        setStore({ storeId: data.storeId, storeName: data.storeName || '我的门店' })
      })
      .catch((err) => {
        if (err.message === '未登录') {
          router.push('/login?redirect=/merchant')
        }
      })
  }, [router])

  // 当前作用域 storeId：优先取路径中的 storeId（停留在正在查看的门店），否则用 me 接口返回的首个门店
  const pathStoreId = pathname.match(/^\/merchant\/stores\/([^/]+)/)?.[1]
  const storeId = pathStoreId ?? store?.storeId ?? null

  // 通知中心未读数（需求 9.3）：当前门店作用域，轮询 30s 兜底（任务中心页内 SSE 近实时刷新）。
  // 仅取未读红点展示用，failure 不影响布局渲染。
  const { data: notifData } = useSWR<{ notifications: { read: boolean }[] }>(
    storeId ? `/api/stores/${storeId}/notifications` : null,
    async (url: string) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error('请求失败')
      return res.json()
    },
    { revalidateOnFocus: true, refreshInterval: 30_000 }
  )
  const unreadCount = notifData?.notifications.filter((n) => !n.read).length ?? 0

  // 门店切换器可见性（需求 10.1, 10.4）：仅 maxStores>1 且实际多店时返回 multiStore=true。
  // 与 StoreSwitcher 组件共用同一 SWR key（自动去重），用于决定 Header 展示
  // 「可切换的门店名」还是「纯门店名」，避免两者重复渲染门店名。
  const { data: switcherData } = useSWR<
    { multiStore: false } | { multiStore: true; stores: { storeId: string; name: string }[] }
  >(
    '/api/stores/switcher',
    async (url: string) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error('请求失败')
      return res.json()
    },
    { revalidateOnFocus: false }
  )
  const multiStore = switcherData?.multiStore === true

  // 仅在已确定门店、且不在问诊页时展示底部导航（避免 404 与遮挡问诊页主按钮）
  const showBottomNav = Boolean(storeId) && !pathname.startsWith('/merchant/onboarding')

  /** 拼接门店作用域路由 */
  function buildHref(sub: string): string {
    return `/merchant/stores/${storeId}${sub}`
  }

  /** 判断当前导航项是否选中 */
  function isActive(sub: string): boolean {
    if (!storeId) return false
    const base = `/merchant/stores/${storeId}`
    // 首页精确匹配门店根路径；其余按子路径前缀匹配
    if (sub === '') return pathname === base
    return pathname.startsWith(base + sub)
  }

  return (
    <div className="ll-root min-h-screen flex flex-col">
      {/* 顶部 Header — 极简：门店名称 + 通知 */}
      <header className="sticky top-0 z-40 bg-[var(--ll-surface)]/90 backdrop-blur-sm border-b border-[var(--ll-hair)] safe-area-top">
        <div className="flex h-14 items-center justify-between px-4">
          {/* 门店名 / 门店切换器：多店且权益支持时展示可切换门店名（需求 10.1, 10.4），
              否则展示纯门店名，不出现空壳切换器 */}
          {multiStore && storeId ? (
            <StoreSwitcher
              currentStoreId={storeId}
              storeName={store?.storeName || '加载中...'}
            />
          ) : (
            <h1 className="text-lg font-semibold text-[var(--ll-green-sb)] truncate max-w-[55%]">
              {store?.storeName || '加载中...'}
            </h1>
          )}
          <div className="flex items-center gap-1">
            {/* 进入视频重塑模块入口 —— 解除原 local-life 15.5 隔离约束后新增 */}
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[var(--ll-green-sb)] hover:bg-[var(--ll-green-light)] transition-colors"
              aria-label="进入视频重塑"
            >
              <Clapperboard className="h-5 w-5" />
              <span className="text-sm font-medium">视频重塑</span>
            </button>
            <button
              className="relative p-2 rounded-full hover:bg-[var(--ll-green-light)] transition-colors disabled:opacity-40"
              aria-label="任务与通知"
              disabled={!storeId}
              onClick={() => storeId && router.push(`/merchant/stores/${storeId}/task-center`)}
            >
              <Bell className="h-5 w-5 text-[var(--ll-green-sb)]" />
              {/* 未读通知红点 —— 仅在存在未读通知时显示真实状态（需求 9.3） */}
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ll-danger)] px-1 text-[10px] font-medium leading-none text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 内容区域 — 展示底部导航时预留 pb-24 安全间距，否则仅常规内边距，避免遮挡主操作按钮 */}
      <main className={`flex-1 px-4 py-4 overflow-y-auto ${showBottomNav ? 'pb-24' : 'pb-4'}`}>
        {children}
      </main>

      {/* 底部导航 — 固定在屏幕底部；仅在已确定门店且非问诊页时展示 */}
      {showBottomNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--ll-surface)] border-t border-[var(--ll-hair)] safe-area-bottom">
          <div className="flex items-center justify-around h-16">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.sub)
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => router.push(buildHref(item.sub))}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-xl transition-colors ${
                    active
                      ? 'text-[var(--ll-green)]'
                      : 'text-[var(--ll-text-3)] hover:text-[var(--ll-green)]'
                  }`}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={`h-6 w-6 ${active ? 'stroke-[2.5]' : ''}`} />
                  <span className={`text-xs ${active ? 'font-semibold' : 'font-normal'}`}>
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        </nav>
      )}
    </div>
  )
}
