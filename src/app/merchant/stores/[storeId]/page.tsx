'use client'

/**
 * 门店首页 — /merchant/stores/[storeId]
 *
 * 商家每日进入的第一个页面，展示：
 * - 今日任务 Hero 区域（v3 Zen 设计签名：kicker + 绿发丝线 + serif 大标题 + 绿色 border-left）
 * - 周计划概览（节气式七日布局）
 * - 待办事项数量
 * - 最佳视频区块（过去 14 天播放量最高的 VideoVariant）
 * - 无历史视频时显示首次任务引导提示（Req 15.6）
 *
 * 视觉方案：v3 禅意编辑式 — 去卡片化（hairline separator + section padding），
 * 移除渐变背景，统一 var(--canvas) 纯色底，各区块添加 .zen-reveal stagger 入场。
 * 图标体系：所有功能性图标统一使用 lucide-react strokeWidth 1.5，
 * 尺寸三档：辅助 h-4(16px) / 正文行内 h-5(20px) / 独立功能 h-6(24px)。
 * 功能性 emoji 已全部替换为 lucide 图标（📌→Pin, 🏆→Trophy, 👁️→Eye）。
 *
 * 数据获取：
 * - useSWR('/api/stores/{storeId}/today')
 * - useSWR('/api/stores/{storeId}/content-plan/current')
 * - useSWR('/api/merchant/subscription')
 *
 * Requirements: 2.1, 2.3, 2.4, 3.1, 3.3, 5.2, 6.1, 6.2, 7.3, 7.4, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 14.3, 15.1, 15.6
 */

import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState, ZenButton } from '@/components/merchant'
import { Film, Camera, Upload, Sparkles, Send, Trophy, Eye, Pin, ChevronRight } from 'lucide-react'
import Link from 'next/link'

// ========================
// 晨间问候（随时段变化）
// ========================

function getTimeGreeting(): { text: string; sub: string } {
  const hour = new Date().getHours()
  if (hour < 6) return { text: '夜深了，注意休息', sub: '明天的内容已经安排好了' }
  if (hour < 12) return { text: '早安', sub: '新的一天，新的内容' }
  if (hour < 14) return { text: '午安', sub: '下午继续加油' }
  if (hour < 18) return { text: '下午好', sub: '趁光线正好，完成今天的拍摄' }
  return { text: '晚上好', sub: '回顾今天，规划明天' }
}

/** 晨间问候条 — serif 斜体 + 任务摘要（设计签名：进入首页第一秒的仪式感） */
function MorningGreeting({ taskCount }: { taskCount: number }) {
  const { text, sub } = getTimeGreeting()
  return (
    <div className="zen-reveal pb-2 pt-1">
      <p
        className="font-[var(--font-serif)] text-lg italic text-[var(--ll-text-2)] leading-snug"
        style={{ textWrap: 'balance' }}
      >
        {text}
        {taskCount > 0 && (
          <span className="not-italic font-normal text-[var(--ll-green)]">，今天有 {taskCount} 个镜头等你</span>
        )}
      </p>
      <p className="text-xs text-[var(--ll-text-3)] mt-1">{sub}</p>
    </div>
  )
}

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
// ContentGoal 中文映射
// ========================

const GOAL_LABELS: Record<string, string> = {
  TRAFFIC: '引流',
  PROMOTION: '促销',
  NEW_PRODUCT: '新品',
  TRUST_BUILDING: '人设',
  BRAND_STORY: '品牌',
  CUSTOMER_TESTIMONIAL: '口碑',
  WEEKEND_BOOST: '周末',
  REPEAT_PURCHASE: '复购',
}

// ========================
// 组件
// ========================

/** UserTier → 会员等级中文名（计费收敛后统一等级，merchant-billing-unification） */
const MEMBER_TIER_LABELS: Record<string, string> = {
  FREE: '免费版',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}

/** 今日任务 Hero 区域 — 设计签名（Req 12.1, 12.2, 12.3, 1.3）
 *
 * v3 Zen 设计签名——整个商家端唯一一处明显的装饰性设计元素：
 * - Kicker 文字（12px, letter-spacing:.1em, --ll-green, font-weight:500）+ 左侧 24px×1.5px 绿色发丝线
 * - 大标题 Noto Serif SC、29px、font-weight:600、line-height:1.38，左侧 2px 宽绿色 border-left
 * - 整体包裹在 .zen-reveal 动画容器内
 */
function TodayTaskCard({ brief }: { brief: TodayBrief | null }) {
  const params = useParams()
  const storeId = params.storeId as string

  if (!brief) {
    return (
      <div className="zen-reveal py-6">
        {/* 无今日任务空态 — 使用 EmptyState 组件（Req 3.1, 3.3） */}
        <EmptyState
          illustration="checklist"
          title="今天没有安排任务"
          description="查看周计划，安排你的下一次拍摄"
        />
        <div className="flex justify-center mt-2">
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <ZenButton variant="ghost">查看周计划</ZenButton>
          </Link>
        </div>
      </div>
    )
  }

  // 计算拍摄进度
  const requiredShots = brief.shotTasks.filter((s: ShotTask) => s.required)
  const capturedShots = requiredShots.filter((s: ShotTask) => s.status === 'CAPTURED')
  const progress = requiredShots.length > 0
    ? Math.round((capturedShots.length / requiredShots.length) * 100)
    : 0

  return (
    <div className="zen-reveal py-6">
      {/* 今日任务封面：已拍镜头的真实缩略图帧；未拍摄时不显示（不伪造菜品图） */}
      {brief.coverUrl && (
        <div className="aspect-[16/9] w-full overflow-hidden rounded-[3px] bg-[var(--ll-ceramic)] mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brief.coverUrl} alt={brief.title} className="h-full w-full object-cover" />
        </div>
      )}

      {/* Kicker 文字 + 绿发丝线 */}
      <div className="flex items-center gap-2 mb-3.5">
        <span className="w-6 h-[1.5px] bg-[var(--ll-green)]" />
        <span className="text-xs tracking-[.1em] text-[var(--ll-green)] font-medium">
          今日任务
        </span>
      </div>

      {/* 大标题 + 左侧绿色 border */}
      <h2
        className="font-[var(--font-serif)] text-[29px] font-semibold leading-[1.38] pl-4 border-l-2 border-[var(--ll-green)]"
        style={{ textWrap: 'balance' }}
      >
        {brief.title}
      </h2>

      {/* 目标标签 */}
      <p className="text-sm text-[var(--ll-text-2)] mt-3 pl-4">
        目标：{GOAL_LABELS[brief.goal] || brief.goal}
      </p>

      {/* 拍摄进度 — 2px 细线 + Space Grotesk 数字（Req 10.1, 10.2, 10.3, 5.4） */}
      <div className="flex items-center gap-4 mt-5">
        <span className="font-[var(--font-num)] text-2xl font-semibold text-[var(--ll-green)] tabular-nums">
          {capturedShots.length}<small className="text-sm text-[var(--ll-text-3)] font-normal ml-0.5">/{requiredShots.length}</small>
        </span>
        <div className="flex-1 h-[2px] bg-[var(--ll-hair)] rounded-[1px] relative">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--ll-green)] rounded-[1px] transition-[width]"
            style={{ width: `${progress}%`, transitionDuration: '600ms', transitionTimingFunction: 'var(--ease-out)' }}
          />
        </div>
      </div>

      <Link href={`/merchant/stores/${storeId}/briefs/${brief.id}/shoot`} className="block mt-5">
        <ZenButton variant="primary" fullWidth>开始拍摄</ZenButton>
      </Link>
    </div>
  )
}

/**
 * 周计划概览 — 横向时间轴（创新升级）
 *
 * 从竖向圆点列表改为横向时间轴：7 天节点用 2px 线段连接，
 * 已完成的节点间为实绿线，未完成的为虚灰线 — 像一条正在被走完的路。
 *
 * 节点样式：
 * - 已完成：10px 实心绿圆点
 * - 今日：12px 绿圆点 + 呼吸光晕（box-shadow pulse）
 * - 未来：10px 灰色空心圆点
 *
 * Requirements: 11.1, 11.2, 11.3
 */
function WeeklyCalendar({ briefs }: { briefs: BriefSummary[] }) {
  const params = useParams()
  const storeId = params.storeId as string

  const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

  // 构建七日数据
  const days = briefs.slice(0, 7).map((brief, idx) => {
    const isCompleted = ['GENERATED', 'READY_TO_EXPORT', 'EXPORTED', 'PUBLISHED'].includes(brief.status)
    const isToday = isSameDay(new Date(brief.scheduledDate), new Date())
    const isFuture = !isCompleted && !isToday

    return {
      label: weekDays[idx] || `第${idx + 1}天`,
      isCompleted,
      isToday,
      isFuture,
      goalText: GOAL_LABELS[brief.goal] || brief.goal,
    }
  })

  return (
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text-1)]">
          本周计划
        </h3>
        <Link
          href={`/merchant/stores/${storeId}/calendar`}
          className="text-[11px] text-[var(--ll-text-3)] hover:text-[var(--ll-green)]"
        >
          查看详情
        </Link>
      </div>

      {/* 横向时间轴 */}
      <div className="relative px-1">
        {/* 背景连接线（底层灰色虚线） */}
        <div className="absolute top-[11px] left-[calc(100%/14)] right-[calc(100%/14)] h-[2px]">
          <div className="w-full h-full" style={{
            backgroundImage: 'repeating-linear-gradient(to right, var(--ll-hair) 0, var(--ll-hair) 6px, transparent 6px, transparent 10px)',
          }} />
        </div>

        {/* 已完成段落的实绿覆盖线（动态计算宽度） */}
        {(() => {
          // 找到连续已完成的最长前缀（包括今天之前已完成的）
          let lastCompletedIdx = -1
          for (let i = 0; i < days.length; i++) {
            if (days[i].isCompleted) lastCompletedIdx = i
            else if (days[i].isToday) { lastCompletedIdx = i; break }
            else break
          }
          if (lastCompletedIdx < 0) return null
          const pct = ((lastCompletedIdx) / (days.length - 1)) * 100
          return (
            <div
              className="absolute top-[11px] left-[calc(100%/14)] h-[2px] bg-[var(--ll-green)]"
              style={{ width: `${pct}%`, transition: 'width 600ms var(--ease-out)' }}
            />
          )
        })()}

        {/* 节点行 */}
        <div className="relative flex justify-between">
          {days.map((day, i) => (
            <div key={i} className="flex flex-col items-center gap-2.5" style={{ width: `${100 / days.length}%` }}>
              {/* 星期标签 */}
              <span className={`text-[10px] ${day.isToday ? 'text-[var(--ll-green)] font-semibold' : 'text-[var(--ll-text-3)]'}`}>
                {day.label}
              </span>
              {/* 节点圆点 */}
              <div className="relative flex items-center justify-center h-[22px]">
                {day.isCompleted && (
                  <span className="w-[10px] h-[10px] rounded-full bg-[var(--ll-green)] relative z-10" />
                )}
                {day.isToday && (
                  <span
                    className="w-[12px] h-[12px] rounded-full bg-[var(--ll-green)] relative z-10"
                    style={{ boxShadow: '0 0 0 4px rgba(0,117,74,.12), 0 0 0 8px rgba(0,117,74,.05)' }}
                  />
                )}
                {day.isFuture && (
                  <span className="w-[10px] h-[10px] rounded-full border-[1.5px] border-[var(--ll-text-3)] bg-[var(--ll-canvas)] relative z-10" />
                )}
              </div>
              {/* 任务目标文字 */}
              <span className={`text-[10px] leading-tight text-center ${
                day.isToday ? 'text-[var(--ll-green)] font-medium' : 'text-[var(--ll-text-3)]'
              }`}>
                {day.goalText}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** 待办事项计数 — 去卡片化，hairline separator + 可点击入口（Req 6.1, 6.2, 5.2） */
function PendingActionsCard({ count, storeId }: { count: number; storeId: string }) {
  return (
    <Link href={`/merchant/stores/${storeId}/task-center`} className="block">
      <section className="zen-reveal py-6 border-t border-[var(--ll-hair)] cursor-pointer active:bg-[var(--ll-ceramic)] rounded-[3px] transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ll-muted)]">
              <Pin className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm text-[var(--ll-text-2)]">待处理</p>
              <p className="text-xl font-bold text-[var(--ll-green)]">{count} 条</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-[var(--ll-muted)] text-[var(--ll-text-2)] border-[var(--ll-hair)]">
              需要拍摄
            </Badge>
            <ChevronRight className="h-4 w-4 text-[var(--ll-text-3)]" strokeWidth={1.5} />
          </div>
        </div>
      </section>
    </Link>
  )
}

/** 最佳视频区块 — 去卡片化，hairline separator（Req 6.1, 6.2, 5.2） */
function BestVideoCard({ variant, storeId }: { variant: BestVideoVariant | null; storeId: string }) {
  if (!variant) {
    // 无历史视频 → 使用 EmptyState 组件 + 流程提示（Req 3.1, 3.3, 15.6）
    return (
      <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
        <EmptyState
          illustration="video"
          title="开始你的第一条视频"
          description="完成今日拍摄任务，系统会自动帮你生成多个版本的短视频"
        />
        <div className="flex items-center justify-center gap-2 text-xs text-[var(--ll-green)] mt-2">
          <span className="inline-flex items-center gap-1"><Camera className="h-4 w-4" strokeWidth={1.5} />拍摄</span>
          <span className="text-[var(--ll-text-3)]">→</span>
          <span className="inline-flex items-center gap-1"><Sparkles className="h-4 w-4" strokeWidth={1.5} />生成</span>
          <span className="text-[var(--ll-text-3)]">→</span>
          <span className="inline-flex items-center gap-1"><Send className="h-4 w-4" strokeWidth={1.5} />发布</span>
        </div>
      </section>
    )
  }

  return (
    <section className="zen-reveal py-6 border-t border-[var(--ll-hair)]">
      <h3 className="font-[var(--font-serif)] text-[17px] font-semibold text-[var(--ll-text)] mb-4">最近成片</h3>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {/* 真实成片封面（私有 OSS 走 /api/media 代理）；无封面时走诚实中性占位，不伪造图 */}
          {variant.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={variant.coverUrl}
              alt={variant.title}
              className="flex-shrink-0 w-[72px] aspect-[9/16] rounded-[3px] object-cover bg-[var(--ll-ceramic)]"
            />
          ) : (
            <div className="flex-shrink-0 w-[72px] aspect-[9/16] rounded-[3px] bg-[var(--ll-ceramic)] flex items-center justify-center text-[var(--ll-text-3)]">
              <Film className="h-6 w-6" strokeWidth={1.5} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--ll-text)] truncate">{variant.title}</p>
            <p className="text-xs text-[var(--ll-text-3)] mt-1">
              {GOAL_LABELS[variant.type] || variant.type} · {formatDuration(variant.durationSec)}
            </p>
            {variant.views !== undefined && variant.views > 0 && (
              <div className="flex items-center gap-2 mt-2 text-xs text-[var(--ll-green)]">
                <span className="inline-flex items-center gap-1"><Eye className="h-4 w-4" strokeWidth={1.5} />{formatNumber(variant.views)} 播放</span>
              </div>
            )}
          </div>
        </div>

        {/* 成片导出 / 数据复盘 入口 — ZenButton ghost（Req 7.3） */}
        <div className="flex gap-2 pt-1">
          <Link href={`/merchant/stores/${storeId}/briefs/${variant.briefId}/variants`} className="flex-1">
            <ZenButton variant="ghost" fullWidth className="text-xs">查看成片</ZenButton>
          </Link>
          <Link href={`/merchant/stores/${storeId}/briefs/${variant.briefId}/metrics`} className="flex-1">
            <ZenButton variant="ghost" fullWidth className="text-xs">数据复盘</ZenButton>
          </Link>
        </div>
      </div>
    </section>
  )
}

/** 首次引导提示（Req 15.6 专用，无任何历史数据时展示）— 使用 EmptyState + ZenButton（Req 3.1, 3.3, 7.3） */
function FirstTimeGuide({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-4">
      <section className="zen-reveal py-8 border-t border-[var(--ll-hair)] text-center space-y-4">
        {/* EmptyState 空态插画：欢迎引导（Req 3.1, 3.3） */}
        <EmptyState
          illustration="upload"
          title="欢迎来到你的营销工作台"
          description="系统已为你准备好本周的内容计划，每天只需 3 步就能发布一条短视频"
        />
        <div className="grid grid-cols-3 gap-3 mt-4 max-w-sm mx-auto">
          <div className="text-center space-y-1">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--ll-muted)] flex items-center justify-center text-[var(--ll-green)]"><Camera className="h-5 w-5" strokeWidth={1.5} /></div>
            <p className="text-xs text-[var(--ll-text-2)]">按指引拍</p>
          </div>
          <div className="text-center space-y-1">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--ll-muted)] flex items-center justify-center text-[var(--ll-green)]"><Upload className="h-5 w-5" strokeWidth={1.5} /></div>
            <p className="text-xs text-[var(--ll-text-2)]">上传素材</p>
          </div>
          <div className="text-center space-y-1">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--ll-muted)] flex items-center justify-center text-[var(--ll-green)]"><Sparkles className="h-5 w-5" strokeWidth={1.5} /></div>
            <p className="text-xs text-[var(--ll-text-2)]">一键成片</p>
          </div>
        </div>
        <Link href={`/merchant/stores/${storeId}/calendar`}>
          <ZenButton variant="primary" className="mt-4">查看本周计划</ZenButton>
        </Link>
      </section>
    </div>
  )
}

// ========================
// 主页面
// ========================

export default function StoreHomePage() {
  const params = useParams()
  const storeId = params.storeId as string

  // 获取今日任务
  const { data: todayData, isLoading: todayLoading } = useSWR(
    storeId ? `/api/stores/${storeId}/today` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 获取当前内容计划
  const { data: planData, isLoading: planLoading } = useSWR(
    storeId ? `/api/stores/${storeId}/content-plan/current` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 获取订阅信息
  const { data: subData } = useSWR(
    '/api/merchant/subscription',
    fetcher,
    { revalidateOnFocus: false }
  )

  const isLoading = todayLoading || planLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    )
  }

  const todayBrief: TodayBrief | null = todayData?.brief || null
  const contentPlan = planData?.contentPlan || null
  const briefs: BriefSummary[] = contentPlan?.briefs || []

  // 计算待办数量：READY_TO_SHOOT 和 MATERIALS_UPLOADED 状态的 Brief 数
  const pendingCount = briefs.filter(
    (b: BriefSummary) => b.status === 'READY_TO_SHOOT' || b.status === 'MATERIALS_UPLOADED'
  ).length

  // 获取最佳视频（过去 14 天播放量最高的 VideoVariant）
  // 从 briefs 的 videoVariants 中查找
  const bestVariant = findBestVariant(briefs)
  const hasAnyVideo = briefs.some(
    (b: BriefSummary) => b.videoVariants && b.videoVariants.length > 0
  )

  // 无历史 VideoVariant → 首次引导
  if (!hasAnyVideo && !todayBrief && briefs.length === 0) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <FirstTimeGuide storeId={storeId} />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* 晨间问候 — 进入首页第一秒的仪式感 */}
      <MorningGreeting taskCount={todayBrief?.shotTasks.filter((s: ShotTask) => s.required && s.status !== 'CAPTURED').length ?? 0} />

      {/* 今日任务 */}
      <TodayTaskCard brief={todayBrief} />

      {/* 周计划概览 */}
      {briefs.length > 0 && <WeeklyCalendar briefs={briefs} />}

      {/* 待办事项 */}
      {pendingCount > 0 && <PendingActionsCard count={pendingCount} storeId={storeId} />}

      {/* 最佳视频 或 首次引导 */}
      <BestVideoCard variant={bestVariant} storeId={storeId} />

      {/* 我的成长入口（激励与留存，Req 11）—— 去卡片化（Req 6.1, 6.2, 5.2） */}
      <Link href={`/merchant/stores/${storeId}/growth`} className="block">
        <section className="zen-reveal py-6 border-t border-[var(--ll-hair)] cursor-pointer active:bg-[var(--ll-ceramic)] rounded-[3px] transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ll-muted)]">
                <Trophy className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--ll-text)]">我的成长</p>
                <p className="text-xs text-[var(--ll-text-3)]">连续创作 · 里程碑 · 效果对比</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-[var(--ll-text-3)]" strokeWidth={1.5} />
          </div>
        </section>
      </Link>

      {/* 会员等级与积分余额 — 去卡片化（Req 6.1, 6.2, 5.2）
          计费收敛（merchant-billing-unification task 6.6）后，/api/merchant/subscription
          返回 { tier, creditBalance, maxStores, ... }，不再有 label/quotas 字段。
          此处改为展示统一的会员等级 + 积分余额，点击进入会员与积分页（升级/充值）。 */}
      {subData && (
        <Link href={`/merchant/stores/${storeId}/membership`} className="block">
          <section className="zen-reveal py-6 border-t border-[var(--ll-hair)] cursor-pointer active:bg-[var(--ll-ceramic)] rounded-[3px] transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="border-[var(--ll-gold)] text-[var(--ll-gold-ink,#8A6D2F)] bg-[var(--ll-gold-lightest,#FAF6EE)] font-medium text-xs px-2.5 py-0.5">
                  {MEMBER_TIER_LABELS[subData.tier as string] ?? subData.tier}
                </Badge>
                <span className="text-xs text-[var(--ll-text-3)]">
                  门店上限 {subData.maxStores} 个
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-[var(--font-num)] text-sm font-semibold tabular-nums text-[var(--ll-text)]">
                  {subData.creditBalance ?? 0}
                </span>
                <span className="text-xs text-[var(--ll-text-3)]">积分</span>
                <ChevronRight className="h-4 w-4 text-[var(--ll-text-3)]" strokeWidth={1.5} />
              </div>
            </div>
          </section>
        </Link>
      )}
    </div>
  )
}

// ========================
// 工具函数与类型
// ========================

interface ShotTask {
  id: string
  order: number
  type: string
  title: string
  required: boolean
  status: string
}

interface TodayBrief {
  id: string
  title: string
  goal: string
  status: string
  scheduledDate: string
  shotTasks: ShotTask[]
  coverUrl?: string | null
}

interface VideoVariantSummary {
  id: string
  type: string
  title: string
  durationSec: number | null
  views?: number
  coverUrl?: string | null
}

interface BriefSummary {
  id: string
  title: string
  goal: string
  status: string
  scheduledDate: string
  shotTasks?: ShotTask[]
  videoVariants?: VideoVariantSummary[]
}

interface BestVideoVariant {
  id: string
  briefId: string
  type: string
  title: string
  durationSec: number | null
  views?: number
  coverUrl?: string | null
}

/** 从 briefs 中查找过去 14 天播放量最高的 VideoVariant（附带所属 briefId 以便跳转） */
function findBestVariant(briefs: BriefSummary[]): BestVideoVariant | null {
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  let best: BestVideoVariant | null = null
  let maxViews = -1

  for (const brief of briefs) {
    const briefDate = new Date(brief.scheduledDate)
    if (briefDate < fourteenDaysAgo) continue

    if (brief.videoVariants) {
      for (const variant of brief.videoVariants) {
        const views = variant.views ?? 0
        if (views > maxViews) {
          maxViews = views
          best = { ...variant, briefId: brief.id }
        }
      }
    }
  }

  // 如果没有 views 数据但有 videoVariant，返回第一个
  if (!best) {
    for (const brief of briefs) {
      if (brief.videoVariants && brief.videoVariants.length > 0) {
        best = { ...brief.videoVariants[0], briefId: brief.id }
        break
      }
    }
  }

  return best
}

/** 判断两个日期是否为同一天 */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

/** 格式化时长 */
function formatDuration(sec: number | null): string {
  if (!sec) return '--'
  if (sec < 60) return `${Math.round(sec)}秒`
  return `${Math.floor(sec / 60)}分${Math.round(sec % 60)}秒`
}

/** 格式化数字（千/万） */
function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`
  return String(n)
}
