'use client'

/**
 * Dashboard 主页面
 *
 * 显示用户项目列表，集成新手引导组件：
 * - WelcomeWizard：WELCOME_WIZARD 步骤为 NOT_COMPLETED 时显示
 * - DashboardGuide：自管理激活条件（WELCOME_WIZARD 完成后、DASHBOARD_TOOLTIP 未完成时）
 * - 示例项目显示"示例项目"Badge
 * - "新建项目"按钮添加 data-onboarding 属性供引导定位
 *
 * Requirements: 1.2, 2.3, 3.1, 6.3, 9.4
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { HelpEntryLink } from '@/components/help/help-entry-link'
import { WelcomeWizard } from '@/components/onboarding/welcome-wizard'
import { DashboardGuide } from '@/components/onboarding/dashboard-guide'
import { useOnboardingContext } from '@/components/onboarding/onboarding-provider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ProjectItem {
  id: string
  name: string
  coverUrl: string | null
  status: string
  isSample: boolean
  createdAt: string
  shotCount: number
  completedCount: number
}

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  PARSING: { text: '解析中', color: 'bg-[var(--cine-amber-dim)] text-[var(--cine-amber)]' },
  EDITABLE: { text: '可编辑', color: 'bg-[var(--cine-green-dim)] text-[var(--cine-green)]' },
  GENERATING: { text: '生成中', color: 'bg-[var(--cine-amber-dim)] text-[var(--cine-amber)]' },
  PARTIAL: { text: '部分完成', color: 'bg-[var(--cine-amber-dim)] text-[var(--cine-amber)]' },
  COMPLETED: { text: '已完成', color: 'bg-[var(--cine-green-dim)] text-[var(--cine-green)]' },
  EXPORTED: { text: '已导出', color: 'bg-[var(--cine-green-dim)] text-[var(--cine-green)]' },
  FAILED: { text: '失败', color: 'bg-[var(--cine-red-dim)] text-[var(--cine-red)]' },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const { progress } = useOnboardingContext()

  // 根据引导进度确定是否显示 WelcomeWizard
  const showWelcomeWizard = progress?.steps.WELCOME_WIZARD === 'NOT_COMPLETED'

  function loadProjects() {
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadProjects()
  }, [])

  function handleDelete(e: React.MouseEvent, projectId: string, projectName: string) {
    e.preventDefault()
    e.stopPropagation()
    setPendingDelete({ id: projectId, name: projectName })
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleteDialogOpen(false)

    setDeletingId(pendingDelete.id)
    try {
      const res = await fetch(`/api/projects/${pendingDelete.id}`, { method: 'DELETE' })
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id))
        toast.success('项目已删除')
      } else {
        const data = await res.json()
        const errorMsg = typeof data.error === 'object' ? data.error.message : data.error
        toast.error(errorMsg || '删除失败')
      }
    } catch {
      toast.error('网络错误，请稍后重试')
    } finally {
      setDeletingId(null)
      setPendingDelete(null)
    }
  }

  return (
    <div>
      {/* 新手引导 - WelcomeWizard */}
      <WelcomeWizard open={!!showWelcomeWizard} />

      {/* 新手引导 - DashboardGuide（自管理激活条件） */}
      <DashboardGuide />

      {/* 标题区 */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">我的项目</h1>
        <Link
          href="/dashboard/project/new"
          data-onboarding="new-project"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建项目
        </Link>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-20">
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
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <p className="mb-2 text-lg font-medium text-[var(--cine-text-2)]">还没有项目</p>
          <p className="mb-6 text-sm text-[var(--cine-text-3)]">上传一段视频开始创作</p>
          <Link
            href="/dashboard/project/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建项目
          </Link>
        </div>
      )}

      {/* 项目网格 */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const statusInfo = STATUS_LABELS[project.status] || {
              text: project.status,
              color: 'bg-gray-500/20 text-gray-400',
            }

            return (
              <Link
                key={project.id}
                href={`/dashboard/project/${project.id}`}
                className="group overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] transition-all hover:border-[var(--cine-line-2)] hover:bg-[#161618]"
              >
                {/* 封面 */}
                <div className="relative aspect-video w-full bg-[var(--cine-bg)]">
                  {/* 示例项目 Badge */}
                  {project.isSample && (
                    <span className="absolute left-2 top-2 z-10 rounded-md bg-[var(--cine-gold)] px-2 py-0.5 text-xs font-medium text-[var(--cine-ink)]">
                      示例项目
                    </span>
                  )}

                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDelete(e, project.id, project.name)}
                    disabled={deletingId === project.id}
                    className="absolute right-2 top-2 z-10 rounded-lg bg-black/60 p-1.5 text-[var(--cine-text-2)] opacity-0 transition-all hover:bg-red-600/80 hover:text-white group-hover:opacity-100 disabled:opacity-50"
                    title="删除项目"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  {project.coverUrl ? (
                    <img
                      src={project.coverUrl}
                      alt={project.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <svg
                        className="h-12 w-12 text-white/10"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                {/* 卡片信息 */}
                <div className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <h3 className="truncate text-sm font-medium text-white group-hover:text-white/90">
                      {project.name}
                    </h3>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs ${statusInfo.color}`}
                    >
                      {statusInfo.text}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--cine-text-3)]">
                    <span>{formatDate(project.createdAt)}</span>
                    <span>
                      {project.completedCount}/{project.shotCount} 镜
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* 底部帮助入口 */}
      <HelpEntryLink className="mt-10" />

      {/* 删除项目确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除项目「{pendingDelete?.name}」？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDelete(null) }}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
