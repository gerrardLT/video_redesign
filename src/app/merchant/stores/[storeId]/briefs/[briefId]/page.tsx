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

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
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
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { BriefProvenanceCard } from '@/components/merchant'

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

  // 一键出片是否可用：DRAFT 或 READY_TO_SHOOT 状态 + 有 ShotTasks
  const autoRenderAvailable =
    brief != null &&
    (brief.status === 'DRAFT' || brief.status === 'READY_TO_SHOOT') &&
    brief.shotTasks.length > 0

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
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-gray-500 text-sm">加载中...</p>
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
        <h1 className="mt-2 text-xl font-semibold font-[var(--font-serif)] text-[var(--ll-text)] leading-snug">{brief.title}</h1>
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
            <span className="text-sm text-gray-600">拍摄进度</span>
            <span className="text-sm font-medium text-amber-600">
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

      {/* ─── 生成视频：两种路径二选一 ─── */}
      <div className="mt-6 space-y-3">
        <h3 className="text-xs font-medium text-[var(--ll-text-3)] tracking-wide px-1">生成视频</h3>

        {/* 1. 拍摄上传（手动拍摄） */}
        <StepCard
          href={`${base}/shoot`}
          icon={<Camera className="h-5 w-5" />}
          iconClass="bg-amber-100 text-amber-600"
          title="拍摄上传"
          desc="按镜头指引拍摄并上传素材，生成视频"
          enabled
        />

        {/* 一键出片（AI 全自动）— 融入绿色体系 */}
        {autoRenderAvailable && (
          <Card
            className={cn(
              'p-4 rounded-2xl border-2 transition-all flex items-center gap-3 cursor-pointer',
              'border-[var(--ll-green)]/20 bg-[var(--ll-green)]/[0.03] hover:border-[var(--ll-green)]/40',
            )}
            onClick={() => setShowAutoRenderDialog(true)}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--ll-green)]/10 text-[var(--ll-green)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-800">一键出片 <span className="text-[10px] font-normal text-[var(--ll-green)] bg-[var(--ll-green)]/[0.08] px-1.5 py-0.5 rounded-full">AI 全自动</span></h3>
              <p className="text-xs text-gray-500 mt-0.5">无需拍摄上传，AI 自动生成全部镜头并合成视频</p>
            </div>
            <ChevronRight className="h-5 w-5 text-[var(--ll-green)]/40 flex-shrink-0" />
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
          iconClass="bg-blue-100 text-blue-600"
          title="成片导出"
          desc={variantsReady ? '查看 3 个版本、合规与文案，选版导出' : '生成视频后可查看成片'}
          enabled={variantsReady}
        />

        {/* 3. 数据复盘 */}
        <StepCard
          href={`${base}/metrics`}
          icon={<BarChart3 className="h-5 w-5" />}
          iconClass="bg-green-100 text-green-600"
          title="数据复盘"
          desc={metricsReady ? '回填播放/转化数据，获取优化建议' : '导出发布后回填数据'}
          enabled={metricsReady}
        />
      </div>

      {/* 一键出片确认弹窗 */}
      {showAutoRenderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--ll-green)]" />
                一键出片
              </h3>
              <button onClick={() => setShowAutoRenderDialog(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              AI 将为您的 {brief.shotTasks.length} 个镜头全部生成视频素材，并自动合成为 3 个版本（促销引流版、氛围种草版、老板口播版）。
            </p>
            <div className="bg-[var(--ll-green)]/[0.05] rounded-xl p-3 space-y-1">
              <p className="text-xs text-gray-700">
                <span className="font-medium">预计耗时：</span>5-15 分钟
              </p>
              <p className="text-xs text-gray-700">
                <span className="font-medium">积分消耗：</span>按实际渲染时长计费，渲染前会冻结预估积分，完成后多退少补
              </p>
            </div>
            {autoRenderError && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2">{autoRenderError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowAutoRenderDialog(false)}
                disabled={autoRenderLoading}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-[var(--ll-green)] hover:opacity-90 text-white"
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
        <Clapperboard className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-bold text-gray-800">推荐分镜模板</h2>
        <span className="text-xs text-gray-400 ml-auto">{templates.length} 种内容类型</span>
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
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
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
        <Card className="p-4 rounded-xl border border-amber-100 bg-amber-50/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-gray-800">{selected.name}</span>
            <Badge variant="outline" className="text-[10px]">{selected.targetDuration}</Badge>
          </div>

          {/* 分镜序列 */}
          <div className="space-y-2 mt-3">
            {selected.shots.map((shot) => (
              <div key={shot.order} className="flex gap-2">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-bold">
                  {shot.order}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-700">{SHOT_TYPE_LABELS[shot.type] ?? shot.type}</span>
                    <span className="text-[10px] text-gray-400">{shot.duration}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{shot.description}</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">提示：{shot.tips}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 推荐标签 */}
          {selected.suggestedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-amber-100">
              {selected.suggestedTags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 bg-amber-100/60 text-amber-700 text-[11px] rounded-md font-medium">
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
          className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 mx-auto"
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
        'p-4 rounded-2xl border-2 transition-all flex items-center gap-3',
        enabled
          ? 'border-gray-100 hover:border-amber-200 cursor-pointer'
          : 'border-gray-100 bg-gray-50/60 opacity-60 cursor-not-allowed',
      )}
    >
      <div className={cn('flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center', iconClass)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      {enabled && <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />}
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
            isCompleted ? 'bg-[var(--ll-green)] text-white cursor-pointer hover:ring-2 hover:ring-[var(--ll-green)]/40' :
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
