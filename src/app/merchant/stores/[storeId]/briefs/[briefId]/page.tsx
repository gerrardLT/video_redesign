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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { BriefProvenanceCard } from '@/components/merchant'

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
      {/* 任务信息头部 */}
      <div className="py-4 border-b border-amber-100">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-base">{GOAL_ICONS[brief.goal ?? ''] || '📋'}</span>
          <span className="font-medium text-gray-700">
            {GOAL_LABELS[brief.goal ?? ''] || '内容任务'}
          </span>
          <Badge variant={getStatusVariant(brief.status)} className="ml-auto text-[10px]">
            {STATUS_LABELS[brief.status] || brief.status}
          </Badge>
        </div>
        <h1 className="mt-2 text-lg font-bold text-gray-800 leading-snug">{brief.title}</h1>
        {brief.scheduledDate && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(brief.scheduledDate)}
          </p>
        )}
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
          <Progress value={shootProgress} className="h-2.5 bg-amber-100" />
        </div>
      )}

      {/* 内容溯源展示 + 画像调整入口（需求 5.1/5.3/5.5/5.6） */}
      <div className="mt-4">
        <BriefProvenanceCard storeId={storeId} briefId={briefId} />
      </div>

      {/* 三步入口卡片 */}
      <div className="mt-6 space-y-3">
        {/* 1. 拍摄上传 */}
        <StepCard
          href={`${base}/shoot`}
          icon={<Camera className="h-5 w-5" />}
          iconClass="bg-amber-100 text-amber-600"
          title="拍摄上传"
          desc="按镜头指引拍摄并上传素材，生成视频"
          enabled
        />

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
