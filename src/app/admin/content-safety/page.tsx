'use client'

import { useEffect, useState, useCallback } from 'react'

interface RejectedAsset {
  id: string
  url: string
  thumbUrl: string | null
  fileName: string | null
  status: string
  rejectReason: string | null
  createdAt: string
  project: {
    name: string
    userId: string
    user: {
      nickname: string | null
      email: string
    }
  }
}

interface RejectedAssetsResponse {
  items: RejectedAsset[]
  total: number
  page: number
  pageSize: number
}

export default function AdminContentSafetyPage() {
  const [assets, setAssets] = useState<RejectedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 20

  // 确认弹窗状态
  const [confirmAction, setConfirmAction] = useState<{
    assetId: string
    action: 'approve' | 'reject'
  } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // 加载被拦截素材列表
  const fetchAssets = useCallback(() => {
    setLoading(true)
    setError('')

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))

    fetch(`/api/admin/content-safety?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取被拦截素材列表失败')
        return res.json()
      })
      .then((data: RejectedAssetsResponse) => {
        setAssets(data.items)
        setTotal(data.total)
        setTotalPages(Math.ceil(data.total / data.pageSize))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  // 执行复审操作
  function handleReview(assetId: string, action: 'approve' | 'reject') {
    setConfirmAction({ assetId, action })
  }

  async function confirmReview() {
    if (!confirmAction) return

    setActionLoading(true)
    try {
      const res = await fetch(
        `/api/admin/content-safety/${confirmAction.assetId}/review`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: confirmAction.action }),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || '操作失败')
      }

      // 操作成功后刷新列表
      setConfirmAction(null)
      fetchAssets()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">内容安全</h1>

      {/* 统计概览 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <div className="mb-1 text-sm text-[var(--cine-text-2)]">被拦截素材总数</div>
          {loading ? (
            <div className="h-7 w-20 animate-pulse rounded bg-[var(--cine-surface)]" />
          ) : (
            <div className="text-xl font-bold text-red-400">{total}</div>
          )}
        </div>
      </div>

      {/* 被拦截素材列表 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cine-line-2)] px-4 py-3">
          <h2 className="text-lg font-semibold text-white/90">被拦截素材列表</h2>
          <span className="text-sm text-[var(--cine-text-3)]">共 {total} 条</span>
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                  <th className="px-4 py-3 font-medium">缩略图</th>
                  <th className="px-4 py-3 font-medium">上传用户</th>
                  <th className="px-4 py-3 font-medium">上传时间</th>
                  <th className="px-4 py-3 font-medium">拒绝原因</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {assets.map((asset) => (
                  <tr key={asset.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                    <td className="px-4 py-3">
                      <div className="h-12 w-12 overflow-hidden rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.thumbUrl || asset.url}
                          alt="素材缩略图"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).src = ''
                            ;(e.target as HTMLImageElement).alt = '加载失败'
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-[var(--cine-text)]">
                        {asset.project.user.nickname || '未命名用户'}
                      </div>
                      <div className="text-xs text-[var(--cine-text-3)]">
                        {asset.project.user.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {new Date(asset.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block max-w-[200px] truncate rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                        {asset.rejectReason || '人脸检测未通过'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReview(asset.id, 'approve')}
                          className="rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-[var(--cine-green)] transition-colors hover:bg-green-600/30"
                        >
                          ✓ 通过
                        </button>
                        <button
                          onClick={() => handleReview(asset.id, 'reject')}
                          className="rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30"
                        >
                          ✗ 维持拒绝
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                      暂无被拦截素材
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

      {/* 确认弹窗 */}
      {confirmAction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-semibold text-white">
              {confirmAction.action === 'approve' ? '确认通过' : '确认维持拒绝'}
            </h3>
            <p className="mb-6 text-sm text-[var(--cine-text-2)]">
              {confirmAction.action === 'approve'
                ? '确认将该素材标记为通过？通过后用户可正常使用该素材。'
                : '确认维持拒绝该素材？维持拒绝后用户无法使用该素材。'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmReview}
                disabled={actionLoading}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                  confirmAction.action === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
