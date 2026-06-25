'use client'

/**
 * 商家专属布局组件
 *
 * 面向非技术用户（餐饮商家）的极简布局：
 * - 顶部 Header：仅显示门店名称 + 通知图标
 * - 底部导航：首页、日历、今日任务、我的
 * - 暖色调、大圆角、大字体风格
 * - 与 /dashboard 完全隔离，无 cross-navigation
 *
 * Requirements: 15.4, 15.5
 */

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Calendar, ClipboardList, User, Bell } from 'lucide-react'

/** 底部导航项配置 */
const NAV_ITEMS = [
  { href: '/merchant', label: '首页', icon: Home, exact: true },
  { href: '/merchant/calendar', label: '日历', icon: Calendar, exact: false },
  { href: '/merchant/today', label: '今日任务', icon: ClipboardList, exact: false },
  { href: '/merchant/profile', label: '我的', icon: User, exact: false },
] as const

interface StoreInfo {
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
    // 获取商家门店信息
    fetch('/api/merchant/me')
      .then((res) => {
        if (!res.ok) throw new Error('未登录或无商家信息')
        return res.json()
      })
      .then((data) => setStore({ storeName: data.storeName || '我的门店' }))
      .catch(() => router.push('/login'))
  }, [router])

  /** 判断当前导航项是否选中 */
  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col">
      {/* 顶部 Header — 极简：门店名称 + 通知 */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-sm border-b border-amber-100 safe-area-top">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-lg font-semibold text-amber-900 truncate max-w-[70%]">
            {store?.storeName || '加载中...'}
          </h1>
          <button
            className="relative p-2 rounded-full hover:bg-amber-100 transition-colors"
            aria-label="通知"
          >
            <Bell className="h-5 w-5 text-amber-700" />
            {/* 未读通知红点 */}
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="flex-1 px-4 py-4 pb-24 overflow-y-auto">
        {children}
      </main>

      {/* 底部导航 — 固定在屏幕底部 */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-amber-100 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href, item.exact)
            const Icon = item.icon
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-xl transition-colors ${
                  active
                    ? 'text-amber-600'
                    : 'text-gray-400 hover:text-amber-500'
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
    </div>
  )
}
