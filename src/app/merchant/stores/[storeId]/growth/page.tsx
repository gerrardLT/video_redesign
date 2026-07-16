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
  Eye,
} from 'lucide-react'
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

/** 连续创作展示（需求 11.1, 11.5）—— 创新升级：Hero 大数字 + 去 Card 化
 *
 * 设计签名：连续天数为 64px hero 数字，数字本身就是设计。
 * 去 Card 化：hairline separator + section padding，与首页统一设计语言。
 */
function StreakSection({ streak }: { streak: StreakResult }) {
  const nextDay = nextThreshold(streak.days, STREAK_DAY_THRESHOLDS)
  const nextWeek = nextThreshold(streak.weeks, STREAK_WEEK_THRESHOLDS)

  if (streak.days === 0 && streak.weeks === 0) {
    return (
      <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
          <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)]">连续创作</h3>
        </div>
        <p className="text-sm text-[var(--ll-text-2)]">
          还没有连续发布记录，发布你的第一条内容就能点亮连续创作
        </p>
      </section>
    )
  }

  return (
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      {/* Hero 区域：连续天数大数字 + SVG 火焰 */}
      <div className="flex items-end gap-3 mb-4">
        <Flame className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
        <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)]">连续创作</h3>
      </div>

      {/* Hero 数字 — 64px Space Grotesk，数字本身就是设计 */}
      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="font-[var(--font-num)] text-[64px] leading-none font-bold tabular-nums text-[var(--ll-green)]"
          style={{ letterSpacing: '-0.02em' }}
        >
          {streak.days}
        </span>
        <span className="text-base text-[var(--ll-text-2)] mb-1">天</span>
      </div>

      {nextDay !== null && (
        <div className="flex items-center gap-2 mb-5">
          <div className="flex-1 h-[2px] bg-[var(--ll-hair)] rounded-[1px] relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--ll-green)] rounded-[1px]"
              style={{
                width: `${(streak.days / nextDay) * 100}%`,
                transition: 'width 600ms var(--ease-out)',
              }}
            />
          </div>
          <span className="text-xs text-[var(--ll-text-3)] whitespace-nowrap tabular-nums">
            距 {nextDay} 天徽章还差 {nextDay - streak.days}
          </span>
        </div>
      )}

      {/* 天/周双指标 — 并排紧凑布局 */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-[var(--ll-green)]" strokeWidth={1.5} />
          <span className="font-[var(--font-num)] text-xl font-semibold tabular-nums text-[var(--ll-text)]">{streak.days}</span>
          <span className="text-xs text-[var(--ll-text-3)]">天</span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[var(--ll-green)]" strokeWidth={1.5} />
          <span className="font-[var(--font-num)] text-xl font-semibold tabular-nums text-[var(--ll-text)]">{streak.weeks}</span>
          <span className="text-xs text-[var(--ll-text-3)]">周</span>
        </div>
      </div>

      {nextWeek !== null && (
        <p className="mt-2 text-xs text-[var(--ll-gold)]">
          距「{nextWeek} 周」徽章还差 {nextWeek - streak.weeks} 周
        </p>
      )}
    </section>
  )
}

/** 里程碑徽章种类 → 图标 */
const MILESTONE_ICON: Record<MilestoneKind, typeof Trophy> = {
  STREAK_DAYS: Flame,
  STREAK_WEEKS: CalendarDays,
  WEEK_COMPLETED: Award,
}

/** 里程碑徽章 + 鼓励文案（需求 11.2）—— 去 Card 化 */
function MilestoneSection({ milestones }: { milestones: Milestone[] }) {
  return (
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-[var(--ll-gold)]" strokeWidth={1.5} />
        <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)]">我的里程碑</h3>
      </div>
      {milestones.length === 0 ? (
        <p className="text-sm text-[var(--ll-text-2)]">
          坚持发布内容，达成连续创作或完成整周任务就能点亮第一枚徽章
        </p>
      ) : (
        <div className="space-y-3">
          {milestones.map((m) => {
            const Icon = MILESTONE_ICON[m.kind] ?? Trophy
            return (
              <div
                key={m.id}
                className="flex items-start gap-3 rounded-[3px] bg-[var(--ll-gold-lightest,#FAF6EE)] p-3 border border-[var(--ll-gold)]/20"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ll-gold)]/10">
                  <Icon className="h-5 w-5 text-[var(--ll-gold-ink,#8A6D2F)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--ll-text)]">{m.title}</p>
                    <Badge className="border-[var(--ll-gold)]/30 bg-[var(--ll-gold-lightest,#FAF6EE)] text-[10px] text-[var(--ll-gold-ink,#8A6D2F)]">
                      已达成
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--ll-text-2)]">{m.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** 真实效果对比（需求 11.3, 11.5）—— 去 Card 化 */
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
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
        <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)]">效果对比</h3>
      </div>
      {!comparison.available ? (
        <div className="rounded-[3px] bg-[var(--ll-muted)] p-4 text-center">
          <p className="text-sm text-[var(--ll-text-2)]">数据还不够，暂时无法对比</p>
          <p className="mt-1 text-xs text-[var(--ll-text-3)]">
            连续两个月都有带数据的内容后，这里会展示「本月最佳 vs 上月最佳」
          </p>
        </div>
      ) : (
        <ComparisonDetail comparison={comparison} storeId={storeId} onOpen={onOpen} />
      )}
    </section>
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
  const trendColor = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-[var(--ll-text-3)]'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <BestContentCard best={lastBest} storeId={storeId} onOpen={onOpen} muted />
        <BestContentCard best={thisBest} storeId={storeId} onOpen={onOpen} />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <TrendIcon className={`h-4 w-4 ${trendColor}`} />
        <span className={`text-sm font-medium ${trendColor}`}>
          {delta > 0 ? `播放提升 ${delta}` : delta < 0 ? `播放下降 ${-delta}` : '播放持平'}
        </span>
      </div>

      {/* evidence 通俗话术（可解释，需求 11.3） */}
      <p className="rounded-[3px] bg-[var(--ll-green)]/5 border border-[var(--ll-green)]/10 p-3 text-xs leading-relaxed text-[var(--ll-text-2)]">
        {evidence}
      </p>
    </div>
  )
}

/** 单条最佳内容卡片 —— 去 Card 化，hairline + hover 效果 */
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
      className={`rounded-[3px] p-3 text-left transition-colors cursor-pointer active:bg-[var(--ll-ceramic)] ${
        muted ? 'bg-[var(--ll-muted)] hover:bg-[var(--ll-ceramic)]' : 'bg-[var(--ll-green)]/5 hover:bg-[var(--ll-green)]/10'
      }`}
    >
      <p className="text-[11px] text-[var(--ll-text-3)]">{best.periodLabel}最佳</p>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-[var(--ll-text)]">{best.title}</p>
      <div className={`mt-2 flex items-center gap-1 text-xs ${muted ? 'text-[var(--ll-text-2)]' : 'text-[var(--ll-green)]'}`}>
        <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span>{best.value} 播放</span>
      </div>
    </button>
  )
}

/** 新手进阶引导（需求 11.4）—— 去 Card 化，hairline separator 模式 */
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
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
          <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)]">进阶引导</h3>
        </div>
        <span className="text-xs text-[var(--ll-text-3)]">
          {completedCount}/{tasks.length} 已完成
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => {
          const clickable = !task.locked
          return (
            <button
              key={task.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onOpen(task.actionHref)}
              className={`flex w-full items-center gap-3 rounded-[3px] border p-3 text-left transition-colors ${
                task.locked
                  ? 'cursor-not-allowed border-[var(--ll-hair)] bg-[var(--ll-muted)] opacity-70'
                  : 'border-[var(--ll-hair)] bg-transparent hover:bg-[var(--ll-ceramic)] cursor-pointer active:bg-[var(--ll-ceramic)]'
              }`}
            >
              <div className="shrink-0">
                {task.completed ? (
                  <CheckCircle2 className="h-6 w-6 text-[var(--ll-green)]" />
                ) : task.locked ? (
                  <Lock className="h-6 w-6 text-[var(--ll-text-3)]" />
                ) : (
                  <Circle className="h-6 w-6 text-[var(--ll-gold)]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    task.completed ? 'text-[var(--ll-text-3)] line-through' : 'text-[var(--ll-text)]'
                  }`}
                >
                  {task.title}
                </p>
                <p className="mt-0.5 text-xs text-[var(--ll-text-2)]">
                  {task.locked ? '完成上一步后解锁' : task.description}
                </p>
              </div>
              {clickable && !task.completed && (
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--ll-text-3)]" />
              )}
            </button>
          )
        })}
      </div>
    </section>
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
          className="rounded-full border border-[var(--ll-hair)] px-4 py-1.5 text-sm text-[var(--ll-text-2)] hover:bg-[var(--ll-muted)]"
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
      <div className="flex items-center gap-2 pt-1 zen-reveal">
        <Trophy className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
        <h1 className="text-[var(--text-title)] font-semibold font-[var(--font-serif)] text-[var(--ll-text)]">我的成长</h1>
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
