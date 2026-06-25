'use client'

/**
 * 数据建议页
 *
 * 展示内容：
 * 1. 数据录入表单（MetricsInputForm）— 手动录入各平台表现数据
 * 2. 优化建议列表（PerformanceInsightCard）— 基于历史数据的智能建议
 * 3. 已录入数据历史表格 — 查看过往录入记录
 *
 * API:
 * - POST /api/content-briefs/{briefId}/metrics — 提交数据
 * - GET /api/content-briefs/{briefId}/metrics — 获取历史数据
 * - GET /api/content-briefs/{briefId}/insights — 获取优化建议
 *
 * Requirements: 11.1, 12.1, 15.2
 */

import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricsInputForm } from '@/components/merchant/MetricsInputForm'
import { PerformanceInsightCard } from '@/components/merchant/PerformanceInsightCard'
import { TrendingUp, History, Lightbulb } from 'lucide-react'
import type { PublishPlatform, Suggestion } from '@/types/merchant'

// ========================
// 类型定义
// ========================

/** 已录入数据记录 */
interface MetricRecord {
  id: string
  platform: PublishPlatform
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  linkClicks: number
  messages: number
  orders: number
  redemptions: number
  revenueCents: number
  capturedAt: string
}

/** 优化建议响应 */
interface InsightsResponse {
  suggestions: Suggestion[]
  recommendedNextGoals: string[]
  playbooksToReuse: string[]
  playbooksToAvoid: string[]
}

/** 平台显示名映射 */
const PLATFORM_LABELS: Record<PublishPlatform, string> = {
  DOUYIN: '抖音',
  KUAISHOU: '快手',
  XIAOHONGSHU: '小红书',
  WECHAT_CHANNELS: '视频号',
  MANUAL_EXPORT: '手动导出',
}

/** SWR fetcher */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('请求失败')
  return res.json()
}

// ========================
// 页面组件
// ========================

export default function MetricsPage() {
  const params = useParams()
  const briefId = params.briefId as string

  // 使用 SWR 获取历史数据
  const {
    data: metricsData,
    isLoading: metricsLoading,
    mutate: mutateMetrics,
  } = useSWR<MetricRecord[]>(
    briefId ? `/api/content-briefs/${briefId}/metrics` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 使用 SWR 获取优化建议
  const {
    data: insights,
    isLoading: insightsLoading,
    mutate: mutateInsights,
  } = useSWR<InsightsResponse>(
    briefId ? `/api/content-briefs/${briefId}/insights` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const metrics = metricsData ?? []

  /** 录入成功后刷新数据 */
  function handleSubmitSuccess() {
    void mutateMetrics()
    void mutateInsights()
  }

  return (
    <div className="space-y-6 pb-8">
      {/* 页面标题 */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-6 w-6 text-amber-600" />
        <h1 className="text-xl font-bold text-amber-900">数据与建议</h1>
      </div>

      {/* 数据录入表单 */}
      <MetricsInputForm briefId={briefId} onSuccess={handleSubmitSuccess} />

      {/* 优化建议列表 */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-900">优化建议</h2>
        </div>

        {insightsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : insights && insights.suggestions.length > 0 ? (
          <div className="space-y-3">
            {insights.suggestions.map((suggestion, index) => (
              <PerformanceInsightCard key={index} suggestion={suggestion} />
            ))}
          </div>
        ) : (
          <Card className="border-amber-100 bg-amber-50/50">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-amber-700">
                {metrics.length < 3
                  ? '录入至少 3 条数据后，系统将自动分析并给出优化建议'
                  : '暂无优化建议'}
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 已录入数据历史 */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-900">历史数据</h2>
        </div>

        {metricsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : metrics.length > 0 ? (
          <div className="space-y-2">
            {metrics.map((record) => (
              <MetricHistoryRow key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <Card className="border-amber-100 bg-amber-50/50">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-amber-700">
                还没有录入过数据，在上方表单中录入第一条吧
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

// ========================
// 子组件：历史记录行
// ========================

function MetricHistoryRow({ record }: { record: MetricRecord }) {
  const date = new Date(record.capturedAt)
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

  return (
    <Card className="border-amber-100 bg-white">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
            {PLATFORM_LABELS[record.platform] || record.platform}
          </Badge>
          <span className="text-xs text-gray-400">{dateStr}</span>
        </div>

        {/* 关键指标概览 — 横向展示 */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <MetricCell label="播放" value={record.views} />
          <MetricCell label="点赞" value={record.likes} />
          <MetricCell label="评论" value={record.comments} />
          <MetricCell label="下单" value={record.orders} />
        </div>

        {/* 次要指标 */}
        {(record.revenueCents > 0 || record.linkClicks > 0) && (
          <div className="mt-2 flex gap-3 text-xs text-gray-500">
            {record.linkClicks > 0 && <span>链接点击 {formatNumber(record.linkClicks)}</span>}
            {record.revenueCents > 0 && <span>营收 ¥{(record.revenueCents / 100).toFixed(0)}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ========================
// 工具组件
// ========================

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900">{formatNumber(value)}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}

/** 数字格式化：超过 1 万显示 x.x万 */
function formatNumber(num: number): string {
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}万`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`
  }
  return num.toString()
}
