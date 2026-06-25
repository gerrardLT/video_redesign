'use client'

/**
 * Dashboard 布局组件
 *
 * 包含顶部导航栏（Logo、导航链接、积分余额、用户信息）和内容区域。
 * 使用 OnboardingProvider 包裹子树，为引导系统提供状态上下文。
 * 导航元素添加 data-onboarding 属性，供引导组件 Tooltip 定位使用。
 */

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider'
import { useOnboardingContext } from '@/components/onboarding/onboarding-provider'

interface UserInfo {
  id: string
  email: string
  nickname: string | null
  creditBalance: number
}

const NAV_LINKS = [
  { href: '/dashboard/workspace', label: '工作台', exact: false, onboardingId: undefined },
  { href: '/dashboard', label: '我的项目', exact: true, onboardingId: undefined },
  { href: '/dashboard/assets', label: '资产库', exact: false, onboardingId: 'asset-library' },
  { href: '/dashboard/packages', label: '套餐', exact: false, onboardingId: 'packages' },
  { href: '/dashboard/orders', label: '订单', exact: false, onboardingId: undefined },
  { href: '/dashboard/showcase', label: '案例', exact: false, onboardingId: undefined },
  { href: '/dashboard/help', label: '帮助', exact: false, onboardingId: 'help' },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('未登录')
        return res.json()
      })
      .then((data) => setUser(data.user))
      .catch(() => router.push('/login'))
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <OnboardingProvider isAuthenticated={!!user}>
      <div className="min-h-screen bg-[var(--cine-bg)]">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-50 border-b border-[var(--cine-line-2)] bg-[var(--cine-bg-80)] backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            {/* 左侧：Logo + 导航 */}
            <div className="flex items-center gap-6">
              {/* Logo */}
              <Link href="/dashboard" className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="视频重塑" className="h-8 w-8 rounded-lg object-contain" />
                <span className="text-lg font-semibold text-[var(--cine-text)] hidden sm:inline">视频重塑</span>
              </Link>

              {/* 导航链接 */}
              <nav className="hidden md:flex items-center gap-1">
                {NAV_LINKS.map((link) => {
                  const active = isActive(link.href, link.exact)
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      {...(link.onboardingId ? { 'data-onboarding': link.onboardingId } : {})}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'bg-[var(--cine-gold-dim)] text-[var(--cine-gold)] font-medium'
                          : 'text-[var(--cine-text-2)] hover:text-[var(--cine-text)] hover:bg-[var(--cine-surface)]'
                      }`}
                    >
                      {link.label}
                    </Link>
                  )
                })}
              </nav>
            </div>

            {/* 右侧：重新查看引导 + 积分 + 用户 */}
            <div className="flex items-center gap-4">
              {user && (
                <>
                  {/* 重新查看引导 */}
                  <RestartOnboardingButton />

                  {/* 积分余额 */}
                  <Link
                    href="/dashboard/packages"
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--cine-surface)] px-3 py-1.5 transition-colors hover:bg-[var(--cine-line-2)]"
                  >
                    <svg
                      className="h-4 w-4 text-[var(--cine-gold)]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                      />
                    </svg>
                    <span className="text-sm text-[var(--cine-text)]">{user.creditBalance}</span>
                  </Link>

                  {/* 用户名 */}
                  <span className="text-sm text-[var(--cine-text-2)] hidden sm:inline">
                    {user.nickname || user.email}
                  </span>

                  {/* 退出 */}
                  <button
                    onClick={handleLogout}
                    className="rounded-lg px-3 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-text)]"
                  >
                    退出
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* 内容区 */}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </OnboardingProvider>
  )
}

// ========================
// 重新查看引导按钮（内部组件）
// ========================

/**
 * 重新查看引导按钮
 *
 * 通过 OnboardingContext 调用 resetOnboarding() 重置引导进度。
 * 始终可见，放置在导航栏右侧区域。
 * Requirements: 6.3
 */
function RestartOnboardingButton() {
  const { resetOnboarding } = useOnboardingContext()
  const [isResetting, setIsResetting] = useState(false)

  async function handleRestart() {
    if (isResetting) return
    setIsResetting(true)
    try {
      await resetOnboarding()
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <button
      onClick={handleRestart}
      disabled={isResetting}
      title="重新查看引导"
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[var(--cine-text-3)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-text-2)] disabled:opacity-50"
    >
      <RotateCcw className={`h-3.5 w-3.5 ${isResetting ? 'animate-spin' : ''}`} />
      <span className="hidden lg:inline">重新引导</span>
    </button>
  )
}
