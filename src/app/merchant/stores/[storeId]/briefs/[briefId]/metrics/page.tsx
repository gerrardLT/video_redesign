'use client'

/**
 * 数据复盘页
 *
 * 把「AI 已算出但前端只读 / 未渲染」的复盘产物，接上「可解释 / 可干预 / 可反哺」三件套：
 * 1. 数据录入表单（MetricsInputForm）— 手动录入各平台表现数据（brief 维度）
 * 2. 复盘建议（门店维度）— 渲染 suggestions（含 evidence 通俗话术）；不足 3 条带数据的内容时
 *    显式提示「再录入 N 条即可解锁优化建议」，不伪造（需求 1.1, 1.2, 1.6）
 * 3. 「下周怎么做」应用面板（InsightsActionPanel）— 一键把推荐目标 / 复用 / 规避写入下一轮计划（需求 1.3, 1.7）
 * 4. 指标趋势图（MetricTrendChart）— 门店历史在选定指标上的变化（需求 1.4）
 * 5. 跨周对比（PeriodComparisonCard）— 本周 vs 上周关键指标增减（需求 1.5）
 * 6. 已录入数据历史表格 — 查看过往录入记录
 *
 * 复盘建议 / 趋势 / 跨周对比均为「门店维度」聚合，故调用 store-scoped API：
 * - GET  /api/stores/{storeId}/insights                   解锁门控 + 洞察
 * - POST /api/stores/{storeId}/insights/apply             应用建议（在子组件内）
 * - GET  /api/stores/{storeId}/metrics/trend?metric=xxx   指标趋势（在子组件内）
 * - GET  /api/stores/{storeId}/metrics/period-comparison  跨周对比（在子组件内）
 *
 * 数据录入 / 历史仍为「内容维度」：
 * - POST /api/content-briefs/{briefId}/metrics  提交数据
 * - GET  /api/content-briefs/{briefId}/metrics  获取历史数据
 *
 * 以上读取均不消耗积分。
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricsInputForm } from '@/components/merchant/MetricsInputForm'
import { PerformanceInsightCard } from '@/components/merchant/PerformanceInsightCard'
import { InsightsActionPanel } from '@/components/merchant/InsightsActionPanel'
import { MetricTrendChart } from '@/components/merchant/MetricTrendChart'
import { PeriodComparisonCard } from '@/components/merchant/PeriodComparisonCard'
import { TrendingUp, History, Lightbulb, LineChart, CalendarRange, Lock, Target, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import type { PublishPlatform, PerformanceInsights } from '@/types/merchant'

// ─── 内容评分类型 ───

interface DimensionScore {
  score: number
  level: 'excellent' | 'good' | 'average' | 'poor'
  description: string
  benchmark: string
}

interface ScoreSuggestion {
  dimension: string
  priority: 'high' | 'medium' | 'low'
  text: string
  expectedImpact: string
}

interface ContentScoreResult {
  overallScore: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  dimensions: {
    completionRate: DimensionScore
    engagementRate: DimensionScore
    infoDensity: DimensionScore
    platformFit: DimensionScore
    conversionRate: DimensionScore
  }
  suggestions: ScoreSuggestion[]
}

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

/**
 * 复盘洞察解锁门控响应（store-scoped）：
 * - unlocked=false 时仅含 remaining（还需录入几条带数据的内容才解锁）
 * - unlocked=true 时含完整 insights
 */
type InsightsGateResponse =
  | { unlocked: false; remaining: number }
  | { unlocked: true; insights: PerformanceInsights }

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
  const storeId = params.storeId as string

  // brief 维度：历史录入数据
  const {
    data: metricsData,
    isLoading: metricsLoading,
    mutate: mutateMetrics,
  } = useSWR<MetricRecord[]>(
    briefId ? `/api/content-briefs/${briefId}/metrics` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 门店维度：复盘洞察（含解锁门控）
  const {
    data: gate,
    isLoading: insightsLoading,
    mutate: mutateInsights,
  } = useSWR<InsightsGateResponse>(
    storeId ? `/api/stores/${storeId}/insights` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const metrics = metricsData ?? []

  /** 录入成功后刷新数据（历史 + 洞察均可能变化） */
  function handleSubmitSuccess() {
    void mutateMetrics()
    void mutateInsights()
  }

  return (
    <div className="space-y-6 pb-8">
      {/* 编辑式洞察标题 — serif 大标题 + kicker */}
      <section className="zen-reveal border-b border-[var(--ll-hair)] pb-4">
        <p className="text-[11px] tracking-[.08em] text-[var(--ll-text-3)] font-medium uppercase">DATA INSIGHTS</p>
        <h1 className="mt-1 text-[22px] font-semibold font-[var(--font-serif)] text-[var(--ll-text)] leading-snug">
          数据复盘
        </h1>
        <p className="mt-1 text-sm text-[var(--ll-text-2)]">录入数据、获取洞察、反哺下一轮计划</p>
      </section>

      {/* 数据录入表单（内容维度） */}
      <MetricsInputForm briefId={briefId} onSuccess={handleSubmitSuccess} />

      {/* 本地生活指标评分 */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-900">本地生活指标</h2>
        </div>
        <ContentScoreCard metrics={metrics} />
      </section>

      {/* 优化建议（门店维度，含解锁门控） */}
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
        ) : gate && gate.unlocked ? (
          <InsightsUnlocked storeId={storeId} insights={gate.insights} />
        ) : gate && !gate.unlocked ? (
          // 不足 3 条带数据的内容：显式提示解锁门槛，不伪造建议
          <Card className="border-amber-100 bg-amber-50/50">
            <CardContent className="py-8 text-center">
              <Lock className="h-7 w-7 text-amber-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-amber-800">
                再录入 {gate.remaining} 条即可解锁优化建议
              </p>
              <p className="mt-1 text-xs text-amber-600">
                录满 3 条带数据的内容后，系统会自动分析并给出可应用的下周建议
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-100 bg-amber-50/50">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-amber-700">复盘数据加载失败，请稍后重试</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 指标趋势（门店维度） */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <LineChart className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-900">指标趋势</h2>
        </div>
        <MetricTrendChart storeId={storeId} />
      </section>

      {/* 跨周对比（门店维度） */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-900">跨周对比</h2>
        </div>
        <PeriodComparisonCard storeId={storeId} />
      </section>

      {/* 已录入数据历史（内容维度） */}
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
// 子组件：已解锁的洞察（建议列表 + 应用面板）
// ========================

function InsightsUnlocked({
  storeId,
  insights,
}: {
  storeId: string
  insights: PerformanceInsights
}) {
  const hasSuggestions = insights.suggestions.length > 0

  return (
    <div className="space-y-3">
      {/* 建议列表（含 evidence 可解释） */}
      {hasSuggestions ? (
        insights.suggestions.map((suggestion, index) => (
          <PerformanceInsightCard key={index} suggestion={suggestion} />
        ))
      ) : (
        <Card className="border-amber-100 bg-amber-50/50">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-amber-700">
              当前数据暂未发现明显的优化点，保持节奏继续创作即可
            </p>
          </CardContent>
        </Card>
      )}

      {/* 「下周怎么做」应用面板（可反哺） */}
      <InsightsActionPanel
        storeId={storeId}
        recommendedNextGoals={insights.recommendedNextGoals}
        playbooksToReuse={insights.playbooksToReuse}
        playbooksToAvoid={insights.playbooksToAvoid}
      />
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

// ========================
// 本地生活指标评分卡片
// ========================

function ContentScoreCard({ metrics }: { metrics: MetricRecord[] }) {
  // 取最新一条数据计算评分
  const latest = metrics.length > 0 ? metrics[0] : null

  if (!latest) {
    return (
      <Card className="border-amber-100 bg-amber-50/50">
        <CardContent className="py-6 text-center">
          <Target className="h-7 w-7 text-amber-300 mx-auto mb-2" />
          <p className="text-sm text-amber-700">录入播放数据后即可查看本地生活指标评分</p>
        </CardContent>
      </Card>
    )
  }

  // 客户端计算评分
  const engagementRate = latest.views > 0
    ? (latest.likes + latest.comments + latest.shares + latest.saves) / latest.views
    : 0
  const conversionRate = latest.views > 0 ? latest.orders / latest.views : 0

  // 简化评分（完整算法在 content-score-service.ts）
  const engagementScore = Math.min(100, Math.round((engagementRate / 0.05) * 80))
  const conversionScore = Math.min(100, Math.round(conversionRate * 5000))
  const overallScore = Math.round(engagementScore * 0.5 + conversionScore * 0.5)

  const grade = overallScore >= 90 ? 'S' : overallScore >= 75 ? 'A' : overallScore >= 60 ? 'B' : overallScore >= 40 ? 'C' : 'D'

  const gradeColors: Record<string, string> = {
    S: 'bg-amber-500 text-white',
    A: 'bg-green-500 text-white',
    B: 'bg-blue-500 text-white',
    C: 'bg-yellow-500 text-white',
    D: 'bg-red-500 text-white',
  }

  return (
    <Card className="border-amber-100 bg-white">
      <CardContent className="p-4">
        {/* 综合评分 */}
        <div className="flex items-center gap-4 mb-4">
          <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold', gradeColors[grade] || 'bg-gray-200')}>
            {grade}
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{overallScore}</div>
            <div className="text-xs text-gray-400">综合评分</div>
          </div>
        </div>

        {/* 各维度进度条 */}
        <div className="space-y-3">
          <DimensionBar
            label="互动率"
            value={engagementRate * 100}
            score={engagementScore}
            benchmark="基准 5%"
            suffix="%"
          />
          <DimensionBar
            label="转化率"
            value={conversionRate * 100}
            score={conversionScore}
            benchmark="基准 1%"
            suffix="%"
          />
          <DimensionBar
            label="收藏率"
            value={latest.views > 0 ? (latest.saves / latest.views) * 100 : 0}
            score={Math.min(100, Math.round((latest.saves / Math.max(latest.views, 1)) * 2000))}
            benchmark="越高越好"
            suffix="%"
          />
        </div>

        {/* 快速建议 */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-gray-700">优化建议</span>
          </div>
          <div className="space-y-1.5">
            {engagementScore < 60 && (
              <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded-lg">
                互动率偏低，建议在视频结尾设置互动问题引导评论
              </p>
            )}
            {conversionScore < 60 && conversionScore > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded-lg">
                转化率待提升，建议在视频中明确展示团购套餐内容和价格
              </p>
            )}
            {overallScore >= 75 && (
              <p className="text-xs text-green-700 bg-green-50 px-2 py-1.5 rounded-lg">
                各项指标表现优秀，保持更新频率持续提升账号权重
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DimensionBar({
  label,
  value,
  score,
  benchmark,
  suffix,
}: {
  label: string
  value: number
  score: number
  benchmark: string
  suffix: string
}) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-blue-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-medium text-gray-800">{value.toFixed(2)}{suffix}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">{benchmark}</div>
    </div>
  )
}
