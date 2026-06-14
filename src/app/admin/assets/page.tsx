'use client'

import { useEffect, useState, useCallback } from 'react'

interface AssetItem {
  id: string
  projectId: string
  userId: string
  type: string
  url: string
  fileName: string | null
  fileSize: number | null
  status: string
  expiresAt: string | null
  createdAt: string
  project: {
    name: string
  }
  user: {
    email: string
  }
}

interface StorageStats {
  active: {
    count: number
    totalSize: number
  }
  expired: {
    count: number
    totalSize: number
  }
  expiring: {
    count: number
  }
}

export default function AdminAssetsPage() {
  // 存储统计
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // 资产列表
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [error, setError] = useState('')

  // 分页
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // 标签页筛选：expiring | expired
  const [activeTab, setActiveTab] = useState<'expiring' | 'expired'>('expiring')

  // 加载存储统计
  useEffect(() => {
    setStatsLoading(true)
    fetch('/api/admin/assets/stats')
      .then((res) => {
        if (!res.ok) throw new Error('获取统计数据失败')
        return res.json()
      })
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  // 加载资产列表
  const fetchAssets = useCallback(() => {
    setAssetsLoading(true)
    setError('')

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', '20')
    params.set('status', activeTab)

    fetch(`/api/admin/assets?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取资产列表失败')
        return res.json()
      })
      .then((data) => {
        setAssets(data.assets)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setAssetsLoading(false))
  }, [page, activeTab])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  // 切换标签页
  function handleTabChange(tab: 'expiring' | 'expired') {
    setActiveTab(tab)
    setPage(1)
  }

  // 格式化文件大小
  function formatFileSize(bytes: number | null): string {
    if (bytes === null || bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
  }

  // 计算剩余天数
  function getRemainingDays(expiresAt: string | null): string {
    if (!expiresAt) return '--'
    const diff = new Date(expiresAt).getTime() - Date.now()
    if (diff <= 0) return '已过期'
    const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
    return `${days} 天`
  }

  // 清理状态标签
  function cleanupStatusLabel(status: string): string {
    switch (status) {
      case 'EXPIRED':
        return '已清理'
      case 'UPLOADED':
      case 'APPROVED':
      case 'GENERATED':
        return '未清理'
      default:
        return status
    }
  }

  function cleanupStatusColor(status: string): string {
    switch (status) {
      case 'EXPIRED':
        return 'bg-green-500/20 text-[var(--cine-green)]'
      default:
        return 'bg-yellow-500/20 text-yellow-400'
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">资产管理</h1>

      {/* 存储使用统计面板 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="活跃资产数量"
          value={stats ? String(stats.active.count) : '--'}
          loading={statsLoading}
        />
        <StatCard
          label="活跃资产总大小"
          value={stats ? formatFileSize(stats.active.totalSize) : '--'}
          loading={statsLoading}
          highlight
        />
        <StatCard
          label="已清理资产数量"
          value={stats ? String(stats.expired.count) : '--'}
          loading={statsLoading}
        />
        <StatCard
          label="已清理资产总大小"
          value={stats ? formatFileSize(stats.expired.totalSize) : '--'}
          loading={statsLoading}
        />
      </div>

      {/* 即将过期提示 */}
      {stats && stats.expiring.count > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <svg className="h-5 w-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-sm text-yellow-400">
            {stats.expiring.count} 个资产将在 3 天内过期
          </span>
        </div>
      )}

      {/* 标签页切换 */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => handleTabChange('expiring')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'expiring'
              ? 'bg-[var(--cine-gold)] text-white'
              : 'border border-[var(--cine-line-2)] text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-white'
          }`}
        >
          即将过期
          {stats && stats.expiring.count > 0 && (
            <span className="ml-2 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
              {stats.expiring.count}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange('expired')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'expired'
              ? 'bg-[var(--cine-gold)] text-white'
              : 'border border-[var(--cine-line-2)] text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-white'
          }`}
        >
          已过期
          {stats && stats.expired.count > 0 && (
            <span className="ml-2 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
              {stats.expired.count}
            </span>
          )}
        </button>
      </div>

      {/* 资产列表 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cine-line-2)] px-4 py-3">
          <h2 className="text-lg font-semibold text-white/90">
            {activeTab === 'expiring' ? '即将过期资产' : '已过期资产'}
          </h2>
          <span className="text-sm text-[var(--cine-text-3)]">共 {total} 条</span>
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {assetsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            {activeTab === 'expiring' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                    <th className="px-4 py-3 font-medium">资产ID</th>
                    <th className="px-4 py-3 font-medium">所属用户</th>
                    <th className="px-4 py-3 font-medium">项目名称</th>
                    <th className="px-4 py-3 font-medium">文件类型</th>
                    <th className="px-4 py-3 font-medium">过期时间</th>
                    <th className="px-4 py-3 font-medium">剩余天数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--cine-text-2)]">
                        {asset.id.slice(0, 12)}...
                      </td>
                      <td className="px-4 py-3 text-xs">{asset.user.email}</td>
                      <td className="px-4 py-3">{asset.project.name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">{asset.type}</td>
                      <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                        {asset.expiresAt
                          ? new Date(asset.expiresAt).toLocaleString('zh-CN')
                          : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
                          {getRemainingDays(asset.expiresAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {assets.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                        暂无即将过期的资产
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                    <th className="px-4 py-3 font-medium">资产ID</th>
                    <th className="px-4 py-3 font-medium">所属用户</th>
                    <th className="px-4 py-3 font-medium">项目名称</th>
                    <th className="px-4 py-3 font-medium">过期时间</th>
                    <th className="px-4 py-3 font-medium">文件大小</th>
                    <th className="px-4 py-3 font-medium">清理状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--cine-text-2)]">
                        {asset.id.slice(0, 12)}...
                      </td>
                      <td className="px-4 py-3 text-xs">{asset.user.email}</td>
                      <td className="px-4 py-3">{asset.project.name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                        {asset.expiresAt
                          ? new Date(asset.expiresAt).toLocaleString('zh-CN')
                          : '--'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {formatFileSize(asset.fileSize)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cleanupStatusColor(asset.status)}`}>
                          {cleanupStatusLabel(asset.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {assets.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                        暂无已过期的资产
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--cine-line-2)] px-4 py-3">
            <span className="text-sm text-[var(--cine-text-3)]">
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[var(--cine-line-2)] px-3 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-[var(--cine-line-2)] px-3 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 统计卡片组件
function StatCard({
  label,
  value,
  loading,
  highlight,
}: {
  label: string
  value: string
  loading: boolean
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-[var(--cine-gold)]/30 bg-[var(--cine-gold)]/5' : 'border-[var(--cine-line-2)] bg-[var(--cine-surface)]'}`}>
      <div className="mb-1 text-sm text-[var(--cine-text-2)]">{label}</div>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded bg-[var(--cine-surface)]" />
      ) : (
        <div className={`text-xl font-bold ${highlight ? 'text-[var(--cine-gold)]' : 'text-white'}`}>
          {value}
        </div>
      )}
    </div>
  )
}
