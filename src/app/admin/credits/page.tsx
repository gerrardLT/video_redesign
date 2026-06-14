'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface UserOption {
  id: string
  email: string
}

interface LedgerEntry {
  id: string
  userId: string
  userEmail: string
  jobId: string | null
  action: string
  amount: number
  balanceAfter: number
  remark: string | null
  createdAt: string
}

export default function AdminCreditsPage() {
  // 调整表单状态
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 流水列表状态
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setUsers(data.users.map((u: { id: string; email: string }) => ({ id: u.id, email: u.email })))
      })
      .catch(() => {})

    fetch('/api/admin/credits/ledger')
      .then((res) => {
        if (!res.ok) throw new Error('获取流水失败')
        return res.json()
      })
      .then((data) => setEntries(data.entries))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLedgerLoading(false))
  }, [])

  function refreshLedger() {
    setLedgerLoading(true)
    fetch('/api/admin/credits/ledger')
      .then((res) => res.json())
      .then((data) => setEntries(data.entries))
      .catch(() => {})
      .finally(() => setLedgerLoading(false))
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId || !amount || !remark) {
      toast.error('请填写完整信息')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/credits/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUserId,
          amount: parseInt(amount, 10),
          remark,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '调整失败')
      toast.success(`积分调整成功，新余额: ${data.newBalance}`)
      setAmount('')
      setRemark('')
      refreshLedger()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '调整失败')
    } finally {
      setSubmitting(false)
    }
  }

  function actionLabel(action: string) {
    switch (action) {
      case 'RESERVE': return '冻结'
      case 'CHARGE': return '扣除'
      case 'REFUND': return '返还'
      case 'ADMIN_ADJUST': return '管理员调整'
      default: return action
    }
  }

  function actionColor(action: string) {
    switch (action) {
      case 'RESERVE': return 'text-yellow-400'
      case 'CHARGE': return 'text-red-400'
      case 'REFUND': return 'text-[var(--cine-green)]'
      case 'ADMIN_ADJUST': return 'text-[var(--cine-gold)]'
      default: return 'text-[var(--cine-text-2)]'
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">积分管理</h1>

      {/* 积分调整表单 */}
      <div className="mb-8 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">积分调整</h2>
        <form onSubmit={handleAdjust} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">选择用户</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            >
              <option value="">请选择用户</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">调整金额</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="正数增加，负数扣除"
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">备注</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="调整原因"
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[var(--cine-gold)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '提交调整'}
          </button>
        </form>
      </div>

      {/* 积分流水表格 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="border-b border-[var(--cine-line-2)] px-4 py-3">
          <h2 className="text-lg font-semibold text-white/90">积分流水</h2>
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {ledgerLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">金额</th>
                  <th className="px-4 py-3 font-medium">余额</th>
                  <th className="px-4 py-3 font-medium">备注</th>
                  <th className="px-4 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entries.map((entry) => (
                  <tr key={entry.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                    <td className="px-4 py-3 text-xs">{entry.userEmail}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${actionColor(entry.action)}`}>
                        {actionLabel(entry.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <span className={entry.amount >= 0 ? 'text-[var(--cine-green)]' : 'text-red-400'}>
                        {entry.amount >= 0 ? '+' : ''}{entry.amount}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{entry.balanceAfter}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {entry.remark || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {new Date(entry.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                      暂无流水数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
