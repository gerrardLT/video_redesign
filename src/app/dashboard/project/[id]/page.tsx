'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { InsufficientCreditsDialog } from '@/components/project/insufficient-credits-dialog'
import Stepper from '@/components/project/stepper'
import { useProjectSteps, type ProjectDetailData } from '@/hooks/use-project-steps'
import { HelpEntryLink } from '@/components/help/help-entry-link'
import { StepHelpButton } from '@/components/help/step-help-button'
import ShotGroupList, { type ShotGroupData } from '@/components/shot/ShotGroupList'
import CharacterPanel, { type Character } from '@/components/shot/CharacterPanel'
import { StyleConfigEditor } from '@/components/project/style-config-editor'
import { EditorGuide } from '@/components/onboarding/editor-guide'
import { EngineSelector } from '@/components/editor/engine-selector'
import { HappyHorseGeneratePanel } from '@/components/editor/happyhorse-generate-panel'
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

interface ProjectDetail {
  id: string
  name: string
  videoUrl: string | null
  coverUrl: string | null
  exportedVideoUrl: string | null
  status: string
  duration: number | null
  aspectRatio: string | null
  errorMsg: string | null
  createdAt: string
  updatedAt: string
  shotCount: number
  engine?: string // 生成引擎: seedance | happyhorse
  // Stepper 步骤状态计算所需字段
  shots?: { genStatus: string }[]
  characters?: { enabled: boolean }[]
  assets?: { status: string }[]
  styleConfig?: { templateId?: string | null; customDescription?: string | null; structuredStyle?: string | null } | null
  // 分镜组列表（来自 GET /api/projects/[id]，按组合并生成所需的真实后端状态)
  shotGroups?: ShotGroupData[]
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reparsing, setReparsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showReparseDialog, setShowReparseDialog] = useState(false)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const res = await fetch(`/api/projects/${params.id}`)
        if (!active) return
        if (!res.ok) {
          if (res.status === 404) {
            setError('项目不存在')
            setLoading(false)
            return
          }
          throw new Error('获取项目详情失败')
        }
        const data = await res.json()
        if (!active) return
        setProject(data.project)
        setError(null)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : '未知错误')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [params.id])

  // 解析中/下载中状态轮询（覆盖 DOWNLOADING → PARSING → EDITABLE 全流程）
  useEffect(() => {
    if (project?.status !== 'PARSING' && project?.status !== 'DOWNLOADING') return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${params.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (isMounted.current) {
          setProject(data.project)
        }
      } catch {
        // 轮询失败静默处理
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [project?.status, params.id])

  // 重新解析（needConfirm=true 时弹确认，用于已解析成功的项目——会清空分镜/编辑/风格并重新扣积分)
  async function handleReparse(needConfirm = false) {
    if (needConfirm) {
      setShowReparseDialog(true)
      return
    }
    await executeReparse()
  }

  // 执行重新解析
  async function executeReparse() {
    setShowReparseDialog(false)
    setReparsing(true)
    try {
      const res = await fetch(`/api/projects/${params.id}/reparse`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '重新解析失败')
        return
      }
      // 重新获取项目信息
      const projRes = await fetch(`/api/projects/${params.id}`)
      if (projRes.ok) {
        const data = await projRes.json()
        setProject(data.project)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setReparsing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-[var(--cine-text-2)]">加载中...</p>
        </div>
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-[var(--cine-text)]">{error}</p>
          <Button variant="outline" onClick={() => router.push('/dashboard')}>
            返回项目列表
          </Button>
        </div>
      </div>
    )
  }

  if (!project) return null

  // 将 ProjectDetail 转换为 useProjectSteps 需要的 ProjectDetailData
  const projectStepsData: ProjectDetailData = {
    videoUrl: project.videoUrl,
    status: project.status,
    shots: project.shots,
    characters: project.characters,
    assets: project.assets,
    styleConfig: project.styleConfig,
  }

  return (
    <div className="space-y-6">
      {/* 新手引导 - Editor 引导组件（不阻塞编辑器正常功能） */}
      <EditorGuide />

      {/* 顶部项目信息 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-lg p-2 text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
            aria-label="返回项目列表"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-white">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
      </div>

      {/* Stepper 步骤引导 */}
      <ProjectStepper project={projectStepsData} />

      {/* 根据状态显示不同内容 */}
      {project.status === 'PARSING' && <ParsingState />}
      {project.status === 'FAILED' && (
        // 如果有分镜组数据（解析已成功），展示可编辑状态让用户重新生成；
        // 仅在真正解析失败（无分镜组）时才展示"重新解析"
        project.shotGroups && project.shotGroups.length > 0 ? (
          <EditableState project={project} onReparse={() => handleReparse(true)} reparsing={reparsing} />
        ) : (
          <FailedState
            errorMsg={project.errorMsg}
            onReparse={() => handleReparse(false)}
            reparsing={reparsing}
          />
        )
      )}
      {project.status === 'EDITABLE' && (
        <EditableState project={project} onReparse={() => handleReparse(true)} reparsing={reparsing} />
      )}
      {!['PARSING', 'FAILED', 'EDITABLE'].includes(project.status) && (
        <EditableState project={project} onReparse={() => handleReparse(true)} reparsing={reparsing} />
      )}

      {/* 重新解析确认对话框 */}
      <AlertDialog open={showReparseDialog} onOpenChange={setShowReparseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新解析</AlertDialogTitle>
            <AlertDialogDescription>
              重新解析将删除当前所有分镜、人物、分组、风格设定和你的手动编辑，并重新消耗解析积分。确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowReparseDialog(false)}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={executeReparse}>
              确认重新解析
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Stepper 步骤引导包装组件
function ProjectStepper({ project }: { project: ProjectDetailData }) {
  const { steps } = useProjectSteps(project)

  return (
    <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Stepper steps={steps} />
        </div>
        <StepHelpButton />
      </div>
    </div>
  )
}

// 状态标签组件
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    PARSING: { label: '解析中', className: 'bg-blue-500/10 text-blue-400' },
    EDITABLE: { label: '可编辑', className: 'bg-green-500/10 text-[var(--cine-green)]' },
    GENERATING: { label: '生成中', className: 'bg-purple-500/10 text-purple-400' },
    PARTIAL: { label: '部分完成', className: 'bg-yellow-500/10 text-yellow-400' },
    COMPLETED: { label: '已完成', className: 'bg-green-500/10 text-[var(--cine-green)]' },
    EXPORTED: { label: '已导出', className: 'bg-emerald-500/10 text-emerald-400' },
    FAILED: { label: '解析失败', className: 'bg-red-500/10 text-red-400' },
  }

  const { label, className } = config[status] || { label: status, className: 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]' }

  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// 解析中状态
function ParsingState() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <Spinner size="lg" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-white">正在解析视频...</p>
          <p className="mt-1 text-sm text-[var(--cine-text-2)]">
            系统正在分析视频内容并生成分镜，这可能需要 1-3 分钟
          </p>
        </div>
      </div>
    </div>
  )
}

// 失败状态
function FailedState({
  errorMsg,
  onReparse,
  reparsing,
}: {
  errorMsg: string | null
  onReparse: () => void
  reparsing: boolean
}) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <svg className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-white">视频解析失败</p>
          {errorMsg && (
            <p className="mt-1 max-w-md text-sm text-[var(--cine-text-2)]">{errorMsg}</p>
          )}
        </div>
        <Button
          onClick={onReparse}
          disabled={reparsing}
          className="mt-2"
        >
          {reparsing ? (
            <>
              <Spinner size="sm" />
              重新解析中...
            </>
          ) : (
            <>
              <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              重新解析
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// 可编辑状态 - 分镜组列表（唯一视图)
function EditableState({ project, onReparse, reparsing }: { project: ProjectDetail; onReparse: () => void; reparsing: boolean }) {
  const router = useRouter()
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false)
  const [creditsInfo, setCreditsInfo] = useState({ currentBalance: 0, requiredCredits: 0 })
  const [currentEngine, setCurrentEngine] = useState<'seedance' | 'happyhorse'>(
    project.engine === 'happyhorse' ? 'happyhorse' : 'seedance'
  )

  // 基于 shotGroups 判断导出按钮可用性
  // initialAllSucceeded 来自父级（页面加载时的快照，可能滞后于实际生成进度)
  const initialAllSucceeded =
    (project.shotGroups ?? []).length > 0 &&
    (project.shotGroups ?? []).every((g) => g.genStatus === 'SUCCEEDED')
  // liveAllSucceeded 由 ShotGroupList 内部轮询实时上报，优先采用，解决卡片已完成但按钮仍置灰的不同步问题
  const [liveAllSucceeded, setLiveAllSucceeded] = useState<boolean | null>(null)
  const allGroupsSucceeded = liveAllSucceeded ?? initialAllSucceeded

  // 人物形象（锚定图)面板数据：独立拉取完整人物列表（含 appearance/imageUrl/avatarStatus)
  const [characters, setCharacters] = useState<Character[]>([])
  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/characters`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.characters)) setCharacters(data.characters)
    } catch {
      // 拉取失败不阻塞页面，下次轮询/手动刷新重试
    }
  }, [project.id])

  useEffect(() => {
    fetchCharacters()
  }, [fetchCharacters])

  // 形象生成中轮询：存在启用人物尚无锚定图且未失败时，定期刷新直至就绪/失败
  const anchorPending = characters.some(
    (c) => c.enabled && !c.imageUrl && c.avatarStatus !== 'FAILED'
  )
  useEffect(() => {
    if (!anchorPending) return
    const interval = setInterval(fetchCharacters, 4000)
    return () => clearInterval(interval)
  }, [anchorPending, fetchCharacters])

  // 护栏：存在启用人物但其形象锚定图未就绪（缺 imageUrl 或非 ACTIVE)
  // 未就绪时生成视频会退化为外貌文字描述，人物易前后不一致，故在生成入口给出拦截/提示
  const anchorMissing = characters.some(
    (c) => c.enabled && !(c.imageUrl && c.avatarStatus === 'ACTIVE')
  )

  const handleExport = useCallback(() => {
    router.push(`/dashboard/project/${project.id}/export`)
  }, [router, project.id])

  // 导出按钮禁用原因
  const exportDisabledReason = (() => {
    if ((project.shotGroups ?? []).length === 0) return '暂无分镜组'
    if (!allGroupsSucceeded) return '请先完成所有分镜组的生成'
    return ''
  })()

  return (
    <div className="space-y-4">
      {/* 项目信息概览 */}
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--cine-text-3)]">时长</p>
            <p className="mt-0.5 text-sm text-white">
              {project.duration ? `${project.duration.toFixed(1)}s` : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--cine-text-3)]">分辨率</p>
            <p className="mt-0.5 text-sm text-white">
              {project.aspectRatio || '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--cine-text-3)]">分镜数</p>
            <p className="mt-0.5 text-sm text-white">{project.shotCount}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--cine-text-3)]">创建时间</p>
            <p className="mt-0.5 text-sm text-white">
              {new Date(project.createdAt).toLocaleDateString('zh-CN')}
            </p>
          </div>
        </div>
      </div>

      {/* 引擎选择（Seedance / HappyHorse 切换） */}
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
        <p className="text-xs text-[var(--cine-text-3)] mb-2">生成引擎</p>
        <EngineSelector
          projectId={project.id}
          currentEngine={currentEngine}
          onEngineChange={setCurrentEngine}
          disabled={project.status === 'GENERATING'}
        />
      </div>

      {/* HappyHorse 模式生成面板（仅引擎为 happyhorse 时显示） */}
      {currentEngine === 'happyhorse' && (
        <div className="rounded-xl border border-green-900/30 bg-green-950/20 p-4">
          <HappyHorseGeneratePanel
            projectId={project.id}
            videoDuration={project.duration ?? 0}
            originalVideoUrl={project.videoUrl ?? ''}
            disabled={project.status === 'GENERATING'}
          />
        </div>
      )}

      {/* 操作按钮栏（Seedance 模式） */}
      <div id="generate-section" className="flex items-center gap-3" data-onboarding="generate-btn">
        <Button
          variant="outline"
          disabled={!allGroupsSucceeded}
          onClick={handleExport}
          title={exportDisabledReason}
          className={!allGroupsSucceeded ? 'cursor-not-allowed opacity-50' : ''}
        >
          合并导出
        </Button>
        <Button
          variant="outline"
          disabled={reparsing}
          onClick={onReparse}
          title="删除当前分镜并按最新规则重新解析（消耗解析积分)"
          className={reparsing ? 'cursor-not-allowed opacity-50' : ''}
        >
          {reparsing ? '重新解析中...' : '重新解析'}
        </Button>
        {!allGroupsSucceeded && exportDisabledReason && (
          <span className="text-xs text-[var(--cine-text-3)]">{exportDisabledReason}</span>
        )}
        <span className="ml-auto text-xs text-[var(--cine-text-3)]">
          编辑、导出免费，解析与视频生成消耗积分
        </span>
      </div>

      {/* 主内容区域：原始视频预览 + 分镜组列表 */}
      <div className="flex flex-col gap-4">
        {/* 原始视频预览 */}
        {project.videoUrl && (
          <VideoPlayer
            src={project.videoUrl}
            poster={project.coverUrl || undefined}
            className="w-full h-[240px] border border-[var(--cine-line-2)]"
          />
        )}

        {/* 全局一致性设定（风格/色调/人物外貌，AI 自动提取，用户可手动编辑) */}
        <div data-onboarding="prompt-editor">
          <StyleConfigEditor
            projectId={project.id}
            initialStructured={
              project.styleConfig?.structuredStyle
                ? (() => { try { return JSON.parse(project.styleConfig.structuredStyle) } catch { return null } })()
                : null
            }
            initialDescription={project.styleConfig?.customDescription ?? null}
            editable={project.status === 'EDITABLE' || project.status === 'FAILED'}
          />
        </div>

        {/* 人物形象（确认形象)：生成全片唯一人物锚定图，作每组生成的 reference_image */}
        <div data-onboarding="character-panel">
          <CharacterPanel
            projectId={project.id}
            characters={characters}
            onUpdate={fetchCharacters}
          />
        </div>

        {/* 分镜组列表（唯一视图) */}
        <div data-onboarding="shot-list">
          <ShotGroupList
            projectId={project.id}
            initialGroups={project.shotGroups ?? []}
            aspectRatio={project.aspectRatio}
            onAllSucceededChange={setLiveAllSucceeded}
            anchorMissing={anchorMissing}
            characterLibrary={characters}
          />
        </div>
      </div>

      {/* 底部帮助入口 */}
      <HelpEntryLink className="mt-4" />

      {/* 余额不足弹窗 */}
      <InsufficientCreditsDialog
        open={creditsDialogOpen}
        onClose={() => setCreditsDialogOpen(false)}
        currentBalance={creditsInfo.currentBalance}
        requiredCredits={creditsInfo.requiredCredits}
      />
    </div>
  )
}

// 加载动画组件
function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  }[size]

  return (
    <svg
      className={`animate-spin text-[var(--cine-gold)] ${sizeClass}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
