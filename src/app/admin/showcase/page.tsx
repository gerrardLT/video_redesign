'use client'

import { useEffect, useState, useCallback } from 'react'
import { SHOWCASE_CATEGORIES } from '@/constants/showcase-categories'

interface CaseItem {
  id: string
  title: string
  category: string
  coverUrl: string
  description: string
  originalVideoUrl: string
  generatedVideoUrl: string
  sortOrder: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

interface CaseFormData {
  title: string
  description: string
  category: string
  coverUrl: string
  originalVideoUrl: string
  generatedVideoUrl: string
  isPublished: boolean
  sortOrder: number
}

const EMPTY_FORM: CaseFormData = {
  title: '',
  description: '',
  category: '',
  coverUrl: '',
  originalVideoUrl: '',
  generatedVideoUrl: '',
  isPublished: true,
  sortOrder: 0,
}

export default function AdminShowcasePage() {
  // 列表状态
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filterCategory, setFilterCategory] = useState('')
  const pageSize = 12

  // 表单弹窗状态
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CaseFormData>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CaseFormData, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  // 删除确认弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<CaseItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 加载案例列表
  const fetchCases = useCallback(() => {
    setLoading(true)
    setError('')

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (filterCategory) params.set('category', filterCategory)

    fetch(`/api/admin/showcase?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取案例列表失败')
        return res.json()
      })
      .then((data) => {
        setCases(data.items)
        setTotal(data.total)
        setTotalPages(Math.ceil(data.total / pageSize))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLoading(false))
  }, [page, filterCategory])

  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  // 获取分类标签
  function getCategoryLabel(value: string) {
    return SHOWCASE_CATEGORIES.find((c) => c.value === value)?.label || value
  }

  // 打开新增弹窗
  function handleCreate() {
    setFormMode('create')
    setEditingId(null)
    setFormData(EMPTY_FORM)
    setFormErrors({})
    setFormOpen(true)
  }

  // 打开编辑弹窗
  function handleEdit(item: CaseItem) {
    setFormMode('edit')
    setEditingId(item.id)
    setFormData({
      title: item.title,
      description: item.description,
      category: item.category,
      coverUrl: item.coverUrl,
      originalVideoUrl: item.originalVideoUrl,
      generatedVideoUrl: item.generatedVideoUrl,
      isPublished: item.isPublished,
      sortOrder: item.sortOrder,
    })
    setFormErrors({})
    setFormOpen(true)
  }

  // 表单验证
  function validateForm(): boolean {
    const errors: Partial<Record<keyof CaseFormData, string>> = {}

    if (!formData.title.trim()) errors.title = '标题不能为空'
    if (!formData.description.trim()) errors.description = '描述不能为空'
    if (!formData.category) errors.category = '请选择分类'
    if (!formData.coverUrl.trim()) errors.coverUrl = '封面图?URL 不能为空'
    if (!formData.originalVideoUrl.trim()) errors.originalVideoUrl = '原视频?URL 不能为空'
    if (!formData.generatedVideoUrl.trim()) errors.generatedVideoUrl = '生成视频 URL 不能为空'

    // 简单?URL 验证
    const urlFields: (keyof CaseFormData)[] = ['coverUrl', 'originalVideoUrl', 'generatedVideoUrl']
    for (const field of urlFields) {
      const val = formData[field] as string
      if (val.trim() && !val.startsWith('http://') && !val.startsWith('https://')) {
        errors[field] = 'URL 格式无效，须以?http:// ?https:// 开'
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // 提交表单
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateForm()) return

    setSubmitting(true)
    setError('')

    try {
      const url = formMode === 'create'
        ? '/api/admin/showcase'
        : `/api/admin/showcase/${editingId}`
      const method = formMode === 'create' ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || `${formMode === 'create' ? '创建' : '更新'}案例失败`)
      }

      setFormOpen(false)
      fetchCases()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 删除案例
  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    setError('')

    try {
      const res = await fetch(`/api/admin/showcase/${deleteTarget.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || '删除案例失败')
      }

      setDeleteTarget(null)
      fetchCases()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // 切换发布状态
  async function togglePublish(item: CaseItem) {
    try {
      const res = await fetch(`/api/admin/showcase/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !item.isPublished }),
      })

      if (!res.ok) throw new Error('更新状态失败')
      fetchCases()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">案例管理</h1>
        <button
          onClick={handleCreate}
          className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80"
        >
          + 新增案例
        </button>
      </div>

      {/* 筛选?*/}
      <div className="mb-4 flex items-center gap-4">
        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1) }}
          className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
        >
          <option value="">全部分类</option>
          {SHOWCASE_CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>{cat.label}</option>
          ))}
        </select>
        <span className="text-sm text-[var(--cine-text-3)]">共 {total} 条</span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* 案例列表表格 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">分类</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">排序</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {cases.map((item) => (
                  <tr key={item.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-16 flex-shrink-0 overflow-hidden rounded border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.coverUrl}
                            alt={item.title}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = ''
                              ;(e.target as HTMLImageElement).alt = '加载失败'
                            }}
                          />
                        </div>
                        <span className="max-w-[200px] truncate text-sm text-white/90">{item.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-[var(--cine-gold-dim)] px-2.5 py-0.5 text-xs font-medium text-[var(--cine-gold)]">
                        {getCategoryLabel(item.category)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => togglePublish(item)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          item.isPublished
                            ? 'bg-green-500/20 text-[var(--cine-green)] hover:bg-green-500/30'
                            : 'bg-[var(--cine-surface)] text-[var(--cine-text-2)] hover:bg-[var(--cine-line-2)]'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${item.isPublished ? 'bg-green-400' : 'bg-white/40'}`} />
                        {item.isPublished ? '已发布' : '未发布'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">{item.sortOrder}</td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(item)}
                          className="rounded-lg bg-[var(--cine-gold-dim)] px-3 py-1.5 text-xs font-medium text-[var(--cine-gold)] transition-colors hover:bg-[var(--cine-gold)]/30"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                      暂无案例数据
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

      {/* 新增/编辑表单弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-white">
              {formMode === 'create' ? '新增案例' : '编辑案例'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">标题 *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="请输入案例标题"
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                />
                {formErrors.title && <p className="mt-1 text-xs text-red-400">{formErrors.title}</p>}
              </div>

              {/* 分类 */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">分类 *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                >
                  <option value="">请选择分类</option>
                  {SHOWCASE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
                {formErrors.category && <p className="mt-1 text-xs text-red-400">{formErrors.category}</p>}
              </div>

              {/* 描述 */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">描述 *</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="请输入案例描述"
                  rows={3}
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                />
                {formErrors.description && <p className="mt-1 text-xs text-red-400">{formErrors.description}</p>}
              </div>

              {/* 封面图?URL */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">封面图?URL *</label>
                <input
                  type="text"
                  value={formData.coverUrl}
                  onChange={(e) => setFormData({ ...formData, coverUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                />
                {formErrors.coverUrl && <p className="mt-1 text-xs text-red-400">{formErrors.coverUrl}</p>}
              </div>

              {/* 原视频?URL */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">原视频?URL *</label>
                <input
                  type="text"
                  value={formData.originalVideoUrl}
                  onChange={(e) => setFormData({ ...formData, originalVideoUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                />
                {formErrors.originalVideoUrl && <p className="mt-1 text-xs text-red-400">{formErrors.originalVideoUrl}</p>}
              </div>

              {/* 生成视频 URL */}
              <div>
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">生成视频 URL *</label>
                <input
                  type="text"
                  value={formData.generatedVideoUrl}
                  onChange={(e) => setFormData({ ...formData, generatedVideoUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                />
                {formErrors.generatedVideoUrl && <p className="mt-1 text-xs text-red-400">{formErrors.generatedVideoUrl}</p>}
              </div>

              {/* 排序权重 + 发布状态?*/}
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">排序权重</label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">发布状态</label>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, isPublished: !formData.isPublished })}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      formData.isPublished
                        ? 'border-[var(--cine-green)]/30 bg-green-500/10 text-[var(--cine-green)]'
                        : 'border-[var(--cine-line-2)] bg-[var(--cine-bg)] text-[var(--cine-text-2)]'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${formData.isPublished ? 'bg-green-400' : 'bg-white/40'}`} />
                    {formData.isPublished ? '发布' : '草稿'}
                  </button>
                </div>
              </div>

              {/* 按钮组?*/}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={submitting}
                  className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {submitting ? '提交中?..' : formMode === 'create' ? '创建' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-semibold text-white">确认删除</h3>
            <p className="mb-6 text-sm text-[var(--cine-text-2)]">
              确认删除案例「{deleteTarget.title}」？删除后将无法恢复，且该案例将从公开页面移&apos;            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? '删除中?..' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
