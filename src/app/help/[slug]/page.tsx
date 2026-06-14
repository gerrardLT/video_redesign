'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

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
  createdAt: string
  updatedAt: string
}

interface TocItem {
  id: string
  text: string
  level: number
}

// ========================
// Markdown 渲染工具
// ========================

/**
 * 从 Markdown 内容中提取标题生成目录
 */
function extractToc(markdown: string): TocItem[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm
  const toc: TocItem[] = []
  let match

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length
    const text = match[2].trim()
    const id = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')

    toc.push({ id, text, level })
  }

  return toc
}

/**
 * 简易 Markdown → HTML 渲染器
 * 支持：标题、段落、代码块、行内代码、粗体、斜体、链接、列表、引用、分隔线
 */
function renderMarkdown(markdown: string): string {
  let html = markdown

  // 代码块（``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code.trimEnd())
    return `<pre class="md-code-block"><code class="language-${lang || 'text'}">${escaped}</code></pre>`
  })

  // 分割为行处理
  const lines = html.split('\n')
  const result: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' | null = null
  let inBlockquote = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // 跳过已处理的代码块
    if (line.includes('<pre class="md-code-block">')) {
      // 把代码块完整收集
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
      if (inBlockquote) {
        result.push('</blockquote>')
        inBlockquote = false
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
      result.push('<hr class="md-hr" />')
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
      if (inBlockquote) {
        result.push('</blockquote>')
        inBlockquote = false
      }
      const level = headingMatch[1].length
      const text = processInline(headingMatch[2])
      const id = headingMatch[2]
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
      result.push(`<h${level} id="${id}" class="md-h${level}">${text}</h${level}>`)
      continue
    }

    // 引用块
    if (line.startsWith('> ')) {
      if (inList) {
        result.push(listType === 'ol' ? '</ol>' : '</ul>')
        inList = false
        listType = null
      }
      if (!inBlockquote) {
        result.push('<blockquote class="md-blockquote">')
        inBlockquote = true
      }
      result.push(`<p>${processInline(line.slice(2))}</p>`)
      continue
    } else if (inBlockquote) {
      result.push('</blockquote>')
      inBlockquote = false
    }

    // 无序列表
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>')
        result.push('<ul class="md-ul">')
        inList = true
        listType = 'ul'
      }
      result.push(`<li>${processInline(ulMatch[1])}</li>`)
      continue
    }

    // 有序列表
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>')
        result.push('<ol class="md-ol">')
        inList = true
        listType = 'ol'
      }
      result.push(`<li>${processInline(olMatch[1])}</li>`)
      continue
    }

    // 非列表行，关闭列表
    if (inList) {
      result.push(listType === 'ol' ? '</ol>' : '</ul>')
      inList = false
      listType = null
    }

    // 空行
    if (line.trim() === '') {
      continue
    }

    // 普通段落
    result.push(`<p class="md-p">${processInline(line)}</p>`)
  }

  // 关闭未结束的标签
  if (inList) {
    result.push(listType === 'ol' ? '</ol>' : '</ul>')
  }
  if (inBlockquote) {
    result.push('</blockquote>')
  }

  return result.join('\n')
}

/**
 * 处理行内 Markdown 元素
 */
function processInline(text: string): string {
  let result = text

  // 行内代码
  result = result.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // 斜体
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/_(.+?)_/g, '<em>$1</em>')

  // 链接
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>'
  )

  // 图片
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="md-img" />'
  )

  return result
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ========================
// 页面组件
// ========================

export default function HelpArticlePage() {
  const params = useParams()
  const slug = params.slug as string

  const [article, setArticle] = useState<HelpArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string>('')

  // 获取文章数据
  useEffect(() => {
    if (!slug) return

    fetch(`/api/help-articles/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('文档不存在')
        return res.json()
      })
      .then((data) => setArticle(data.article))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  // 提取目录
  const toc = useMemo(() => {
    if (!article) return []
    return extractToc(article.content)
  }, [article])

  // 渲染 Markdown
  const renderedContent = useMemo(() => {
    if (!article) return ''
    return renderMarkdown(article.content)
  }, [article])

  // 滚动监听，高亮当前目录项
  useEffect(() => {
    if (toc.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -80% 0px', threshold: 0 }
    )

    // 延迟注册 observer，等待 DOM 渲染完成
    const timer = setTimeout(() => {
      toc.forEach((item) => {
        const el = document.getElementById(item.id)
        if (el) observer.observe(el)
      })
    }, 100)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [toc, renderedContent])

  // 点击目录项滚动到对应位置
  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  // 加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--cine-bg)]">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-48 rounded bg-[var(--cine-surface)]" />
            <div className="h-10 w-96 rounded bg-[var(--cine-surface)]" />
            <div className="mt-8 space-y-3">
              <div className="h-4 w-full rounded bg-[var(--cine-surface)]" />
              <div className="h-4 w-5/6 rounded bg-[var(--cine-surface)]" />
              <div className="h-4 w-4/6 rounded bg-[var(--cine-surface)]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 错误状态
  if (error || !article) {
    return (
      <div className="min-h-screen bg-[var(--cine-bg)]">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="flex flex-col items-center justify-center py-20">
            <svg
              className="mb-4 h-16 w-16 text-[var(--cine-text-3)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="mb-2 text-lg font-medium text-[var(--cine-text-2)]">
              {error || '文档不存在'}
            </p>
            <Link
              href="/help"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
            >
              返回帮助中心
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--cine-bg)]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 border-b border-[var(--cine-line)] bg-[var(--cine-bg-80)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:text-white"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            帮助中心
          </Link>
          <span className="text-[var(--cine-text-3)]">/</span>
          <span className="truncate text-sm text-[var(--cine-text)]">{article.title}</span>
        </div>
      </header>

      {/* 主体布局 */}
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        {/* 侧边目录 */}
        {toc.length > 0 && (
          <aside className="hidden w-56 shrink-0 lg:block">
            <nav className="sticky top-20">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--cine-text-3)]">
                目录
              </h4>
              <ul className="space-y-1">
                {toc.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => scrollToHeading(item.id)}
                      className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm transition-colors ${
                        item.level === 2 ? 'pl-2' : 'pl-5'
                      } ${
                        activeId === item.id
                          ? 'bg-[var(--cine-gold-dim)] text-[var(--cine-gold)]'
                          : 'text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-[var(--cine-text)]'
                      }`}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}

        {/* 文章正文 */}
        <article className="min-w-0 flex-1">
          <h1 className="mb-6 text-3xl font-bold text-white">{article.title}</h1>

          {/* Markdown 渲染内容 */}
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </article>
      </div>
    </div>
  )
}
