'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * 步骤名称到帮助页面锚点的映射
 * 帮助中心的教程按 section-{id} 锚点定位各步骤内容
 */
const STEP_HELP_MAP: { label: string; slug: string; sectionId: number }[] = [
  { label: '上传视频', slug: 'upload-video', sectionId: 2 },
  { label: 'AI 解析', slug: 'ai-parsing', sectionId: 3 },
  { label: '确认形象', slug: 'confirm-character', sectionId: 6 },
  { label: '参考素材', slug: 'reference-assets', sectionId: 4 },
  { label: '设置风格', slug: 'set-style', sectionId: 5 },
  { label: '生成视频', slug: 'generate-video', sectionId: 7 },
  { label: '合并导出', slug: 'export-video', sectionId: 9 },
]

/**
 * 帮助按钮（带下拉菜单)
 * 放置在 Stepper 旁边，点击展示各步骤对应的帮助文档链接
 */
export function StepHelpButton() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* 帮助图标按钮 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full border border-[var(--cine-line-2)] text-[var(--cine-text-2)] transition-all hover:border-[var(--cine-gold)]/50 hover:text-[var(--cine-gold)]',
          open && 'border-[var(--cine-gold)]/50 text-[var(--cine-gold)] bg-[var(--cine-gold-dim)]'
        )}
        aria-label="查看各步骤帮助文档"
        aria-expanded={open}
        title="操作帮助"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* 下拉帮助菜单 */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-[var(--cine-line-2)] bg-[#1a1a1b] p-2 shadow-xl">
          <div className="mb-2 px-2 py-1">
            <p className="text-xs font-medium text-[var(--cine-text-2)]">各步骤帮助文档</p>
          </div>
          <ul className="space-y-0.5">
            {STEP_HELP_MAP.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/dashboard/help#section-${item.sectionId}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-[var(--cine-gold)]/60"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-[var(--cine-line)] pt-2">
            <Link
              href="/dashboard/help"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--cine-gold)] transition-colors hover:bg-[var(--cine-gold-dim)]"
              onClick={() => setOpen(false)}
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <span>查看完整使用手册</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
