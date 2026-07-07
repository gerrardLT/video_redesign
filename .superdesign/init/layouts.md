# Shared Layouts — Merchant Platform

## MerchantLayout (Global Shell)
- File: `src/app/merchant/layout.tsx`
- Description: Global merchant layout with sticky header (store name + notification bell + video studio entry) and bottom tab bar (Home/Calendar/Today/Settings). Uses frosted glass bottom nav with `backdrop-blur(16px)` + `rgba(244,242,237,.88)`. Root class `.ll-root` activates warm cream canvas + Zen font system.

```tsx
'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Calendar, ClipboardList, User, Bell, Clapperboard } from 'lucide-react'
import { Noto_Serif_SC, Noto_Sans_SC, Space_Grotesk } from 'next/font/google'
import { StoreSwitcher } from '@/components/merchant'

const notoSerif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-noto-serif-sc',
  display: 'swap',
})

const notoSans = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-sc',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const NAV_ITEMS = [
  { key: 'home', label: '首页', icon: Home, sub: '' },
  { key: 'calendar', label: '日历', icon: Calendar, sub: '/calendar' },
  { key: 'today', label: '今日任务', icon: ClipboardList, sub: '/today' },
  { key: 'settings', label: '我的', icon: User, sub: '/settings' },
] as const

interface StoreInfo { storeId: string; storeName: string }

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [store, setStore] = useState<StoreInfo | null>(null)

  useEffect(() => {
    fetch('/api/merchant/me')
      .then((res) => {
        if (res.status === 401) throw new Error('未登录')
        if (!res.ok) throw new Error('请求失败')
        return res.json()
      })
      .then((data) => {
        if (!data.hasMerchant) { router.push('/merchant/onboarding'); return }
        setStore({ storeId: data.storeId, storeName: data.storeName || '我的门店' })
      })
      .catch((err) => { if (err.message === '未登录') router.push('/login?redirect=/merchant') })
  }, [router])

  const pathStoreId = pathname.match(/^\/merchant\/stores\/([^/]+)/)?.[1]
  const storeId = pathStoreId ?? store?.storeId ?? null

  const { data: notifData } = useSWR<{ notifications: { read: boolean }[] }>(
    storeId ? `/api/stores/${storeId}/notifications` : null,
    async (url: string) => { const res = await fetch(url); if (!res.ok) throw new Error(); return res.json() },
    { revalidateOnFocus: true, refreshInterval: 30_000 }
  )
  const unreadCount = notifData?.notifications.filter((n) => !n.read).length ?? 0

  const { data: switcherData } = useSWR<
    { multiStore: false } | { multiStore: true; stores: { storeId: string; name: string }[] }
  >('/api/stores/switcher', async (url: string) => { const res = await fetch(url); if (!res.ok) throw new Error(); return res.json() },
    { revalidateOnFocus: false }
  )
  const multiStore = switcherData?.multiStore === true

  const showBottomNav = Boolean(storeId) && !pathname.startsWith('/merchant/onboarding')

  function buildHref(sub: string): string { return `/merchant/stores/${storeId}${sub}` }
  function isActive(sub: string): boolean {
    if (!storeId) return false
    const base = `/merchant/stores/${storeId}`
    if (sub === '') return pathname === base
    return pathname.startsWith(base + sub)
  }

  return (
    <div className={`ll-root min-h-screen flex flex-col ${notoSerif.variable} ${notoSans.variable} ${spaceGrotesk.variable}`}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--ll-surface)]/90 backdrop-blur-sm border-b border-[var(--ll-hair)] safe-area-top">
        <div className="flex h-14 items-center justify-between px-4">
          {multiStore && storeId ? (
            <StoreSwitcher currentStoreId={storeId} storeName={store?.storeName || '加载中...'} />
          ) : (
            <h1 className="font-[var(--font-serif)] text-[18px] font-semibold tracking-[.02em] text-[var(--ll-green-sb)] truncate max-w-[55%]">
              {store?.storeName || '加载中...'}
            </h1>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[var(--ll-green-sb)] hover:bg-[var(--ll-green-light)] transition-colors" aria-label="进入视频重塑">
              <Clapperboard className="h-5 w-5" />
              <span className="text-sm font-medium">视频重塑</span>
            </button>
            <button className="relative p-2 rounded-full hover:bg-[var(--ll-green-light)] transition-colors disabled:opacity-40"
              aria-label="任务与通知" disabled={!storeId}
              onClick={() => storeId && router.push(`/merchant/stores/${storeId}/task-center`)}>
              <Bell className="h-5 w-5 text-[var(--ll-green-sb)]" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ll-danger)] px-1 text-[10px] font-medium leading-none text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className={`flex-1 px-4 py-4 overflow-y-auto ${showBottomNav ? 'pb-24' : 'pb-4'}`}>
        {children}
      </main>

      {/* Bottom Nav */}
      {showBottomNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom"
          style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', background: 'rgba(244,242,237,.88)', borderTop: '1px solid var(--ll-hair)' }}>
          <div className="flex items-center justify-around h-16">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.sub)
              const Icon = item.icon
              return (
                <button key={item.key} onClick={() => router.push(buildHref(item.sub))}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 py-1 transition-colors ${active ? 'text-[var(--ll-green)]' : 'text-[var(--ll-text-3)]'}`}
                  aria-label={item.label} aria-current={active ? 'page' : undefined}>
                  <Icon className={`h-6 w-6 ${active ? 'text-[var(--ll-green)]' : 'text-[var(--ll-text-3)]'}`} strokeWidth={1.5} />
                  <span className={`text-xs ${active ? 'font-semibold text-[var(--ll-green)]' : 'font-normal text-[var(--ll-text-3)]'}`}>
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
```
