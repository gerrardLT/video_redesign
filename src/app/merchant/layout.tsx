'use client'

/**
 * 商家专属布局组件 — 热店 STUDIO · Runway 暗色
 *
 * 视觉语言：Runway（纯黑 #000 / 暗底 #1a1a1a，零阴影，深度靠明暗分区与影像）
 * - 顶部 Header：纯黑底 + 1px #27272a 分隔线 + 门店名 + 通知铃铛
 * - 底部导航：暗色毛玻璃 rgba(0,0,0,.72) + backdrop-blur(20px) + 选中态纯白
 *   tab 标签 uppercase + 字距，禁止 bounce 动画、语义化 aria-label
 * - 字体：DM Sans (Latin) + Noto Sans SC (CJK)
 *
 * 底部导航路由说明：
 * 实际页面均在门店作用域下（/merchant/stores/{storeId}/...），不存在
 * /merchant/calendar、/merchant/today、/merchant/profile 等顶层路由。
 * 因此导航项在运行时按当前 storeId 拼接：
 * - 工作台 → /merchant/stores/{storeId}
 * - 日历 → /merchant/stores/{storeId}/calendar
 * - 我的 → /merchant/stores/{storeId}/settings
 * storeId 优先取自当前路径，否则回退到 /api/merchant/me 返回的首个门店。
 * 尚未确定门店或处于问诊页（/merchant/onboarding）时隐藏底部导航。
 *
 * 主框架：
 * 本地生活营销平台为唯一产品线。视频重塑已下线独立前端，仅作为封存的后端
 * 视频生成能力（src/lib + src/workers）保留，供后续商家渲染按需接入。
 * 账号、积分与订阅体系统一，middleware 注入同一套 x-user-id / x-user-role。
 */

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Calendar, User, Bell, LogOut, ArrowLeft } from 'lucide-react'
import { DM_Sans, Noto_Sans_SC } from 'next/font/google'
import { StoreSwitcher } from '@/components/merchant'

/**
 * 字体加载配置 — Runway 暗色无衬线体系
 * - DM Sans: Latin 文字（tabular-nums 数字展示）
 * - Noto Sans SC: CJK 中文（无衬线体）
 */
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const notoSans = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-sc',
  display: 'swap',
})

/**
 * 底部导航项配置。
 * sub 为相对门店首页的子路径（首页为空串），运行时与 storeId 拼接成完整路由。
 */
const NAV_ITEMS = [
  { key: 'home', label: '首页', icon: Home, sub: '' },
  { key: 'calendar', label: '日历', icon: Calendar, sub: '/calendar' },
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

  // 子页面简化 Header：在 brief 详情/拍摄/成片/复盘等子页内，用返回箭头替代门店名
  const isSubPage = storeId != null && /\/briefs\/[^/]+/.test(pathname)

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
    <div className={`ll-root min-h-screen flex flex-col ${dmSans.variable} ${notoSans.variable}`}>
      {/* 顶部 Header — 子页面简化为返回箭头，其余展示完整门店名 + 通知 */}
      <header className="sticky top-0 z-40 bg-[var(--ll-surface)]/90 backdrop-blur-sm border-b border-[var(--ll-hair)] safe-area-top">
        <div className="flex h-14 items-center justify-between px-4">
          {isSubPage ? (
            <>
              {/* 简化 Header：返回箭头 */}
              <button
                onClick={() => router.back()}
                className="flex items-center gap-1 text-[var(--ll-text-2)] hover:text-[var(--ll-text)] transition-colors"
                aria-label="返回"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
                <span className="text-sm font-medium">返回</span>
              </button>
              {/* 通知铃铛保留 */}
              <button
                className="relative p-2 rounded-full hover:bg-[var(--ll-green-light)] transition-colors"
                aria-label="任务与通知"
                onClick={() => storeId && router.push(`/merchant/stores/${storeId}/task-center`)}
              >
                <Bell className="h-5 w-5 text-[var(--ll-green-sb)]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ll-danger)] px-1 text-[10px] font-medium leading-none text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </>
          ) : (
            <>
              {/* 门店名 / 门店切换器 */}
              {multiStore && storeId ? (
                <StoreSwitcher
                  currentStoreId={storeId}
                  storeName={store?.storeName || '加载中...'}
                />
              ) : (
                <h1 className="font-[var(--font-serif)] text-[18px] font-semibold tracking-[.02em] text-[var(--ll-green-sb)] truncate max-w-[55%]">
                  {store?.storeName || '加载中...'}
                </h1>
              )}
              <div className="flex items-center gap-1">
                <button
                  className="relative p-2 rounded-full hover:bg-[var(--ll-green-light)] transition-colors disabled:opacity-40"
                  aria-label="任务与通知"
                  disabled={!storeId}
                  onClick={() => storeId && router.push(`/merchant/stores/${storeId}/task-center`)}
                >
                  <Bell className="h-5 w-5 text-[var(--ll-green-sb)]" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ll-danger)] px-1 text-[10px] font-medium leading-none text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  className="p-2 rounded-full hover:bg-[var(--ll-green-light)] transition-colors text-[var(--ll-text-3)] hover:text-[var(--ll-danger)]"
                  aria-label="退出登录"
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' })
                    router.push('/login')
                  }}
                >
                  <LogOut className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 内容区域 — 展示底部导航时预留 pb-24 安全间距，否则仅常规内边距，避免遮挡主操作按钮 */}
      <main className={`flex-1 px-4 py-4 overflow-y-auto ${showBottomNav ? 'pb-24' : 'pb-4'}`}>
        {children}
      </main>

      {/* 底部导航 — v3 禅意编辑式：毛玻璃背景 + lucide strokeWidth 1.5 + 选中态仅变色（Requirements 9.2, 9.3, 9.4, 2.2, 15.4） */}
      {showBottomNav && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom"
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            background: 'rgba(0,0,0,.72)',
            borderTop: '1px solid #27272a',
          }}
        >
          <div className="flex items-center justify-around h-16">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.sub)
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => router.push(buildHref(item.sub))}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 py-1 transition-colors border-t-2 ${
                    active
                      ? 'text-[var(--ll-green)] border-[var(--ll-green)]'
                      : 'text-[var(--ll-text-3)] border-transparent'
                  }`}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon
                    className={`h-6 w-6 ${active ? 'text-[var(--ll-green)]' : 'text-[var(--ll-text-3)]'}`}
                    strokeWidth={1.5}
                  />
                  <span className={`text-[10px] uppercase tracking-[.2px] ${active ? 'font-semibold text-white' : 'font-normal text-[#767d88]'}`}>
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
