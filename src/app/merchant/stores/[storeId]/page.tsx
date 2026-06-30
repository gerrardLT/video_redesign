'use client'

/**
 * 门店首页 — /merchant/stores/[storeId]
 *
 * 商家每日进入的第一个页面，展示：
 * - 今日任务卡片（TodayTaskCard）
 * - 周计划概览（WeeklyCalendar）
 * - 待办事项数量
 * - 最佳视频卡片（过去 14 天播放量最高的 VideoVariant）
 * - 无历史视频时显示首次任务引导提示（Req 15.6）
 *
 * 数据获取：
 * - useSWR('/api/stores/{storeId}/today')
 * - useSWR('/api/stores/{storeId}/content-plan/current')
 * - useSWR('/api/merchant/subscription')
 *
 * Requirements: 15.1, 15.6
 */

import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Film, CheckCircle2, Circle, Camera, Upload, Sparkles, Send, Clapperboard } from 'lucide-react'
import Link from 'next/link'

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

/** UserTier → 会员等级中文名（计费收敛后统一等级，merchant-billing-unification） */
const MEMBER_TIER_LABELS: Record<string, string> = {
  FREE: '免费版',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}

// ========================
// 组件
// ========================

/** 今日任务卡片 */
function TodayTaskCard({ brief }: { brief: TodayBrief | null }) {
  const params = useParams()
  const storeId = params.storeId as string

  if (!brief) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader>
          <CardTitle className="text-amber-800">今日任务</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-amber-700">今天没有安排任务</p>
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <Button variant="outline" className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100">
              查看周计划
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  // 计算拍摄进度
  const requiredShots = brief.shotTasks.filter((s: ShotTask) => s.required)
  const capturedShots = requiredShots.filter((s: ShotTask) => s.status === 'CAPTURED')
  const progress = requiredShots.length > 0
    ? Math.round((capturedShots.length / requiredShots.length) * 100)
    : 0

  return (
    <Card className="overflow-hidden border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
      {/* 今日任务封面：已拍镜头的真实缩略图帧；未拍摄时不显示（不伪造菜品图） */}
      {brief.coverUrl && (
        <div className="aspect-[16/9] w-full overflow-hidden bg-[var(--ll-ceramic)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brief.coverUrl} alt={brief.title} className="h-full w-full object-cover" />
        </div>
      )}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-800">
          <span>{GOAL_ICONS[brief.goal] || '📋'}</span>
          今日任务
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h3 className="font-medium text-gray-900">{brief.title}</h3>
          <p className="text-sm text-gray-600 mt-1">
            目标：{GOAL_LABELS[brief.goal] || brief.goal}
          </p>
        </div>

        {/* 拍摄进度 */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">拍摄进度</span>
            <span className="font-medium text-orange-700">
              {capturedShots.length}/{requiredShots.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-orange-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <Link href={`/merchant/stores/${storeId}/briefs/${brief.id}/shoot`}>
          <Button className="w-full mt-2 bg-orange-600 hover:bg-orange-700 text-white">
            开始拍摄
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}

/** 周计划概览 — 7 天横条 */
function WeeklyCalendar({ briefs }: { briefs: BriefSummary[] }) {
  const params = useParams()
  const storeId = params.storeId as string

  // 构建 7 天数据，用 brief 的 scheduledDate 匹配
  const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

  return (
    <Card className="border-amber-100">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-gray-800">本周计划</CardTitle>
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <Button variant="outline" size="sm" className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50">
              查看详情
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1.5">
          {briefs.slice(0, 7).map((brief, idx) => {
            const isCompleted = ['GENERATED', 'READY_TO_EXPORT', 'EXPORTED', 'PUBLISHED'].includes(brief.status)
            const isToday = isSameDay(new Date(brief.scheduledDate), new Date())

            return (
              <div
                key={brief.id}
                className={`flex-1 flex flex-col items-center gap-1 rounded-lg p-2 text-center transition-all
                  ${isToday ? 'bg-orange-100 ring-2 ring-orange-300' : 'bg-gray-50'}
                  ${isCompleted ? 'opacity-60' : ''}
                `}
              >
                <span className="text-[10px] text-gray-500">{weekDays[idx] || `第${idx + 1}天`}</span>
                <span className="text-lg">{GOAL_ICONS[brief.goal] || '📋'}</span>
                {isCompleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-gray-300" />
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/** 待办事项计数 */
function PendingActionsCard({ count }: { count: number }) {
  return (
    <Card className="border-amber-100">
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
            <span className="text-lg">📌</span>
          </div>
          <div>
            <p className="text-sm text-gray-600">待处理</p>
            <p className="text-xl font-bold text-orange-700">{count} 条</p>
          </div>
        </div>
        <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200">
          需要拍摄
        </Badge>
      </CardContent>
    </Card>
  )
}

/** 最佳视频卡片 */
function BestVideoCard({ variant, storeId }: { variant: BestVideoVariant | null; storeId: string }) {
  if (!variant) {
    // 无历史视频 → 首次任务引导提示（Req 15.6）
    return (
      <Card className="border-[var(--ll-hair)] bg-[var(--ll-surface)]">
        <CardContent className="py-6 text-center space-y-3">
          <div className="flex justify-center text-[var(--ll-green)]"><Film className="h-9 w-9" /></div>
          <h3 className="font-medium text-gray-800">开始你的第一条视频</h3>
          <p className="text-sm text-gray-600">
            完成今日拍摄任务，系统会自动帮你生成多个版本的短视频
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--ll-green-sb)]">
            <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />拍摄</span>
            <span className="text-[var(--ll-text-3)]">→</span>
            <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />生成</span>
            <span className="text-[var(--ll-text-3)]">→</span>
            <span className="inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" />发布</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-100 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm text-gray-600">最近成片</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          {/* 真实成片封面（私有 OSS 走 /api/media 代理）；无封面时走诚实中性占位，不伪造图 */}
          {variant.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={variant.coverUrl}
              alt={variant.title}
              className="flex-shrink-0 w-16 h-20 rounded-lg object-cover bg-[var(--ll-ceramic)]"
            />
          ) : (
            <div className="flex-shrink-0 w-16 h-20 rounded-lg bg-[var(--ll-ceramic)] flex items-center justify-center text-[var(--ll-text-3)]">
              <Film className="h-6 w-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800 truncate">{variant.title}</p>
            <p className="text-xs text-gray-500 mt-1">
              {GOAL_LABELS[variant.type] || variant.type} · {formatDuration(variant.durationSec)}
            </p>
            {variant.views !== undefined && variant.views > 0 && (
              <div className="flex items-center gap-2 mt-2 text-xs text-orange-600">
                <span>👁️ {formatNumber(variant.views)} 播放</span>
              </div>
            )}
          </div>
        </div>

        {/* 成片导出 / 数据复盘 入口（接通孤儿页） */}
        <div className="flex gap-2 pt-1">
          <Link href={`/merchant/stores/${storeId}/briefs/${variant.briefId}/variants`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-amber-200 text-amber-700 hover:bg-amber-50">
              查看成片
            </Button>
          </Link>
          <Link href={`/merchant/stores/${storeId}/briefs/${variant.briefId}/metrics`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-green-200 text-green-700 hover:bg-green-50">
              数据复盘
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/** 首次引导提示（Req 15.6 专用，无任何历史数据时展示） */
function FirstTimeGuide({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-4">
      <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-yellow-50">
        <CardContent className="py-8 text-center space-y-4">
          <div className="flex justify-center text-[var(--ll-green)]"><Clapperboard className="h-12 w-12" /></div>
          <h2 className="text-lg font-bold text-gray-800">欢迎来到你的营销工作台</h2>
          <p className="text-sm text-gray-600 max-w-xs mx-auto">
            系统已为你准备好本周的内容计划，每天只需 3 步就能发布一条短视频
          </p>
          <div className="grid grid-cols-3 gap-3 mt-4 max-w-sm mx-auto">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 mx-auto rounded-full bg-orange-100 flex items-center justify-center text-[var(--ll-green-sb)]"><Camera className="h-5 w-5" /></div>
              <p className="text-xs text-gray-600">按指引拍</p>
            </div>
            <div className="text-center space-y-1">
              <div className="w-10 h-10 mx-auto rounded-full bg-orange-100 flex items-center justify-center text-[var(--ll-green-sb)]"><Upload className="h-5 w-5" /></div>
              <p className="text-xs text-gray-600">上传素材</p>
            </div>
            <div className="text-center space-y-1">
              <div className="w-10 h-10 mx-auto rounded-full bg-orange-100 flex items-center justify-center text-[var(--ll-green-sb)]"><Sparkles className="h-5 w-5" /></div>
              <p className="text-xs text-gray-600">一键成片</p>
            </div>
          </div>
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <Button className="mt-4 bg-orange-600 hover:bg-orange-700 text-white">
              查看本周计划
            </Button>
          </Link>
        </CardContent>
      </Card>
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
      {/* 今日任务 */}
      <TodayTaskCard brief={todayBrief} />

      {/* 周计划概览 */}
      {briefs.length > 0 && <WeeklyCalendar briefs={briefs} />}

      {/* 待办事项 */}
      {pendingCount > 0 && <PendingActionsCard count={pendingCount} />}

      {/* 最佳视频 或 首次引导 */}
      <BestVideoCard variant={bestVariant} storeId={storeId} />

      {/* 我的成长入口（激励与留存，Req 11）—— 连续创作 / 里程碑 / 效果对比 / 进阶引导 */}
      <Link href={`/merchant/stores/${storeId}/growth`} className="block">
        <Card className="border-amber-100 hover:border-amber-200 transition-all cursor-pointer">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <span className="text-lg">🏆</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">我的成长</p>
                <p className="text-xs text-gray-500">连续创作 · 里程碑 · 效果对比</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">查看 ›</span>
          </CardContent>
        </Card>
      </Link>

      {/* 会员等级与积分余额提示
          计费收敛（merchant-billing-unification task 6.6）后，/api/merchant/subscription
          返回 { tier, creditBalance, maxStores, ... }，不再有 label/quotas 字段。
          此处改为展示统一的会员等级 + 积分余额，点击进入会员与积分页（升级/充值）。 */}
      {subData && (
        <Link href={`/merchant/stores/${storeId}/membership`} className="block">
          <Card className="border-gray-100 hover:border-amber-200 transition-all cursor-pointer">
            <CardContent className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-500">
                {MEMBER_TIER_LABELS[subData.tier as string] ?? subData.tier} · 门店上限 {subData.maxStores} 个
              </span>
              <span className="text-xs text-gray-400">
                积分余额 {subData.creditBalance ?? 0} ›
              </span>
            </CardContent>
          </Card>
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
