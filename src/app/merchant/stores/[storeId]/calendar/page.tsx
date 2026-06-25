'use client'

/**
 * 日历视图 — /merchant/stores/[storeId]/calendar
 *
 * 7 天内容计划完整视图，每天一个卡片，显示：
 * - 日期
 * - 内容目标中文名
 * - ContentBrief 标题
 * - 状态徽章
 * - 底部 "生成新计划" 按钮（触发 POST content-plan/generate）
 *
 * 数据获取：
 * - useSWR('/api/stores/{storeId}/content-plan/current')
 *
 * Requirements: 4.1, 15.1
 */

import { useParams } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

// ========================
// 数据获取
// ========================

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || '请求失败')
  }
  return res.json()
}

// ========================
// 常量映射
// ========================

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

/** 状态 → 中文标签 */
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

/** 状态 → Badge 样式 */
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

// ========================
// 类型
// ========================

interface ShotTask {
  id: string
  order: number
  type: string
  title: string
  required: boolean
  status: string
}

interface Brief {
  id: string
  title: string
  goal: string
  status: string
  scheduledDate: string
  shotTasks: ShotTask[]
}

interface ContentPlan {
  id: string
  title: string
  startDate: string
  endDate: string
  status: string
  briefs: Brief[]
}

// ========================
// 组件
// ========================

/** 单日卡片 */
function DayCard({ brief, isToday }: { brief: Brief; isToday: boolean }) {
  const date = new Date(brief.scheduledDate)
  const dayOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]

  return (
    <Card className={`transition-all ${isToday ? 'border-orange-300 bg-orange-50/50 ring-1 ring-orange-200' : 'border-gray-100'}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {/* 日期 */}
            <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg ${isToday ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
              <span className="text-xs leading-none">{dayOfWeek}</span>
              <span className="text-lg font-bold leading-tight">{date.getDate()}</span>
            </div>

            {/* 内容信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base">{GOAL_ICONS[brief.goal] || '📋'}</span>
                <span className="text-sm font-medium text-gray-700">
                  {GOAL_LABELS[brief.goal] || brief.goal}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{brief.title}</p>
              {isToday && (
                <p className="text-xs text-orange-600 mt-1 font-medium">← 今天</p>
              )}
            </div>
          </div>

          {/* 状态徽章 */}
          <Badge variant={getStatusVariant(brief.status)} className="shrink-0 text-[10px]">
            {STATUS_LABELS[brief.status] || brief.status}
          </Badge>
        </div>

        {/* 拍摄进度条 */}
        {(brief.status === 'READY_TO_SHOOT' || brief.status === 'MATERIALS_UPLOADED') && (
          <div className="mt-3 ml-15">
            <ShotProgress shotTasks={brief.shotTasks} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 拍摄进度指示器 */
function ShotProgress({ shotTasks }: { shotTasks: ShotTask[] }) {
  const required = shotTasks.filter(s => s.required)
  const captured = required.filter(s => s.status === 'CAPTURED')

  if (required.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {required.map((task) => (
          <div
            key={task.id}
            className={`w-4 h-1.5 rounded-full ${task.status === 'CAPTURED' ? 'bg-green-400' : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <span className="text-[10px] text-gray-400">
        {captured.length}/{required.length}
      </span>
    </div>
  )
}

/** 空状态 — 无内容计划 */
function EmptyState({ storeId, onGenerate, generating }: { storeId: string; onGenerate: () => void; generating: boolean }) {
  return (
    <div className="text-center py-12 space-y-4">
      <div className="text-5xl">📅</div>
      <h2 className="text-lg font-medium text-gray-800">还没有内容计划</h2>
      <p className="text-sm text-gray-500 max-w-xs mx-auto">
        一键生成 7 天拍摄计划，每天告诉你拍什么、怎么拍
      </p>
      <Button
        onClick={onGenerate}
        disabled={generating}
        className="bg-orange-600 hover:bg-orange-700 text-white"
      >
        {generating ? (
          <>
            <Spinner size="sm" className="mr-2" />
            生成中...
          </>
        ) : (
          '生成本周计划'
        )}
      </Button>
    </div>
  )
}

// ========================
// 主页面
// ========================

export default function CalendarPage() {
  const params = useParams()
  const storeId = params.storeId as string
  const [generating, setGenerating] = useState(false)

  // 获取当前内容计划
  const { data, isLoading, mutate } = useSWR(
    storeId ? `/api/stores/${storeId}/content-plan/current` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  /** 触发生成新计划 */
  async function handleGenerate() {
    if (generating) return
    setGenerating(true)

    try {
      const res = await fetch(`/api/stores/${storeId}/content-plan/generate`, {
        method: 'POST',
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: '生成失败' } }))
        throw new Error(err.error?.message || '生成失败')
      }

      toast.success('已开始生成计划，稍等片刻')

      // 5 秒后刷新数据
      setTimeout(() => {
        mutate()
      }, 5000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    )
  }

  const contentPlan: ContentPlan | null = data?.contentPlan || null
  const briefs: Brief[] = contentPlan?.briefs || []

  // 无内容计划（404 或空数据）
  if (!contentPlan || briefs.length === 0) {
    return (
      <div className="max-w-lg mx-auto">
        <EmptyState storeId={storeId} onGenerate={handleGenerate} generating={generating} />
      </div>
    )
  }

  const today = new Date()

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* 标题区域 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">内容计划</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDate(contentPlan.startDate)} - {formatDate(contentPlan.endDate)}
          </p>
        </div>
        <Badge variant="outline" className="text-xs border-green-200 text-green-700">
          进行中
        </Badge>
      </div>

      {/* 7 天卡片列表 */}
      <div className="space-y-3">
        {briefs.map((brief) => (
          <DayCard
            key={brief.id}
            brief={brief}
            isToday={isSameDay(new Date(brief.scheduledDate), today)}
          />
        ))}
      </div>

      {/* 底部按钮 */}
      <div className="pt-4 pb-8">
        <Button
          onClick={handleGenerate}
          disabled={generating}
          variant="outline"
          className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
        >
          {generating ? (
            <>
              <Spinner size="sm" className="mr-2" />
              生成中...
            </>
          ) : (
            '生成新计划'
          )}
        </Button>
        <p className="text-[10px] text-gray-400 text-center mt-2">
          将生成下一周的 7 天内容计划
        </p>
      </div>
    </div>
  )
}

// ========================
// 工具函数
// ========================

/** 判断两个日期是否为同一天 */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

/** 格式化日期为 "X月X日" */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
