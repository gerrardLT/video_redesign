'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

interface HelpEntryLinkProps {
  className?: string
}

/**
 * "查看使用手册" 入口链接
 * 用于首页底部和项目详情页，引导用户前往帮助中心
 */
export function HelpEntryLink({ className }: HelpEntryLinkProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Link
        href="/dashboard/help"
        className="group inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-text)]"
      >
        {/* 书本图标 */}
        <svg
          className="h-4 w-4 text-[var(--cine-text-3)] transition-colors group-hover:text-[var(--cine-gold)]"
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
        <span>查看使用手册</span>
      </Link>
    </div>
  )
}
