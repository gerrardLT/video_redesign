'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(nickname ? { nickname } : {}),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '注册失败')
        return
      }

      // 使用 window.location 确保 cookie 生效后再跳转（Next.js router.push 可能?cookie 写入前触发)
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
          <h1 className="text-2xl font-bold text-white">注册</h1>
          <p className="mt-2 text-sm text-[var(--cine-text-2)]">创建账户，开始使用?AI 视频重塑</p>
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
            <label htmlFor="nickname" className="text-sm font-medium text-[var(--cine-text)]">
              昵称 <span className="text-[var(--cine-text-3)]">(可选?</span>
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="你的昵称"
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
              minLength={8}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-2.5 text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '注册中?..' : '注册'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--cine-text-2)]">
          已有账户？{' '}
          <Link href="/login" className="text-[var(--cine-gold)] hover:text-[#818cf8]">
            去登'          </Link>
        </p>
      </div>
    </div>
  )
}
