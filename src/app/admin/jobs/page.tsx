'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface JobItem {
  id: string
  status: string
  userEmail: string
  projectName: string
  seedanceTaskId: string | null
  errorCode: string | null
  errorMessage: string | null
  retryCount: number
  createdAt: string
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'QUEUED', label: 'QUEUED' },
  { value: 'CREDIT_RESERVED', label: 'CREDIT_RESERVED' },
  { value: 'SUBMITTED', label: 'SUBMITTED' },
  { value: 'GENERATING', label: 'GENERATING' },
  { value: 'SUCCEEDED', label: 'SUCCEEDED' },
  { value: 'FAILED', label: 'FAILED' },
  { value: 'CANCELED', label: 'CANCELED' },
]

function statusColor(status: string) {
  switch (status) {
    case 'SUCCEEDED': return 'bg-green-500/20 text-[var(--cine-green)]'
    case 'FAILED': return 'bg-red-500/20 text-red-400'
    case 'CANCELED': return 'bg-yellow-500/20 text-yellow-400'
    case 'GENERATING': return 'bg-blue-500/20 text-blue-400'
    case 'QUEUED': return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
    default: return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
  }
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)

  useEffect(() => {
    const url = statusFilter
      ? `/api/admin/jobs?status=${statusFilter}`
      : '/api/admin/jobs'
    let cancelled = false
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('获取任务列表失败')
        return res.json()
      })
      .then((data) => { if (!cancelled) setJobs(data.jobs) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '未知错误') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [statusFilter])

  function refreshJobs() {
    setLoading(true)
    const url = statusFilter
      ? `/api/admin/jobs?status=${statusFilter}`
      : '/api/admin/jobs'
    fetch(url)
      .then((res) => res.json())
      .then((data) => setJobs(data.jobs))
      .finally(() => setLoading(false))
  }

  async function handleRetry(jobId: string) {
    setRetrying(jobId)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '重试失败')
      }
      toast.success('重试任务已创建')
      refreshJobs()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '重试失败')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">任务管理</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

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
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">项目</th>
                <th className="px-4 py-3 font-medium">Seedance ID</th>
                <th className="px-4 py-3 font-medium">错误信息</th>
                <th className="px-4 py-3 font-medium">重试</th>
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {jobs.map((job) => (
                <tr key={job.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                  <td className="px-4 py-3 font-mono text-xs">{job.id.slice(0, 8)}...</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusColor(job.status)}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{job.userEmail}</td>
                  <td className="px-4 py-3 text-xs">{job.projectName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--cine-text-2)]">
                    {job.seedanceTaskId ? job.seedanceTaskId.slice(0, 8) + '...' : '-'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-red-400">
                    {job.errorMessage || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">{job.retryCount}</td>
                  <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                    {new Date(job.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    {job.status === 'FAILED' && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        disabled={retrying === job.id}
                        className="rounded bg-[var(--cine-gold)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                      >
                        {retrying === job.id ? '重试中?..' : '重试'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                    暂无任务数据
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
