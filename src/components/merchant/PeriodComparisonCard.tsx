'use client'

/**
 * 跨周对比组件（需求 1.5）
 *
 * 对比两个最近「已结束且含数据」的内容周期（本周 vs 上周）的关键指标增减。
 * - 数据来自 GET /api/stores/{storeId}/metrics/period-comparison。
 * - 已结束且含数据的周期 <2 时返回 available:false，前端如实展示提示，不伪造对比。
 *
 * Requirements: 1.5
 */

import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowUp, ArrowDown, Minus, CalendarRange } from 'lucide-react'

/** 周期指标摘要（API 返回，date 为 ISO 字符串） */
interface PeriodSummary {
  periodIndex: number
  label: string
  startDate: string
  endDate: string
  briefCount: number
  metrics: Record<string, number>
}

type ComparisonResponse =
  | { available: false; reason: string }
  | {
      available: true
      current: PeriodSummary
      previous: PeriodSummary
      deltas: Record<string, number>
    }

/** 展示的关键指标及通俗标签（不暴露字段名） */
const KEY_METRICS: { key: string; label: string }[] = [
  { key: 'views', label: '播放' },
  { key: 'likes', label: '点赞' },
  { key: 'linkClicks', label: '链接点击' },
  { key: 'orders', label: '下单' },
  { key: 'conversion', label: '转化' },
]

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('请求失败')
  return res.json()
}

interface PeriodComparisonCardProps {
  storeId: string
}

export function PeriodComparisonCard({ storeId }: PeriodComparisonCardProps) {
  const { data, isLoading } = useSWR<ComparisonResponse>(
    storeId ? `/api/stores/${storeId}/metrics/period-comparison` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return <Skeleton className="h-32 rounded-xl" />
  }

  // 数据不足：如实提示，不伪造对比
  if (!data || data.available === false) {
    return (
      <Card className="border-amber-100 bg-amber-50/50">
        <CardContent className="py-6 text-center">
          <CalendarRange className="h-7 w-7 text-amber-300 mx-auto mb-2" />
          <p className="text-sm text-amber-700">
            {data && data.available === false
              ? data.reason
              : '暂无法进行跨周对比'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-100 bg-white">
      <CardContent className="p-4 space-y-3">
        {/* 周期标签：上周 → 本周 */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <span>{data.previous.label}</span>
          <span className="text-amber-400">对比</span>
          <span className="font-medium text-amber-700">{data.current.label}</span>
        </div>

        {/* 关键指标增减网格 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KEY_METRICS.map((m) => (
            <ComparisonCell
              key={m.key}
              label={m.label}
              current={data.current.metrics[m.key] ?? 0}
              delta={data.deltas[m.key] ?? 0}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ========================
// 单指标对比单元
// ========================

function ComparisonCell({
  label,
  current,
  delta,
}: {
  label: string
  current: number
  delta: number
}) {
  const isUp = delta > 0
  const isDown = delta < 0
  const deltaColor = isUp ? 'text-green-600' : isDown ? 'text-red-500' : 'text-gray-400'
  const DeltaIcon = isUp ? ArrowUp : isDown ? ArrowDown : Minus

  return (
    <div className="rounded-xl bg-amber-50/60 p-2.5 text-center">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-gray-900">{formatNumber(current)}</div>
      <div className={`mt-0.5 flex items-center justify-center gap-0.5 text-xs ${deltaColor}`}>
        <DeltaIcon className="h-3 w-3" />
        <span>{formatDelta(delta)}</span>
      </div>
    </div>
  )
}

/** 数字格式化：超过 1 万显示 x.x万 */
function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toString()
}

/** 增减量格式化：带正负号，0 显示「持平」 */
function formatDelta(delta: number): string {
  if (delta === 0) return '持平'
  const sign = delta > 0 ? '+' : '-'
  return `${sign}${formatNumber(Math.abs(delta))}`
}
