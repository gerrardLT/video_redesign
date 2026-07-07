import { Metadata } from 'next'
import { listBySection, type GroupedArticles } from '@/lib/shared/help-center-service'
import { HelpSearchClient } from './help-search-client'

export const metadata: Metadata = {
  title: '帮助中心 - AI 视频重塑工具',
  description: '快速入门指南、详细操作说明和常见问题解答',
}

// 动态渲染：构建时不预渲染（避免构建环境无数据库连接）
export const dynamic = 'force-dynamic'

export default async function HelpCenterPage() {
  const sections: GroupedArticles = await listBySection()

  return (
    <div className="min-h-screen bg-[var(--cine-bg)]">
      {/* Hero / Header with Search */}
      <header className="border-b border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            帮助中心
          </h1>
          <p className="mt-3 text-base text-[var(--cine-text-2)]">
            快速入门、操作指南与常见问题，帮你高效完成视频创&apos;          </p>
          {/* Client-side search */}
          <HelpSearchClient />
        </div>
      </header>

      {/* Main Content - Three Sections */}
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          {/* 快速入门?*/}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cine-gold-dim)]">
                <svg className="h-4 w-4 text-[var(--cine-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">快速入门</h2>
            </div>
            <ul className="space-y-2">
              {sections.quickstart.length > 0 ? (
                sections.quickstart.map((article) => (
                  <li key={article.id}>
                    <a
                      href={`/help/${article.slug}`}
                      className="block rounded-lg px-3 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-gold)]"
                    >
                      {article.title}
                    </a>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-[var(--cine-text-3)]">暂无内容</li>
              )}
            </ul>
          </section>

          {/* 详细操作说明 */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cine-gold-dim)]">
                <svg className="h-4 w-4 text-[var(--cine-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">详细操作说明</h2>
            </div>
            <ul className="space-y-2">
              {sections.guide.length > 0 ? (
                sections.guide.map((article) => (
                  <li key={article.id}>
                    <a
                      href={`/help/${article.slug}`}
                      className="block rounded-lg px-3 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-gold)]"
                    >
                      {article.title}
                    </a>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-[var(--cine-text-3)]">暂无内容</li>
              )}
            </ul>
          </section>

          {/* 常见问题 FAQ */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cine-gold-dim)]">
                <svg className="h-4 w-4 text-[var(--cine-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">常见问题</h2>
            </div>
            <ul className="space-y-2">
              {sections.faq.length > 0 ? (
                sections.faq.map((article) => (
                  <li key={article.id}>
                    <a
                      href={`/help/${article.slug}`}
                      className="block rounded-lg px-3 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-[var(--cine-gold)]"
                    >
                      {article.title}
                    </a>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-[var(--cine-text-3)]">暂无内容</li>
              )}
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
