'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

// ========================
// 类型定义
// ========================

interface HelpArticle {
  id: string
  title: string
  slug: string
  section: string
  content: string
  sortOrder: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

type SectionType = 'quickstart' | 'guide' | 'faq'

const SECTION_OPTIONS: { value: SectionType; label: string }[] = [
  { value: 'quickstart', label: '快速入门' },
  { value: 'guide', label: '详细指南' },
  { value: 'faq', label: '常见问题' },
]

const SECTION_LABELS: Record<string, string> = {
  quickstart: '快速入门',
  guide: '详细指南',
  faq: '常见问题',
}

const SECTION_COLORS: Record<string, string> = {
  quickstart: 'bg-green-500/10 text-[var(--cine-green)]',
  guide: 'bg-blue-500/10 text-blue-400',
  faq: 'bg-amber-500/10 text-amber-400',
}

// ========================
// Slug 生成工具
// ========================

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ========================
// 简单 Markdown 预览渲染
// ========================

function renderMarkdownPreview(markdown: string): string {
  let html = markdown

  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<pre class="rounded bg-[var(--cine-surface)] p-3 text-sm overflow-x-auto"><code class="language-${lang || 'text'}">${escaped}</code></pre>`
  })

  const lines = html.split('\n')
  const result: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' | null = null

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // 跳过已处理的代码块
    if (line.includes('<pre class="rounded')) {
      let codeBlock = line
      while (!line.includes('</pre>') && i < lines.length - 1) {
        i++
        line = lines[i]
        codeBlock += '\n' + line
      }
      if (inList) {
        result.push(listType === 'ol' ? '</ol>' : '</ul>')
        inList = false
        listType = null
      }
      result.push(codeBlock)
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      if (inList) {
        result.push(listType === 'ol' ? '</ol>' : '</ul>')
        inList = false
        listType = null
      }
      result.push('<hr class="my-4 border-[var(--cine-line-2)]" />')
      continue
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      if (inList) {
        result.push(listType === 'ol' ? '</ol>' : '</ul>')
        inList = false
        listType = null
      }
      const level = headingMatch[1].length
      const text = processInlineMarkdown(headingMatch[2])
      const sizes: Record<number, string> = {
        1: 'text-xl font-bold mt-4 mb-2',
        2: 'text-lg font-semibold mt-3 mb-2',
        3: 'text-base font-semibold mt-2 mb-1',
        4: 'text-sm font-semibold mt-2 mb-1',
        5: 'text-sm font-medium mt-1 mb-1',
        6: 'text-xs font-medium mt-1 mb-1',
      }
      result.push(`<h${level} class="${sizes[level]} text-white">${text}</h${level}>`)
      continue
    }

    // 无序列表
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>')
        result.push('<ul class="list-disc list-inside space-y-1 text-sm text-[var(--cine-text-2)]">')
        inList = true
        listType = 'ul'
      }
      result.push(`<li>${processInlineMarkdown(ulMatch[1])}</li>`)
      continue
    }

    // 有序列表
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>')
        result.push('<ol class="list-decimal list-inside space-y-1 text-sm text-[var(--cine-text-2)]">')
        inList = true
        listType = 'ol'
      }
      result.push(`<li>${processInlineMarkdown(olMatch[1])}</li>`)
      continue
    }

    // 非列表行关闭列表
    if (inList) {
      result.push(listType === 'ol' ? '</ol>' : '</ul>')
      inList = false
      listType = null
    }

    // 空行
    if (line.trim() === '') continue

    // 普通段落
    result.push(`<p class="text-sm text-[var(--cine-text-2)] mb-2">${processInlineMarkdown(line)}</p>`)
  }

  if (inList) {
    result.push(listType === 'ol' ? '</ol>' : '</ul>')
  }

  return result.join('\n')
}

function processInlineMarkdown(text: string): string {
  let result = text
  result = result.replace(/`([^`]+)`/g, '<code class="rounded bg-[var(--cine-surface)] px-1.5 py-0.5 text-xs text-[var(--cine-gold)]">$1</code>')
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong class="text-white">$1</strong>')
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/_(.+?)_/g, '<em>$1</em>')
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-[var(--cine-gold)] underline" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  return result
}


// ========================
// 主页面组'// ========================

export default function AdminHelpArticlesPage() {
  const [articles, setArticles] = useState<HelpArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 表单状态
  const [showForm, setShowForm] = useState(false)
  const [editingArticle, setEditingArticle] = useState<HelpArticle | null>(null)
  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    section: 'quickstart' as SectionType,
    content: '',
    sortOrder: 0,
    isPublished: true,
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<HelpArticle | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // 内联排序编辑
  const [editingSortId, setEditingSortId] = useState<string | null>(null)
  const [editingSortValue, setEditingSortValue] = useState('')

  // 加载文章列表
  const fetchArticles = useCallback(() => {
    setLoading(true)
    setError('')

    fetch('/api/admin/help-articles')
      .then((res) => {
        if (!res.ok) throw new Error('获取文章列表失败')
        return res.json()
      })
      .then((data) => {
        // ?sortOrder 升序排列
        const sorted = (data.articles || []).sort(
          (a: HelpArticle, b: HelpArticle) => a.sortOrder - b.sortOrder
        )
        setArticles(sorted)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  // Markdown 预览
  const previewHtml = useMemo(() => {
    if (!formData.content) return '<p class="text-[var(--cine-text-3)] text-sm">预览区域（输?Markdown 内容后显示)</p>'
    return renderMarkdownPreview(formData.content)
  }, [formData.content])

  // 打开新增表单
  function handleCreate() {
    setEditingArticle(null)
    setFormData({
      title: '',
      slug: '',
      section: 'quickstart',
      content: '',
      sortOrder: 0,
      isPublished: true,
    })
    setFormError('')
    setShowForm(true)
  }

  // 打开编辑表单
  function handleEdit(article: HelpArticle) {
    setEditingArticle(article)
    setFormData({
      title: article.title,
      slug: article.slug,
      section: article.section as SectionType,
      content: article.content,
      sortOrder: article.sortOrder,
      isPublished: article.isPublished,
    })
    setFormError('')
    setShowForm(true)
  }

  // 标题变更时自动生?slug（仅新建时)
  function handleTitleChange(title: string) {
    setFormData((prev) => ({
      ...prev,
      title,
      slug: editingArticle ? prev.slug : generateSlug(title),
    }))
  }

  // 提交表单
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormLoading(true)
    setFormError('')

    try {
      const url = editingArticle
        ? `/api/admin/help-articles/${editingArticle.id}`
        : '/api/admin/help-articles'
      const method = editingArticle ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || '操作失败')
      }

      setShowForm(false)
      fetchArticles()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setFormLoading(false)
    }
  }

  // 删除文章
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)

    try {
      const res = await fetch(`/api/admin/help-articles/${deleteTarget.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || '删除失败')
      }

      setDeleteTarget(null)
      fetchArticles()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleteLoading(false)
    }
  }

  // 内联排序保存
  async function handleSortSave(id: string) {
    const newSortOrder = parseInt(editingSortValue, 10)
    if (isNaN(newSortOrder)) {
      setEditingSortId(null)
      return
    }

    try {
      const res = await fetch(`/api/admin/help-articles/${id}/sort`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: newSortOrder }),
      })

      if (!res.ok) throw new Error('更新排序失败')

      setEditingSortId(null)
      fetchArticles()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '更新排序失败')
      setEditingSortId(null)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">帮助文章</h1>
        <button
          onClick={handleCreate}
          className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
        >
          + 新增文章
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* 文章列表表格 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cine-line-2)] px-4 py-3">
          <h2 className="text-lg font-semibold text-white/90">文章列表</h2>
          <span className="text-sm text-[var(--cine-text-3)]">共 {articles.length} 篇</span>
        </div>

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
                  <th className="px-4 py-3 font-medium">板块</th>
                  <th className="px-4 py-3 font-medium">排序</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">更新时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {articles.map((article) => (
                  <tr key={article.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                    <td className="px-4 py-3">
                      <div className="max-w-[240px]">
                        <div className="truncate font-medium text-white/90">
                          {article.title}
                        </div>
                        <div className="truncate text-xs text-[var(--cine-text-3)]">
                          /{article.slug}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          SECTION_COLORS[article.section] || 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
                        }`}
                      >
                        {SECTION_LABELS[article.section] || article.section}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingSortId === article.id ? (
                        <input
                          type="number"
                          value={editingSortValue}
                          onChange={(e) => setEditingSortValue(e.target.value)}
                          onBlur={() => handleSortSave(article.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSortSave(article.id)
                            if (e.key === 'Escape') setEditingSortId(null)
                          }}
                          className="w-16 rounded border border-white/20 bg-[var(--cine-surface)] px-2 py-1 text-center text-sm text-white outline-none focus:border-[var(--cine-gold)]"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingSortId(article.id)
                            setEditingSortValue(String(article.sortOrder))
                          }}
                          className="rounded px-2 py-1 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
                          title="点击编辑排序"
                        >
                          {article.sortOrder}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          article.isPublished
                            ? 'bg-green-500/10 text-[var(--cine-green)]'
                            : 'bg-[var(--cine-surface)] text-[var(--cine-text-3)]'
                        }`}
                      >
                        {article.isPublished ? '已发': '草稿'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {new Date(article.updatedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(article)}
                          className="rounded-lg bg-[var(--cine-gold-dim)] px-3 py-1.5 text-xs font-medium text-[var(--cine-gold)] transition-colors hover:bg-[var(--cine-gold-dim)]"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => setDeleteTarget(article)}
                          className="rounded-lg bg-red-600/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/20"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                      暂无帮助文章，点?ldquo;新增文章&rdquo;创建第一'                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* 新增/编辑表单弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-8">
          <div className="w-full max-w-5xl rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                {editingArticle ? '编辑文章' : '新增文章'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg p-1.5 text-[var(--cine-text-3)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* 基本信息?*/}
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">标题</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--cine-gold)]"
                    placeholder="输入文章标题"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">板块</label>
                  <select
                    value={formData.section}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, section: e.target.value as SectionType }))
                    }
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--cine-gold)]"
                  >
                    {SECTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[var(--cine-surface)]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">排序权重</label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, sortOrder: parseInt(e.target.value, 10) || 0 }))
                    }
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--cine-gold)]"
                  />
                </div>
              </div>

              {/* Slug + 发布状态?*/}
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">Slug（URL 路径)</label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--cine-gold)]"
                    placeholder="auto-generated-from-title"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex cursor-pointer items-center gap-3">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={formData.isPublished}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, isPublished: e.target.checked }))
                        }
                        className="peer sr-only"
                      />
                      <div className="h-6 w-11 rounded-full bg-[var(--cine-surface)] peer-checked:bg-[var(--cine-gold)] transition-colors" />
                      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                    </div>
                    <span className="text-sm text-[var(--cine-text-2)]">
                      {formData.isPublished ? '已发': '草稿'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Markdown 编辑器+ 实时预览（分栏) */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">内容（Markdown</label>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* 编辑器*/}
                  <div>
                    <textarea
                      value={formData.content}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, content: e.target.value }))
                      }
                      required
                      rows={16}
                      className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-[var(--cine-gold)] resize-none"
                      placeholder="输入 Markdown 内容..."
                    />
                  </div>
                  {/* 预览 */}
                  <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4 overflow-y-auto max-h-[400px]">
                    <div className="mb-2 text-xs font-medium text-[var(--cine-text-3)] uppercase tracking-wider">
                      预览
                    </div>
                    <div
                      className="prose-invert"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={formLoading}
                  className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)] disabled:opacity-50"
                >
                  {formLoading ? '保存中?..' : editingArticle ? '保存更改' : '创建文章'}
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
              确定要删除文章「{deleteTarget.title}」吗？此操作不可撤'            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? '删除中?..' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
