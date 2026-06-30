'use client'

/**
 * 指标趋势图组件（需求 1.4）
 *
 * 展示门店历史多条 brief 在选定指标（播放/点赞/转化等）上的变化趋势。
 * - 指标可在顶部切换；切换后按 store 维度拉取该指标时间序列。
 * - 数据来自 GET /api/stores/{storeId}/metrics/trend?metric=xxx（按 date 升序，每个 brief 恰一次）。
 * - 仅渲染真实数据点；无数据时如实展示空态，不伪造曲线。
 *
 * 用内联 SVG 绘制折线，避免引入额外图表依赖。
 *
 * Requirements: 1.4
 */

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LineChart } from 'lucide-react'

/** 与 performance-learning-service 的 TrendMetric 保持一致 */
type TrendMetric =
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'linkClicks'
  | 'orders'
  | 'redemptions'
  | 'conversion'

/** 趋势单点（API 返回，date 为 ISO 字符串） */
interface TrendPoint {
  briefId: string
  date: string
  value: number
}

interface TrendResponse {
  metric: TrendMetric
  trend: TrendPoint[]
}

/** 可切换指标的通俗标签（不暴露字段名） */
const METRIC_TABS: { key: TrendMetric; label: string }[] = [
  { key: 'views', label: '播放' },
  { key: 'likes', label: '点赞' },
  { key: 'saves', label: '收藏' },
  { key: 'linkClicks', label: '链接点击' },
  { key: 'orders', label: '下单' },
  { key: 'conversion', label: '转化' },
]

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('请求失败')
  return res.json()
}

interface MetricTrendChartProps {
  storeId: string
}

export function MetricTrendChart({ storeId }: MetricTrendChartProps) {
  const [metric, setMetric] = useState<TrendMetric>('views')

  const { data, isLoading } = useSWR<TrendResponse>(
    storeId ? `/api/stores/${storeId}/metrics/trend?metric=${metric}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const points = data?.trend ?? []

  return (
    <Card className="border-amber-100 bg-white">
      <CardContent className="p-4 space-y-3">
        {/* 指标切换标签 */}
        <div className="flex flex-wrap gap-2">
          {METRIC_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMetric(tab.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                metric === tab.key
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 图表区域 */}
        {isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : points.length >= 2 ? (
          <TrendSvg points={points} />
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <LineChart className="h-8 w-8 text-amber-300 mb-2" />
            <p className="text-sm text-amber-700">
              {points.length === 1
                ? '已有 1 条数据，再录入 1 条即可看到趋势变化'
                : '还没有可对比的数据，录入后这里会显示趋势变化'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ========================
// 内联 SVG 折线图
// ========================

function TrendSvg({ points }: { points: TrendPoint[] }) {
  // 视口尺寸（viewBox 内部坐标，按比例自适应容器宽度）
  const width = 320
  const height = 140
  const padX = 12
  const padY = 16

  const values = points.map((p) => p.value)
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)
  const range = maxValue - minValue || 1 // 全等时避免除零

  const innerW = width - padX * 2
  const innerH = height - padY * 2

  // 计算每个点的坐标
  const coords = points.map((p, i) => {
    const x = padX + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1))
    // value 越大 y 越小（SVG 原点在左上）
    const y = padY + innerH - ((p.value - minValue) / range) * innerH
    return { x, y, point: p }
  })

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ')

  // 首末日期标签
  const firstDate = formatShortDate(points[0]!.date)
  const lastDate = formatShortDate(points[points.length - 1]!.date)

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-40"
        preserveAspectRatio="none"
        role="img"
        aria-label="指标趋势折线图"
      >
        {/* 折线 */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 数据点 */}
        {coords.map((c) => (
          <circle key={c.point.briefId} cx={c.x} cy={c.y} r={3} fill="#d97706" />
        ))}
      </svg>

      {/* 横轴起止日期 + 峰值标注 */}
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{firstDate}</span>
        <span>最高 {formatNumber(maxValue)}</span>
        <span>{lastDate}</span>
      </div>
    </div>
  )
}

/** ISO 字符串 → M/D */
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 数字格式化：超过 1 万显示 x.x万 */
function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toString()
}
