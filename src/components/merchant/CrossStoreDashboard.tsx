'use client'

/**
 * 跨店看板（CrossStoreDashboard）—— 多门店 KPI 聚合总览（需求 10.3, 10.4, 10.5）
 *
 * 挂载于门店列表页（/merchant/stores）。行为：
 * - 仅当 /api/stores/switcher 返回 multiStore=true 时才渲染看板；单店 / 无多店权益时返回 null，
 *   隐藏不展示空壳（需求 10.4 / Property 34），与门店切换器可见性保持一致。
 * - 数据来自 /api/stores/dashboard 的真实聚合：逐店本周内容完成度、最佳视频表现、待办数，
 *   绝不占位/伪造（需求 10.3, 10.5 / Property 35）。门店无数据时如实展示（完成度 0、
 *   最佳视频「暂无数据」、待办 0）。
 * - 点击某门店卡片直达该门店首页（保持作用域一致）。
 *
 * 纯前端组件，数据来自后端已就绪的 GET /api/stores/switcher 与 GET /api/stores/dashboard。
 *
 * Requirements: 10.3, 10.4, 10.5
 */

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { LayoutGrid, TrendingUp, ListTodo, PlayCircle } from 'lucide-react'

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
// 类型（对应后端 cross-store-service）
// ========================

type SwitcherData =
  | { multiStore: false }
  | { multiStore: true; stores: { storeId: string; name: string }[] }

interface WeeklyCompletion {
  total: number
  completed: number
  rate: number
  weekLabel: string
}

interface BestVideoSummary {
  contentBriefId: string
  title: string
  views: number
  likes: number
  conversion: number
}

interface StoreKpiSummary {
  storeId: string
  storeName: string
  weeklyCompletion: WeeklyCompletion
  bestVideo: BestVideoSummary | null
  todoCount: number
}

// ========================
// 工具函数
// ========================

/** 格式化数字（千/万） */
function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`
  return String(n)
}

// ========================
// 子组件：单门店 KPI 卡片
// ========================

function StoreKpiCard({ kpi, onOpen }: { kpi: StoreKpiSummary; onOpen: () => void }) {
  const { weeklyCompletion: wc, bestVideo, todoCount } = kpi
  const ratePercent = Math.round(wc.rate * 100)

  return (
    <Card
      className="cursor-pointer rounded-2xl border-amber-100 transition-all hover:border-orange-300 hover:shadow-md"
      onClick={onOpen}
    >
      <CardContent className="space-y-3 py-4">
        {/* 门店名 + 待办数 */}
        <div className="flex items-center justify-between">
          <h3 className="truncate font-semibold text-gray-900">{kpi.storeName}</h3>
          <span className="flex items-center gap-1 text-xs text-orange-600">
            <ListTodo className="h-3.5 w-3.5" />
            待办 {todoCount}
          </span>
        </div>

        {/* 本周完成度 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{wc.weekLabel} 内容完成度</span>
            <span className="font-medium text-amber-700">
              {wc.completed}/{wc.total}（{ratePercent}%）
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${ratePercent}%` }}
            />
          </div>
        </div>

        {/* 最佳视频表现 */}
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] text-gray-400">
            <TrendingUp className="h-3 w-3" />
            最佳视频表现
          </div>
          {bestVideo ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1 truncate text-sm font-medium text-gray-800">
                <PlayCircle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                {bestVideo.title}
              </p>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span>👁️ {formatNumber(bestVideo.views)} 播放</span>
                <span>❤️ {formatNumber(bestVideo.likes)} 赞</span>
                <span>🛒 {formatNumber(bestVideo.conversion)} 转化</span>
              </div>
            </div>
          ) : (
            // 真实无数据：如实展示，不占位/伪造（需求 10.5）
            <p className="text-xs text-gray-400">暂无数据，发布内容后自动汇总</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ========================
// 主组件
// ========================

export function CrossStoreDashboard() {
  const router = useRouter()

  // 可见性裁决：与门店切换器一致，仅 multiStore=true 时渲染看板
  const { data: switcher } = useSWR<SwitcherData>('/api/stores/switcher', fetcher, {
    revalidateOnFocus: false,
  })

  const multiStore = switcher?.multiStore === true

  // 仅在确认多店时才拉取看板数据（避免单店场景无谓请求）
  const { data, error, isLoading } = useSWR<{ stores: StoreKpiSummary[] }>(
    multiStore ? '/api/stores/dashboard' : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 单店 / 无多店权益 / 切换器数据未就绪 → 隐藏看板，不展示空壳（需求 10.4）
  if (!multiStore) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-amber-600" />
        <h2 className="text-base font-bold text-amber-900">跨店看板</h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-red-500">
          {(error as Error).message || '看板加载失败'}
        </p>
      ) : (
        <div className="space-y-3">
          {(data?.stores ?? []).map((kpi) => (
            <StoreKpiCard
              key={kpi.storeId}
              kpi={kpi}
              onOpen={() => router.push(`/merchant/stores/${kpi.storeId}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
