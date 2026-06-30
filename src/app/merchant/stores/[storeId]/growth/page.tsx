'use client'

/**
 * 激励与留存页 — /merchant/stores/[storeId]/growth
 *
 * 激励留存前端（需求 11.1, 11.2, 11.3, 11.4, 11.5）。
 *
 * 展示内容（数据全部来自后端 GET /api/stores/{storeId}/engagement，本页纯前端）：
 * - 连续创作（需求 11.1）：连续发布天数 / 周数，基于真实发布数据，无记录显示 0 不伪造。
 * - 里程碑徽章 / 进度 / 鼓励文案（需求 11.2）：展示已达成里程碑徽章 + 鼓励文案；
 *   并基于真实连续创作值展示「距下一里程碑还差 N」的进度（进度由真实 streak 派生，非伪造）。
 * - 真实效果对比（需求 11.3）：本月最佳 vs 上月最佳（含 evidence 通俗话术）；
 *   后端 growthComparison.available=false（历史不足）时显式提示「数据还不够」，不制造虚假成长。
 * - 新手进阶引导（需求 11.4）：渐进式进阶任务清单，完成 / 锁定状态由真实数据派生，可直达对应页面。
 *
 * 数据契约（对应 engagement-service / API route）：
 *   {
 *     streak: { days, weeks },
 *     milestones: Milestone[],
 *     growthComparison: { available:false } | { available:true, thisBest, lastBest, evidence },
 *     onboarding: OnboardingTask[]
 *   }
 *
 * 设计原则：面向小白老板，暖色调 + 大圆角 + 鼓励性话术；数据不足时显式提示，绝不伪造成长。
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  Flame,
  CalendarDays,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Lock,
  CheckCircle2,
  Circle,
  ChevronRight,
  Award,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'

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
// 类型（对应后端 engagement-service 返回）
// ========================

interface StreakResult {
  days: number
  weeks: number
}

type MilestoneKind = 'STREAK_DAYS' | 'STREAK_WEEKS' | 'WEEK_COMPLETED'

interface Milestone {
  id: string
  kind: MilestoneKind
  title: string
  description: string
  achievedValue: number
  actionHref: string
}

interface BestContent {
  briefId: string
  title: string
  metric: 'views'
  value: number
  periodLabel: string
}

type GrowthComparison =
  | { available: false }
  | { available: true; thisBest: BestContent; lastBest: BestContent; evidence: string }

interface OnboardingTask {
  id: string
  order: number
  title: string
  description: string
  completed: boolean
  locked: boolean
  actionHref: string
}

interface EngagementData {
  streak: StreakResult
  milestones: Milestone[]
  growthComparison: GrowthComparison
  onboarding: OnboardingTask[]
}

// ========================
// 常量（与后端 engagement-service 阈值保持一致，仅用于「距下一里程碑」进度展示）
// 注意：进度数值完全由真实 streak 派生，非伪造成长；阈值用于计算「还差多少」。
// ========================

/** 连续「天数」里程碑阈值（与 engagement-service.STREAK_DAY_THRESHOLDS 对齐） */
const STREAK_DAY_THRESHOLDS = [3, 7, 14, 30]

/** 连续「周数」里程碑阈值（与 engagement-service.STREAK_WEEK_THRESHOLDS 对齐） */
const STREAK_WEEK_THRESHOLDS = [2, 4, 8, 12]

/** 返回大于 current 的最小阈值；若已超过全部阈值则返回 null（已封顶） */
function nextThreshold(current: number, thresholds: number[]): number | null {
  for (const t of thresholds) {
    if (current < t) return t
  }
  return null
}

// ========================
// 子组件
// ========================

/** 连续创作展示（需求 11.1, 11.5）：天数 / 周数双指标，真实数据，无记录显示 0 */
function StreakSection({ streak }: { streak: StreakResult }) {
  const nextDay = nextThreshold(streak.days, STREAK_DAY_THRESHOLDS)
  const nextWeek = nextThreshold(streak.weeks, STREAK_WEEK_THRESHOLDS)

  return (
    <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-800">
          <Flame className="h-5 w-5 text-orange-500" />
          连续创作
        </CardTitle>
      </CardHeader>
      <CardContent>
        {streak.days === 0 && streak.weeks === 0 ? (
          // 无任何连续发布记录 —— 显式提示，不伪造
          <p className="text-sm text-gray-600">
            还没有连续发布记录，发布你的第一条内容就能点亮连续创作 🔥
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/70 p-4 text-center">
              <div className="flex items-center justify-center gap-1 text-orange-600">
                <Flame className="h-5 w-5" />
                <span className="text-3xl font-bold">{streak.days}</span>
                <span className="text-sm text-gray-500 self-end mb-1">天</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">连续发布天数</p>
              {nextDay !== null && (
                <p className="mt-1 text-[11px] text-orange-500">
                  距「{nextDay} 天」徽章还差 {nextDay - streak.days} 天
                </p>
              )}
            </div>
            <div className="rounded-2xl bg-white/70 p-4 text-center">
              <div className="flex items-center justify-center gap-1 text-amber-600">
                <CalendarDays className="h-5 w-5" />
                <span className="text-3xl font-bold">{streak.weeks}</span>
                <span className="text-sm text-gray-500 self-end mb-1">周</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">连续创作周数</p>
              {nextWeek !== null && (
                <p className="mt-1 text-[11px] text-amber-500">
                  距「{nextWeek} 周」徽章还差 {nextWeek - streak.weeks} 周
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 里程碑徽章种类 → 图标 */
const MILESTONE_ICON: Record<MilestoneKind, typeof Trophy> = {
  STREAK_DAYS: Flame,
  STREAK_WEEKS: CalendarDays,
  WEEK_COMPLETED: Award,
}

/** 里程碑徽章 + 鼓励文案（需求 11.2） */
function MilestoneSection({ milestones }: { milestones: Milestone[] }) {
  return (
    <Card className="border-yellow-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gray-800">
          <Trophy className="h-5 w-5 text-yellow-500" />
          我的里程碑
        </CardTitle>
      </CardHeader>
      <CardContent>
        {milestones.length === 0 ? (
          // 尚未达成任何里程碑 —— 显式提示，不伪造徽章
          <p className="text-sm text-gray-600">
            坚持发布内容，达成连续创作或完成整周任务就能点亮第一枚徽章 🏆
          </p>
        ) : (
          <div className="space-y-3">
            {milestones.map((m) => {
              const Icon = MILESTONE_ICON[m.kind] ?? Trophy
              return (
                <div
                  key={m.id}
                  className="flex items-start gap-3 rounded-2xl bg-gradient-to-r from-yellow-50 to-amber-50 p-3"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-yellow-100">
                    <Icon className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800">{m.title}</p>
                      <Badge className="border-yellow-300 bg-yellow-100 text-[10px] text-yellow-700">
                        已达成
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{m.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 真实效果对比（需求 11.3, 11.5）：本月最佳 vs 上月最佳，含 evidence；不足显式提示 */
function GrowthComparisonSection({
  comparison,
  storeId,
  onOpen,
}: {
  comparison: GrowthComparison
  storeId: string
  onOpen: (href: string) => void
}) {
  return (
    <Card className="border-green-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gray-800">
          <Sparkles className="h-5 w-5 text-green-500" />
          效果对比
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!comparison.available ? (
          // 历史不足 —— 显式提示「数据还不够」，绝不制造虚假成长（需求 11.5）
          <div className="rounded-2xl bg-gray-50 p-4 text-center">
            <p className="text-sm text-gray-600">数据还不够，暂时无法对比</p>
            <p className="mt-1 text-xs text-gray-400">
              连续两个月都有带数据的内容后，这里会展示「本月最佳 vs 上月最佳」
            </p>
          </div>
        ) : (
          <ComparisonDetail comparison={comparison} storeId={storeId} onOpen={onOpen} />
        )}
      </CardContent>
    </Card>
  )
}

/** 效果对比明细（available=true 时渲染） */
function ComparisonDetail({
  comparison,
  storeId,
  onOpen,
}: {
  comparison: Extract<GrowthComparison, { available: true }>
  storeId: string
  onOpen: (href: string) => void
}) {
  const { thisBest, lastBest, evidence } = comparison
  const delta = thisBest.value - lastBest.value
  const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  const trendColor = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-500'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <BestContentCard best={lastBest} storeId={storeId} onOpen={onOpen} muted />
        <BestContentCard best={thisBest} storeId={storeId} onOpen={onOpen} />
      </div>

      {/* 趋势 */}
      <div className={`flex items-center justify-center gap-1 text-sm font-medium ${trendColor}`}>
        <TrendIcon className="h-4 w-4" />
        {delta > 0 ? `播放提升 ${delta}` : delta < 0 ? `播放下降 ${-delta}` : '播放持平'}
      </div>

      {/* evidence 通俗话术（可解释，需求 11.3） */}
      <p className="rounded-xl bg-green-50 p-3 text-xs leading-relaxed text-green-800">
        {evidence}
      </p>
    </div>
  )
}

/** 单条最佳内容卡片 */
function BestContentCard({
  best,
  storeId,
  onOpen,
  muted = false,
}: {
  best: BestContent
  storeId: string
  onOpen: (href: string) => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/merchant/stores/${storeId}/briefs/${best.briefId}/metrics`)}
      className={`rounded-2xl p-3 text-left transition-colors ${
        muted ? 'bg-gray-50 hover:bg-gray-100' : 'bg-green-50 hover:bg-green-100'
      }`}
    >
      <p className="text-[11px] text-gray-400">{best.periodLabel}最佳</p>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-gray-800">{best.title}</p>
      <p className={`mt-2 text-xs ${muted ? 'text-gray-500' : 'text-green-600'}`}>
        👁️ {best.value} 播放
      </p>
    </button>
  )
}

/** 新手进阶引导（需求 11.4）：渐进式任务清单 */
function OnboardingSection({
  tasks,
  onOpen,
}: {
  tasks: OnboardingTask[]
  onOpen: (href: string) => void
}) {
  if (tasks.length === 0) return null

  const completedCount = tasks.filter((t) => t.completed).length

  return (
    <Card className="border-amber-100">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-gray-800">
            <Sparkles className="h-5 w-5 text-amber-500" />
            进阶引导
          </CardTitle>
          <span className="text-xs text-gray-400">
            {completedCount}/{tasks.length} 已完成
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((task) => {
          const clickable = !task.locked
          return (
            <button
              key={task.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onOpen(task.actionHref)}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                task.locked
                  ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-70'
                  : 'border-amber-100 bg-white hover:border-amber-200 hover:bg-amber-50/50'
              }`}
            >
              <div className="shrink-0">
                {task.completed ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : task.locked ? (
                  <Lock className="h-6 w-6 text-gray-300" />
                ) : (
                  <Circle className="h-6 w-6 text-amber-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    task.completed ? 'text-gray-400 line-through' : 'text-gray-800'
                  }`}
                >
                  {task.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {task.locked ? '完成上一步后解锁' : task.description}
                </p>
              </div>
              {clickable && !task.completed && (
                <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" />
              )}
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ========================
// 主页面
// ========================

export default function GrowthPage() {
  const params = useParams<{ storeId: string }>()
  const storeId = params.storeId
  const router = useRouter()

  const { data, error, isLoading, mutate } = useSWR<EngagementData>(
    storeId ? `/api/stores/${storeId}/engagement` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-red-500">{(error as Error).message || '加载失败'}</p>
        <button
          type="button"
          onClick={() => mutate()}
          className="rounded-full border border-amber-200 px-4 py-1.5 text-sm text-amber-700 hover:bg-amber-50"
        >
          重试
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* 标题 */}
      <div className="flex items-center gap-2 pt-1">
        <Trophy className="h-5 w-5 text-amber-600" />
        <h1 className="text-lg font-bold text-gray-800">我的成长</h1>
      </div>

      {/* 连续创作（需求 11.1） */}
      <StreakSection streak={data.streak} />

      {/* 里程碑徽章 / 鼓励文案（需求 11.2） */}
      <MilestoneSection milestones={data.milestones} />

      {/* 真实效果对比（需求 11.3） */}
      <GrowthComparisonSection
        comparison={data.growthComparison}
        storeId={storeId}
        onOpen={(href) => router.push(href)}
      />

      {/* 新手进阶引导（需求 11.4） */}
      <OnboardingSection tasks={data.onboarding} onOpen={(href) => router.push(href)} />
    </div>
  )
}
