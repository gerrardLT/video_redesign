'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '登录失败')
        return
      }

      window.location.href = '/dashboard'
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cine-bg)] px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">登录</h1>
          <p className="mt-2 text-sm text-[var(--cine-text-2)]">登录你的账户继续使用</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-[var(--cine-text)]">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-2.5 text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-[var(--cine-text)]">
              密码
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              required
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-2.5 text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--cine-text-2)]">
          还没有账户？{' '}
          <Link href="/register" className="text-[var(--cine-gold)] hover:text-[#818cf8]">
            去注册
          </Link>
        </p>
      </div>
    </div>
  )
}
