'use client'

/**
 * 内容任务总览页 — /merchant/stores/[storeId]/briefs/[briefId]
 *
 * ContentBrief 的总览入口页，承接日历点击与各处「查看详情」跳转。
 * 展示任务基础信息（标题/目标/日期/状态）+ 拍摄进度，并按当前 brief 状态
 * 分发到三个子页：拍摄上传(shoot)、成片导出(variants)、数据复盘(metrics)。
 *
 * 设计目的：补齐此前缺失的 briefs/[briefId]/page.tsx（原先直接 404），
 * 并作为闭环导航枢纽，把孤儿子页 variants/metrics 接入可达路径。
 *
 * 状态门控逻辑：
 * - shoot：始终可进（拍摄/补拍）
 * - variants：brief 已生成视频（status ∈ 生成后态 或 已有 videoVariants）才可进
 * - metrics：brief 已导出/发布后才有意义（status ∈ EXPORTED/PUBLISHED），其余为「发布后可用」
 *
 * API 调用：
 * - GET /api/content-briefs/{briefId}（含 shotTasks / videoVariants / store）
 *
 * 溯源展示：内嵌 BriefProvenanceCard（需求 5.1/5.3/5.5/5.6），
 * 用通俗话术展示本条 brief 引用的门店画像依据，并提供仅对后续生效的画像调整入口。
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 15.4
 */

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Camera,
  Film,
  BarChart3,
  ChevronRight,
  Loader2,
  XCircle,
  CalendarDays,
  Clapperboard,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
  Copy,
  Image as ImageIcon,
  Lightbulb,
  Move,
  ArrowUpRight,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { BriefProvenanceCard } from '@/components/merchant'
import { useSSEProgress } from '@/hooks/use-sse-progress'

// ─── 模板推荐类型 ───

interface ShotTemplate {
  order: number
  type: string
  duration: string
  description: string
  tips: string
}

interface ContentTemplate {
  id: string
  name: string
  targetDuration: string
  platforms: string[]
  hookKeywords: string[]
  suggestedTags: string[]
  shots: ShotTemplate[]
}

// ─── 类型定义 ───

interface ShotTask {
  id: string
  order: number
  required: boolean
  status: string
}

interface VideoVariant {
  id: string
  type: string
}

interface ContentBrief {
  id: string
  title: string
  goal: string | null
  status: string
  scheduledDate: string | null
  shotTasks: ShotTask[]
  videoVariants: VideoVariant[]
}

// ─── SWR Fetcher ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || '请求失败')
  }
  return res.json()
}

// ─── 常量映射（与 calendar 页保持一致） ───

const GOAL_LABELS: Record<string, string> = {
  TRAFFIC: '午餐引流',
  PROMOTION: '爆品促销',
  NEW_PRODUCT: '招牌新品',
  TRUST_BUILDING: '人设建设',
  BRAND_STORY: '品牌故事',
  CUSTOMER_TESTIMONIAL: '顾客口碑',
  WEEKEND_BOOST: '周末预热',
  REPEAT_PURCHASE: '家庭聚餐',
}

const GOAL_ICONS: Record<string, string> = {
  TRAFFIC: '🚗',
  PROMOTION: '🔥',
  NEW_PRODUCT: '✨',
  TRUST_BUILDING: '🤝',
  BRAND_STORY: '📖',
  CUSTOMER_TESTIMONIAL: '💬',
  WEEKEND_BOOST: '🎉',
  REPEAT_PURCHASE: '💝',
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  READY_TO_SHOOT: '待拍摄',
  MATERIALS_UPLOADED: '已上传',
  RENDERING: '渲染中',
  GENERATED: '已生成',
  COMPLIANCE_REVIEW: '审查中',
  READY_TO_EXPORT: '待导出',
  EXPORTED: '已导出',
  PUBLISHED: '已发布',
  FAILED: '失败',
  ARCHIVED: '已归档',
}

/** brief 是否已生成视频（可进入成片导出页） */
const GENERATED_STATUSES = new Set([
  'GENERATED',
  'COMPLIANCE_REVIEW',
  'READY_TO_EXPORT',
  'EXPORTED',
  'PUBLISHED',
])

/** brief 是否已导出/发布（数据复盘才有意义） */
const EXPORTED_STATUSES = new Set(['EXPORTED', 'PUBLISHED'])

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'READY_TO_SHOOT':
      return 'default'
    case 'MATERIALS_UPLOADED':
    case 'RENDERING':
      return 'secondary'
    case 'GENERATED':
    case 'READY_TO_EXPORT':
    case 'EXPORTED':
    case 'PUBLISHED':
      return 'outline'
    case 'FAILED':
      return 'destructive'
    default:
      return 'secondary'
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const dayOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 ${dayOfWeek}`
}

// ─── 主页面组件 ───

export default function BriefOverviewPage() {
  const params = useParams<{ storeId: string; briefId: string }>()
  const { storeId, briefId } = params

  const { data, error, isLoading, mutate } = useSWR<{ brief: ContentBrief }>(
    `/api/content-briefs/${briefId}`,
    fetcher
  )

  const brief = data?.brief

  // 获取模板推荐
  const { data: templatesData } = useSWR<{ industry: string; templates: ContentTemplate[] }>(
    `/api/content-briefs/${briefId}/templates`,
    fetcher
  )

  const templates = templatesData?.templates ?? []

  // ─── 一键出片状态（必须在所有 early return 之前声明） ───
  const [showAutoRenderDialog, setShowAutoRenderDialog] = useState(false)
  const [autoRenderLoading, setAutoRenderLoading] = useState(false)
  const [autoRenderError, setAutoRenderError] = useState<string | null>(null)

  // ─── Inhot 创作模式状态 ───
  type SheetMode = 'replicate' | 'shortfilm' | 'idea' | 'photo' | null
  const [sheetMode, setSheetMode] = useState<SheetMode>(null)
  const [creationLoading, setCreationLoading] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)

  // ─── SSE 实时进度（复用 shoot 页同款：token 仅作启用开关，鉴权走同源 Cookie）───
  const { progressMap } = useSSEProgress(briefId, true)
  const briefEvent = progressMap.get(briefId)
  // 记录上次创作模式，供失败后「重新生成」重新打开对应面板
  const lastModeRef = useRef<SheetMode>(null)
  // 避免同一事件重复触发 toast/mutate（按 eventType+timestamp 去重）
  const lastHandledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!briefEvent) return
    const key = `${briefEvent.eventType}-${briefEvent.timestamp}`
    if (lastHandledRef.current === key) return
    if (briefEvent.eventType === 'completed') {
      lastHandledRef.current = key
      toast.success('视频生成完成')
      mutate()
    } else if (briefEvent.eventType === 'failed') {
      lastHandledRef.current = key
      mutate()
    }
  }, [briefEvent, mutate])

  // 一键出片是否可用：DRAFT 或 READY_TO_SHOOT 状态 + 有 ShotTasks
  const autoRenderAvailable =
    brief != null &&
    (brief.status === 'DRAFT' || brief.status === 'READY_TO_SHOOT') &&
    brief.shotTasks.length > 0

  /** 创作模式 API 映射 */
  const CREATION_MODE_MAP: Record<NonNullable<SheetMode>, string> = {
    replicate: 'REPLICATE_TRENDING',
    shortfilm: 'IMMERSIVE_SHORT',
    idea: 'INSPIRE_TO_VIDEO',
    photo: 'PHOTO_ANIMATE',
  }

  async function handleAutoRender() {
    if (!brief) return
    setAutoRenderLoading(true)
    setAutoRenderError(null)
    try {
      const res = await fetch(`/api/content-briefs/${briefId}/auto-render`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message || '一键出片请求失败')
      }
      setShowAutoRenderDialog(false)
      mutate()
    } catch (err) {
      setAutoRenderError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setAutoRenderLoading(false)
    }
  }

  // ─── 加载 / 错误状态 ───
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        <p className="text-[var(--ll-text-3)] text-sm">加载中...</p>
      </div>
    )
  }

  if (error || !brief) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <XCircle className="h-10 w-10 text-red-400" />
        <p className="text-red-500">{error?.message || '内容任务不存在'}</p>
        <Button variant="outline" onClick={() => mutate()}>重试</Button>
      </div>
    )
  }

  // ─── 拍摄进度 ───
  const requiredTasks = brief.shotTasks.filter((t) => t.required)
  const capturedRequired = requiredTasks.filter((t) => t.status === 'CAPTURED')
  const shootProgress = requiredTasks.length > 0
    ? Math.round((capturedRequired.length / requiredTasks.length) * 100)
    : 0

  // ─── 子页可达性门控 ───
  const hasVariants = brief.videoVariants.length > 0
  const variantsReady = GENERATED_STATUSES.has(brief.status) || hasVariants
  const metricsReady = EXPORTED_STATUSES.has(brief.status)

  const isRendering = brief.status === 'RENDERING'
  const isFailed = brief.status === 'FAILED'
  const currentStage = briefEvent?.stage ?? '排队中'

  // 打开创作面板（渲染中禁止，记录模式供失败重试复用）
  function openSheet(mode: NonNullable<SheetMode>) {
    if (isRendering) return
    lastModeRef.current = mode
    setSheetMode(mode)
    setCreationError(null)
  }

  const base = `/merchant/stores/${storeId}/briefs/${briefId}`

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* 编辑式任务信息头部 */}
      <section className="zen-reveal py-5 border-b border-[var(--ll-hair)]">
        <div className="flex items-center gap-1.5 text-sm text-[var(--ll-text-2)]">
          <span className="text-base">{GOAL_ICONS[brief.goal ?? ''] || '📋'}</span>
          <span className="font-medium text-[var(--ll-text)]">
            {GOAL_LABELS[brief.goal ?? ''] || '内容任务'}
          </span>
          <Badge variant={getStatusVariant(brief.status)} className="ml-auto text-[10px]">
            {STATUS_LABELS[brief.status] || brief.status}
          </Badge>
        </div>
        <h1 className="mt-2 text-xl font-semibold text-[var(--ll-text)] leading-snug">{brief.title}</h1>
        {brief.scheduledDate && (
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--ll-text-3)]">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(brief.scheduledDate)}
          </p>
        )}
      </section>

      {/* 横向旅程地图：拍摄 → 生成 → 导出 → 发布 */}
      <div className="zen-reveal mt-5 mb-4 px-2">
        <JourneyMap briefStatus={brief.status} basePath={base} />
      </div>

      {/* 拍摄进度 */}
      {requiredTasks.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-[var(--ll-text-2)]">拍摄进度</span>
            <span className="text-sm font-medium text-[var(--ll-text)]">
              {capturedRequired.length}/{requiredTasks.length} 个必拍镜头
            </span>
          </div>
          <Progress value={shootProgress} className="h-2.5" />
        </div>
      )}

      {/* 内容溯源展示 + 画像调整入口（需求 5.1/5.3/5.5/5.6） */}
      <div className="mt-4">
        <BriefProvenanceCard storeId={storeId} briefId={briefId} />
      </div>

      {/* 分镜模板推荐 */}
      {templates.length > 0 && (
        <TemplateRecommendation templates={templates} />
      )}

      {/* ─── Inhot 创作中心：四模式 ─── */}
      <div className="mt-6">
        <div className="flex items-center gap-2 px-1 mb-3">
          <h3 className="text-xs font-medium text-[var(--ll-text-3)] tracking-wide uppercase">创作中心</h3>
          <span className="text-[10px] text-[var(--ll-text-3)] bg-[var(--ll-surface)] px-1.5 py-0.5 rounded">4 种模式</span>
        </div>

        {/* 渲染中状态条：SSE 阶段文案 + loading（禁止重复提交） */}
        {isRendering && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 mb-2 rounded-xl border border-white/10 bg-white/[0.03]">
            <Loader2 className="h-4 w-4 animate-spin text-white/70 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--ll-text)]">视频生成中 · {currentStage}</p>
              <p className="text-[11px] text-[var(--ll-text-3)] mt-0.5">生成完成前请勿重复提交，完成后将自动刷新</p>
            </div>
          </div>
        )}

        {/* 失败提示条：已自动退款 + 重新生成 */}
        {isFailed && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 mb-2 rounded-xl border border-red-500/20 bg-red-500/[0.06]">
            <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--ll-text)]">
                生成失败{briefEvent?.metadata?.reason ? `：${String(briefEvent.metadata.reason)}` : ''}
              </p>
              <p className="text-[11px] text-[var(--ll-text-3)] mt-0.5">已自动退还冻结积分，可重新生成</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 h-7 text-xs"
              onClick={() => openSheet(lastModeRef.current ?? 'replicate')}
            >
              重新生成
            </Button>
          </div>
        )}

        {/* 复刻爆款（大卡） */}
        <button
          className={cn(
            "relative w-full h-[160px] rounded-xl overflow-hidden group mb-2 text-left",
            isRendering && "opacity-40 cursor-not-allowed"
          )}
          disabled={isRendering}
          onClick={() => openSheet('replicate')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] to-[#0a0a0a]" />
          <div className="absolute inset-0 bg-[url('https://picsum.photos/seed/viraltrend/800/500')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
          <div className="relative z-10 h-full flex flex-col justify-end p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">01 · Replicate</span>
            </div>
            <h4 className="text-base font-bold text-white flex items-center gap-1.5">
              <Copy className="h-4 w-4" /> 复刻爆款
            </h4>
            <p className="text-xs text-white/60 mt-1 leading-relaxed">粘贴爆款视频链接，AI 拆解节奏与镜头，用你的素材复刻同款</p>
          </div>
          <ArrowUpRight className="absolute top-3 right-3 h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors z-10" />
        </button>

        {/* 沉浸式短片 + 灵感生视频（并排） */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            className={cn(
              "relative h-[120px] rounded-xl overflow-hidden group text-left",
              isRendering && "opacity-40 cursor-not-allowed"
            )}
            disabled={isRendering}
            onClick={() => openSheet('shortfilm')}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#161620] to-[#0a0a0a]" />
            <div className="relative z-10 h-full flex flex-col justify-end p-3">
              <span className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">02</span>
              <h4 className="text-sm font-bold text-white flex items-center gap-1">
                <Film className="h-3.5 w-3.5" /> 沉浸式短片
              </h4>
              <p className="text-[11px] text-white/50 mt-0.5 leading-snug">素材生成有情绪的故事短片</p>
            </div>
            <ArrowUpRight className="absolute top-2 right-2 h-3.5 w-3.5 text-white/20 group-hover:text-white/50 transition-colors z-10" />
          </button>

          <button
            className={cn(
              "relative h-[120px] rounded-xl overflow-hidden group text-left",
              isRendering && "opacity-40 cursor-not-allowed"
            )}
            disabled={isRendering}
            onClick={() => openSheet('idea')}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a1520] to-[#0a0a0a]" />
            <div className="relative z-10 h-full flex flex-col justify-end p-3">
              <span className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">03</span>
              <h4 className="text-sm font-bold text-white flex items-center gap-1">
                <Lightbulb className="h-3.5 w-3.5" /> 灵感生视频
              </h4>
              <p className="text-[11px] text-white/50 mt-0.5 leading-snug">一句话描述，AI 直接文生视频</p>
            </div>
            <ArrowUpRight className="absolute top-2 right-2 h-3.5 w-3.5 text-white/20 group-hover:text-white/50 transition-colors z-10" />
          </button>
        </div>

        {/* 照片跟我动 */}
        <button
          className={cn(
            "relative w-full h-[100px] rounded-xl overflow-hidden group mb-2 text-left",
            isRendering && "opacity-40 cursor-not-allowed"
          )}
          disabled={isRendering}
          onClick={() => openSheet('photo')}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#151518] to-[#0a0a0a]" />
          <div className="relative z-10 h-full flex items-center px-4 gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
              <Move className="h-5 w-5 text-white/50" />
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase tracking-wider">04 · Photo Motion</span>
              <h4 className="text-sm font-bold text-white">照片跟我动</h4>
              <p className="text-[11px] text-white/50 mt-0.5">上传一张照片，让静态画面自然动起来</p>
            </div>
          </div>
          <ArrowUpRight className="absolute top-3 right-3 h-3.5 w-3.5 text-white/20 group-hover:text-white/50 transition-colors z-10" />
        </button>

        {/* 从今日任务生成（快捷入口） */}
        {brief.shotTasks.length > 0 && (
          <Link href={`${base}/shoot`}>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--ll-hair)] hover:border-white/10 transition-colors cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                <Camera className="h-4 w-4 text-white/50" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-medium text-[var(--ll-text)]">从拍摄任务生成</h4>
                <p className="text-[11px] text-[var(--ll-text-3)]">{brief.shotTasks.length} 个镜头待拍摄</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--ll-text-3)]" />
            </div>
          </Link>
        )}
      </div>

      {/* ─── 生成视频：传统路径 ─── */}
      <div className="mt-5 space-y-3">
        <h3 className="text-xs font-medium text-[var(--ll-text-3)] tracking-wide px-1">传统路径</h3>

        {/* 1. 拍摄上传（手动拍摄） */}
        <StepCard
          href={`${base}/shoot`}
          icon={<Camera className="h-5 w-5" />}
          iconClass="bg-white/5 text-white/60"
          title="拍摄上传"
          desc="按镜头指引拍摄并上传素材，生成视频"
          enabled
        />

        {/* 一键出片（AI 全自动）— Runway 暗色 */}
        {autoRenderAvailable && (
          <Card
            className={cn(
              'p-4 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer',
              'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
            )}
            onClick={() => setShowAutoRenderDialog(true)}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ll-text)]">一键出片 <span className="text-[10px] font-normal text-white/50 bg-white/5 px-1.5 py-0.5 rounded-full">AI 全自动</span></h3>
              <p className="text-xs text-[var(--ll-text-3)] mt-0.5">无需拍摄上传，AI 自动生成全部镜头并合成视频</p>
            </div>
            <ChevronRight className="h-5 w-5 text-white/20 flex-shrink-0" />
          </Card>
        )}
      </div>

      {/* ─── 后续步骤 ─── */}
      <div className="mt-5 space-y-3">
        <h3 className="text-xs font-medium text-[var(--ll-text-3)] tracking-wide px-1">后续步骤</h3>

        {/* 2. 成片导出 */}
        <StepCard
          href={`${base}/variants`}
          icon={<Film className="h-5 w-5" />}
          iconClass="bg-white/5 text-white/60"
          title="成片导出"
          desc={variantsReady ? '查看 3 个版本、合规与文案，选版导出' : '生成视频后可查看成片'}
          enabled={variantsReady}
        />

        {/* 3. 数据复盘 */}
        <StepCard
          href={`${base}/metrics`}
          icon={<BarChart3 className="h-5 w-5" />}
          iconClass="bg-white/5 text-white/60"
          title="数据复盘"
          desc={metricsReady ? '回填播放/转化数据，获取优化建议' : '导出发布后回填数据'}
          enabled={metricsReady}
        />
      </div>

      {/* ─── Inhot Bottom Sheet 创作面板 ─── */}
      {sheetMode != null && (
        <CreationSheet
          mode={sheetMode}
          briefId={briefId}
          storeId={storeId}
          loading={creationLoading}
          error={creationError}
          onClose={() => { setSheetMode(null); setCreationError(null) }}
          onSubmit={async (payload) => {
            setCreationLoading(true)
            setCreationError(null)
            try {
              // 照片跟我动：先上传图片到 OSS，再获取 ossKey
              if (payload.file) {
                const formData = new FormData()
                formData.append('file', payload.file)
                // 复用素材上传 API，以第一个 shotTaskId 作为归属
                const firstShotTaskId = brief?.shotTasks?.[0]?.id
                if (!firstShotTaskId) throw new Error('没有可用的拍摄任务')
                formData.append('shotTaskId', firstShotTaskId)
                const uploadRes = await fetch(`/api/content-briefs/${briefId}/assets`, {
                  method: 'POST',
                  body: formData,
                })
                const uploadData = await uploadRes.json()
                if (!uploadRes.ok) throw new Error(uploadData?.error?.message || '图片上传失败')
                payload.sourceImageKeys = [uploadData.asset.ossKey]
              }

              const body: Record<string, unknown> = { mode: CREATION_MODE_MAP[sheetMode] }
              if (payload.sourceVideoUrl) body.sourceVideoUrl = payload.sourceVideoUrl
              if (payload.prompt) body.prompt = payload.prompt
              if (payload.referenceAssetIds) body.referenceAssetIds = payload.referenceAssetIds
              if (payload.textPrompt) body.textPrompt = payload.textPrompt
              if (payload.sourceImageKeys) body.sourceImageKeys = payload.sourceImageKeys
              if (payload.materialTags) body.materialTags = payload.materialTags

              const res = await fetch(`/api/content-briefs/${briefId}/creation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              const data = await res.json()
              if (!res.ok) throw new Error(data?.error?.message || '创作请求失败')
              setSheetMode(null)
              if (typeof data.estimatedCost === 'number') {
                toast.success(`已冻结 ${data.estimatedCost} 积分，完成后多退少补`)
              } else {
                toast.success('创作任务已提交')
              }
              mutate()
            } catch (err) {
              setCreationError(err instanceof Error ? err.message : '未知错误')
            } finally {
              setCreationLoading(false)
            }
          }}
        />
      )}

      {/* 一键出片确认弹窗 */}
      {showAutoRenderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--ll-surface)] border border-[var(--ll-hair)] rounded-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--ll-text)] flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-white" />
                一键出片
              </h3>
              <button onClick={() => setShowAutoRenderDialog(false)} className="text-[var(--ll-text-3)] hover:text-[var(--ll-text)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-[var(--ll-text-2)]">
              AI 将为您的 {brief.shotTasks.length} 个镜头全部生成视频素材，并自动合成为 3 个版本（促销引流版、氛围种草版、老板口播版）。
            </p>
            <div className="bg-white/5 rounded-xl p-3 space-y-1">
              <p className="text-xs text-[var(--ll-text-2)]">
                <span className="font-medium text-[var(--ll-text)]">预计耗时：</span>5-15 分钟
              </p>
              <p className="text-xs text-[var(--ll-text-2)]">
                <span className="font-medium text-[var(--ll-text)]">积分消耗：</span>按实际渲染时长计费，渲染前会冻结预估积分，完成后多退少补
              </p>
            </div>
            {autoRenderError && (
              <p className="text-xs text-red-400 bg-red-900/20 rounded-lg p-2">{autoRenderError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-[var(--ll-hair)] text-[var(--ll-text)] hover:bg-white/5"
                onClick={() => setShowAutoRenderDialog(false)}
                disabled={autoRenderLoading}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-white text-black hover:bg-white/90"
                onClick={handleAutoRender}
                disabled={autoRenderLoading}
              >
                {autoRenderLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" /> 提交中...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-1" /> 开始生成</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 模板推荐组件 ───

function TemplateRecommendation({ templates }: { templates: ContentTemplate[] }) {
  const [expanded, setExpanded] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)

  const selected = templates[selectedIdx]

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <Clapperboard className="h-4 w-4 text-white/50" />
        <h2 className="text-sm font-bold text-[var(--ll-text)]">推荐分镜模板</h2>
        <span className="text-xs text-[var(--ll-text-3)] ml-auto">{templates.length} 种内容类型</span>
      </div>

      {/* 模板选择标签 — 带右侧渐变遮罩提示可滚动 */}
      <div className="relative">
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 pr-6 scroll-smooth">
          {templates.map((t, idx) => (
            <button
              key={t.id}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                selectedIdx === idx
                  ? 'bg-white text-black'
                  : 'bg-white/5 text-[var(--ll-text-2)] hover:bg-white/10',
              )}
              onClick={() => setSelectedIdx(idx)}
            >
              {t.name}
            </button>
          ))}
        </div>
        {/* 右侧渐变遮罩：提示还有更多标签可滚动查看 */}
        {templates.length > 3 && (
          <div className="absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-[var(--ll-surface)] to-transparent pointer-events-none" />
        )}
      </div>

      {/* 选中模板详情 */}
      {selected && (
        <Card className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-[var(--ll-text)]">{selected.name}</span>
            <Badge variant="outline" className="text-[10px] border-white/15 text-white/50">{selected.targetDuration}</Badge>
          </div>

          {/* 分镜序列 */}
          <div className="space-y-2 mt-3">
            {selected.shots.map((shot) => (
              <div key={shot.order} className="flex gap-2">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/60 flex items-center justify-center text-[10px] font-bold">
                  {shot.order}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-[var(--ll-text-2)]">{SHOT_TYPE_LABELS[shot.type] ?? shot.type}</span>
                    <span className="text-[10px] text-[var(--ll-text-3)]">{shot.duration}</span>
                  </div>
                  <p className="text-xs text-[var(--ll-text-3)] mt-0.5">{shot.description}</p>
                  <p className="text-[10px] text-white/40 mt-0.5">提示：{shot.tips}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 推荐标签 */}
          {selected.suggestedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-white/10">
              {selected.suggestedTags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 bg-white/5 text-white/50 text-[11px] rounded-md font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 展开/收起 */}
      {templates.length > 2 && (
        <button
          className="mt-2 flex items-center gap-1 text-xs text-white/40 hover:text-white/60 mx-auto"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>收起 <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>查看全部 {templates.length} 种模板 <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  )
}

// ─── 步骤入口卡片 ───

interface StepCardProps {
  href: string
  icon: React.ReactNode
  iconClass: string
  title: string
  desc: string
  enabled: boolean
}

function StepCard({ href, icon, iconClass, title, desc, enabled }: StepCardProps) {
  const inner = (
    <Card
      className={cn(
        'p-4 rounded-2xl border transition-all flex items-center gap-3',
        enabled
          ? 'border-white/10 hover:border-white/20 cursor-pointer'
          : 'border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed',
      )}
    >
      <div className={cn('flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center', iconClass)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-[var(--ll-text)]">{title}</h3>
        <p className="text-xs text-[var(--ll-text-3)] mt-0.5">{desc}</p>
      </div>
      {enabled && <ChevronRight className="h-5 w-5 text-[var(--ll-text-3)] flex-shrink-0" />}
    </Card>
  )

  if (!enabled) return inner
  return <Link href={href}>{inner}</Link>
}

// ─── 分镜类型中文映射 ───

const SHOT_TYPE_LABELS: Record<string, string> = {
  hook: '开场钩子',
  process: '制作过程',
  result: '成品展示',
  cta: '引导下单',
  storefront: '门店外观',
  product_closeup: '产品特写',
  cooking_process: '制作过程',
  staff_action: '员工操作',
  customer_reaction: '顾客反应',
  offer_display: '优惠展示',
  talking_head: '口播',
  b_roll: '空镜',
}

// ─── Inhot Bottom Sheet 创作面板 ───

const SHEET_CONFIG: Record<
  string,
  { kind: string; title: string; desc: string; placeholder: string; fieldType: 'input' | 'textarea' | 'upload' | 'chips' | 'replicate' }
> = {
  replicate: {
    kind: 'Replicate',
    title: '复刻爆款',
    desc: '粘贴要复刻的爆款视频链接，用 @ 引用你的素材库参考图（人物 / 产品），再用一句话告诉 AI 如何替换或改写，一步产出复刻视频。',
    placeholder: '粘贴 抖音 / 快手 / 小红书 链接',
    fieldType: 'replicate',
  },
  shortfilm: {
    kind: 'Short Film',
    title: '沉浸式短片',
    desc: '选择要用的门店素材，AI 编排成有情绪、有故事感的短片，自动配乐与转场。',
    placeholder: '',
    fieldType: 'chips',
  },
  idea: {
    kind: 'Idea to Video',
    title: '灵感生视频',
    desc: '用一句话描述你想要的画面，AI 直接为你生成视频，无需素材。',
    placeholder: '例如：夜晚暖光下，一碗热气腾腾的过桥米线特写，蒸汽升起，电影质感…',
    fieldType: 'textarea',
  },
  photo: {
    kind: 'Photo Motion',
    title: '照片跟我动',
    desc: '上传一张门店照片（菜品 / 环境 / 老板），AI 让静态画面自然地动起来。',
    placeholder: '',
    fieldType: 'upload',
  },
}

const MATERIAL_CHIPS = ['招牌菜特写', '后厨火候', '门店环境', '顾客反应', '产品摆盘', '老板出镜']

/** CreationSheet 提交时携带的数据 */
interface CreationSubmitPayload {
  /** 复刻爆款：源视频 URL */
  sourceVideoUrl?: string
  /** 复刻爆款：V-Edit 编辑指令（可含 [Image N] 引用参考图） */
  prompt?: string
  /** 复刻爆款：@ 选中的素材库 RawAsset ID（最多 5 张） */
  referenceAssetIds?: string[]
  /** 灵感生视频：文字描述 */
  textPrompt?: string
  /** 照片跟我动：上传后的 OSS keys（父组件填充） */
  sourceImageKeys?: string[]
  /** 照片跟我动：原始文件（父组件负责上传） */
  file?: File
  /** 沉浸式短片：选中的素材标签 */
  materialTags?: string[]
}

interface CreationSheetProps {
  mode: string
  briefId: string
  storeId: string
  loading: boolean
  error: string | null
  onClose: () => void
  onSubmit: (payload: CreationSubmitPayload) => Promise<void>
}

function CreationSheet({ mode, briefId, storeId, loading, error, onClose, onSubmit }: CreationSheetProps) {
  const config = SHEET_CONFIG[mode]
  if (!config) return null

  // 表单状态（全部内聚在 Sheet 内部）
  const [input, setInput] = useState('')
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set(['招牌菜特写', '后厨火候']))
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)

  // ─── 复刻爆款专用状态 ───
  const [replicateUrl, setReplicateUrl] = useState('')
  const [replicatePrompt, setReplicatePrompt] = useState('')
  /** 已选参考素材（最多 5 张，顺序即 [Image N] 编号顺序） */
  const [refAssets, setRefAssets] = useState<LibraryAsset[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  function addRefAsset(asset: LibraryAsset) {
    setRefAssets((prev) => {
      if (prev.some((a) => a.id === asset.id)) return prev
      if (prev.length >= 5) return prev
      const next = [...prev, asset]
      // 在 prompt 末尾追加 [Image N] 占位，编号 = 新素材序号
      setReplicatePrompt((p) => {
        const tag = `[Image ${next.length}]`
        return p.trim().length > 0 ? `${p} ${tag}` : tag
      })
      return next
    })
  }

  function removeRefAsset(id: string) {
    setRefAssets((prev) => prev.filter((a) => a.id !== id))
  }

  function toggleChip(chip: string) {
    setSelectedChips(prev => {
      const next = new Set(prev)
      if (next.has(chip)) next.delete(chip)
      else next.add(chip)
      return next
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    // 生成预览
    if (file) {
      const url = URL.createObjectURL(file)
      setFilePreview(url)
    } else {
      if (filePreview) URL.revokeObjectURL(filePreview)
      setFilePreview(null)
    }
  }

  const canSubmit = (() => {
    if (loading) return false
    if (config.fieldType === 'replicate') return replicateUrl.trim().length > 0 && replicatePrompt.trim().length > 0
    if (config.fieldType === 'input') return input.trim().length > 0
    if (config.fieldType === 'textarea') return input.trim().length >= 5
    if (config.fieldType === 'chips') return selectedChips.size > 0
    if (config.fieldType === 'upload') return selectedFile != null
    return false
  })()

  async function handleSubmit() {
    if (!canSubmit) return
    const payload: CreationSubmitPayload = {}
    if (config.fieldType === 'replicate') {
      payload.sourceVideoUrl = replicateUrl.trim()
      payload.prompt = replicatePrompt.trim()
      payload.referenceAssetIds = refAssets.map((a) => a.id)
    }
    if (config.fieldType === 'input') payload.sourceVideoUrl = input.trim()
    if (config.fieldType === 'textarea') payload.textPrompt = input.trim()
    if (config.fieldType === 'chips') payload.materialTags = Array.from(selectedChips)
    if (config.fieldType === 'upload' && selectedFile) payload.file = selectedFile
    await onSubmit(payload)
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Sheet 本体 */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-[#0d0d0d] border-t border-[var(--ll-hair)] rounded-t-2xl px-5 pt-3 pb-8 max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽条 */}
        <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4" />

        {/* 模式标签 */}
        <div className="text-[10px] font-medium text-white/40 uppercase tracking-widest">{config.kind}</div>
        <h3 className="text-lg font-bold text-white mt-0.5">{config.title}</h3>
        <p className="text-sm text-white/50 mt-1 leading-relaxed">{config.desc}</p>

        {/* 表单字段 */}
        <div className="mt-4">
          {config.fieldType === 'replicate' && (
            <div className="space-y-3">
              {/* 源视频链接 */}
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">爆款视频链接</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors"
                  placeholder={config.placeholder}
                  value={replicateUrl}
                  onChange={(e) => setReplicateUrl(e.target.value)}
                />
              </div>

              {/* 参考素材（@ 素材库） */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-white/40">参考素材（可选，最多 5 张）</label>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-2.5 py-1 transition-colors disabled:opacity-40"
                    onClick={() => setPickerOpen(true)}
                    disabled={refAssets.length >= 5}
                  >
                    <ImageIcon className="h-3 w-3" /> @素材
                  </button>
                </div>
                {refAssets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {refAssets.map((a, idx) => (
                      <div key={a.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 group/ref">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.thumbUrl} alt={a.filename} className="w-full h-full object-cover" />
                        <span className="absolute top-0.5 left-0.5 text-[9px] font-bold text-white bg-black/60 rounded px-1">
                          {idx + 1}
                        </span>
                        <button
                          type="button"
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white/80 hover:text-white"
                          onClick={() => removeRefAsset(a.id)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-white/25">点击「@素材」从素材库选择人物 / 产品图作为参考</p>
                )}
              </div>

              {/* 编辑指令 */}
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">编辑指令</label>
                <textarea
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors min-h-[90px] resize-none"
                  placeholder="告诉 AI 如何改：例如「把出镜人物替换为 [Image 1]，产品换成 [Image 2] 的招牌菜」"
                  value={replicatePrompt}
                  onChange={(e) => setReplicatePrompt(e.target.value)}
                />
              </div>

              {/* 素材选择器弹层 */}
              {pickerOpen && (
                <AssetPicker
                  storeId={storeId}
                  selectedIds={refAssets.map((a) => a.id)}
                  onPick={addRefAsset}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          )}

          {config.fieldType === 'input' && (
            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors"
              placeholder={config.placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          )}

          {config.fieldType === 'textarea' && (
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors min-h-[100px] resize-none"
              placeholder={config.placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          )}

          {config.fieldType === 'chips' && (
            <div>
              <label className="text-xs text-white/40 mb-2 block">选择素材</label>
              <div className="flex flex-wrap gap-2">
                {MATERIAL_CHIPS.map(chip => (
                  <button
                    key={chip}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                      selectedChips.has(chip)
                        ? 'bg-white text-black'
                        : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/20'
                    )}
                    onClick={() => toggleChip(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.fieldType === 'upload' && (
            <label className="block border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center gap-2 hover:border-white/20 transition-colors cursor-pointer relative">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleFileChange}
              />
              {filePreview ? (
                <>
                  <img src={filePreview} alt="预览" className="w-20 h-20 object-cover rounded-lg" />
                  <span className="text-sm text-white/70">{selectedFile?.name}</span>
                  <span className="text-[11px] text-white/40">点击重新选择</span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-white/30" />
                  <span className="text-sm text-white/50">上传门店照片</span>
                  <span className="text-[11px] text-white/25">JPG / PNG · 建议竖版 9:16</span>
                </>
              )}
            </label>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="mt-3 text-xs text-red-400 bg-red-900/20 rounded-lg p-2">{error}</p>
        )}

        {/* 提交按钮 */}
        <button
          className={cn(
            'w-full mt-5 py-3 rounded-xl text-sm font-bold transition-all',
            canSubmit
              ? 'bg-white text-black hover:bg-white/90 active:scale-[0.985]'
              : 'bg-white/5 text-white/20 cursor-not-allowed'
          )}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" /> 提交中...
            </span>
          ) : (
            `开始生成 · ${config.title}`
          )}
        </button>

        {/* 积分提示 */}
        <p className="text-[11px] text-white/25 text-center mt-2">
          生成前会冻结预估积分，完成后多退少补
        </p>
      </div>
    </div>
  )
}

// ─── 素材库参考图选择器 ───

interface LibraryAsset {
  id: string
  type: string
  category: string | null
  filename: string
  thumbUrl: string
  url: string
}

const PICKER_CATEGORIES: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'CHARACTER', label: '人物' },
  { key: 'PRODUCT', label: '产品' },
  { key: 'OTHER', label: '其他' },
]

/** @素材 弹层：从 store 素材库选择图片作为 V-Edit 参考图 */
function AssetPicker({
  storeId,
  selectedIds,
  onPick,
  onClose,
}: {
  storeId: string
  selectedIds: string[]
  onPick: (asset: LibraryAsset) => void
  onClose: () => void
}) {
  const [category, setCategory] = useState('')
  const query = `/api/merchant/stores/${storeId}/assets?type=IMAGE${category ? `&category=${category}` : ''}`
  const { data, isLoading } = useSWR<{ assets: LibraryAsset[] }>(query, fetcher)
  const assets = data?.assets ?? []

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg bg-[#111] border-t border-[var(--ll-hair)] rounded-t-2xl px-5 pt-3 pb-6 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-3" />
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-white">选择参考素材</h4>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 分类标签 */}
        <div className="flex gap-1.5 mb-3">
          {PICKER_CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all',
                category === c.key ? 'bg-white text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'
              )}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-10 text-white/30 text-xs">
            素材库暂无图片，请先在门店「素材库」中上传
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((a) => {
              const picked = selectedIds.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={picked}
                  className={cn(
                    'relative aspect-square rounded-lg overflow-hidden border transition-all',
                    picked ? 'border-[var(--ll-green)] opacity-50' : 'border-white/10 hover:border-white/30'
                  )}
                  onClick={() => onPick(a)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.thumbUrl} alt={a.filename} className="w-full h-full object-cover" />
                  {picked && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-bold text-[var(--ll-green)]">
                      已选
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 横向旅程地图组件 ───

const JOURNEY_STEPS = [
  { key: 'shoot', label: '拍摄', statuses: new Set(['READY_TO_SHOOT', 'MATERIALS_UPLOADED']), page: 'shoot' },
  { key: 'generate', label: '生成', statuses: new Set(['RENDERING', 'GENERATED', 'COMPLIANCE_REVIEW']), page: null },
  { key: 'export', label: '导出', statuses: new Set(['READY_TO_EXPORT', 'EXPORTED']), page: 'variants' },
  { key: 'publish', label: '发布', statuses: new Set(['PUBLISHED']), page: 'metrics' },
] as const

function JourneyMap({ briefStatus, basePath }: { briefStatus: string; basePath: string }) {
  // 确定当前处于第几步
  let activeIdx = 0
  for (let i = 0; i < JOURNEY_STEPS.length; i++) {
    if (JOURNEY_STEPS[i].statuses.has(briefStatus)) {
      activeIdx = i
      break
    }
    if (i < JOURNEY_STEPS.length - 1) {
      const laterStatuses = JOURNEY_STEPS.slice(i + 1).flatMap(s => [...s.statuses])
      if (laterStatuses.includes(briefStatus)) {
        activeIdx = i + 1
      }
    }
  }

  return (
    <div className="flex items-center">
      {JOURNEY_STEPS.map((step, idx) => {
        const isCompleted = idx < activeIdx
        const isCurrent = idx === activeIdx
        // 已完成且有对应页面的步骤可点击回退
        const canNavigate = isCompleted && step.page != null
        const nodeHref = canNavigate ? `${basePath}/${step.page}` : undefined

        const node = (
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all',
            isCompleted ? 'bg-[var(--ll-green)] text-black cursor-pointer hover:ring-2 hover:ring-[var(--ll-green)]/40' :
            isCurrent ? 'bg-[var(--ll-green)]/20 text-[var(--ll-green)] ring-2 ring-[var(--ll-green)]/30' :
            'bg-[var(--ll-hair)] text-[var(--ll-text-3)]'
          )}>
            {isCompleted ? '✓' : idx + 1}
          </div>
        )

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-initial">
            {/* 节点 */}
            <div className="flex flex-col items-center gap-1">
              {nodeHref ? (
                <Link href={nodeHref} title={`回到${step.label}`}>{node}</Link>
              ) : node}
              <span className={cn(
                'text-[10px] whitespace-nowrap',
                isCurrent ? 'text-[var(--ll-green)] font-medium' :
                isCompleted ? 'text-[var(--ll-green)]/70' : 'text-[var(--ll-text-3)]'
              )}>
                {step.label}
              </span>
            </div>
            {/* 连接线 */}
            {idx < JOURNEY_STEPS.length - 1 && (
              <div className={cn(
                'flex-1 h-[2px] mx-1',
                idx < activeIdx ? 'bg-[var(--ll-green)]' : 'bg-[var(--ll-hair)]'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}
