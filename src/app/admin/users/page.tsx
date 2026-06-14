'use client'

import { useEffect, useState } from 'react'

interface UserItem {
  id: string
  email: string
  nickname: string | null
  role: string
  creditBalance: number
  projectCount: number
  createdAt: string
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => {
        if (!res.ok) throw new Error('获取用户列表失败')
        return res.json()
      })
      .then((data) => setUsers(data.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">用户管理</h1>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">昵称</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">积分余额</th>
                <th className="px-4 py-3 font-medium">项目名</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((user) => (
                <tr key={user.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.nickname || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      user.role === 'ADMIN'
                        ? 'bg-[var(--cine-gold-dim)] text-[var(--cine-gold)]'
                        : 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{user.creditBalance}</td>
                  <td className="px-4 py-3">{user.projectCount}</td>
                  <td className="px-4 py-3 text-[var(--cine-text-2)]">
                    {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                    暂无用户数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
