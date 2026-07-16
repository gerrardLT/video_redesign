'use client'

/**
 * 今日任务独立页 — /merchant/stores/[storeId]/today
 *
 * 与 [storeId]/page.tsx 的 TodayTaskCard 内容相同但独立展开：
 * - 显示今日 ContentBrief 的完整 ShotTask 列表
 * - 每个 ShotTask 显示拍摄说明和进度
 * - 底部"开始上传"按钮跳转到 shoot 页
 *
 * 数据获取：useSWR('/api/stores/{storeId}/today')
 *
 * 溯源展示：内嵌 BriefProvenanceCard（需求 5.1/5.3/5.5/5.6），
 * 展示今日 brief 引用的门店画像依据，并提供仅对后续生效的画像调整入口。
 *
 * Requirements: 15.1, 5.1, 5.2, 5.3, 5.5, 5.6
 */

import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArrowLeft, Camera, CheckCircle, Circle, Clipboard, Lightbulb } from 'lucide-react'
import { BriefProvenanceCard, ZenButton } from '@/components/merchant'

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
// 类型
// ========================

interface ShotTask {
  id: string
  order: number
  type: string
  title: string
  instruction: string
  durationSec: number
  required: boolean
  status: string
  framingGuide: Record<string, unknown> | null
  rawAssets: Array<{ id: string; thumbnailKey: string | null; qualityScore: number | null }>
}

interface TodayBrief {
  id: string
  title: string
  goal: string
  status: string
  hook: string | null
  scheduledDate: string
  shotTasks: ShotTask[]
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
// 单个拍摄任务卡片
// ========================

/** 单个拍摄任务 — 带左侧竖线连接（像拍摄动线）+ 完成闪绿光晕 */
function ShotTaskItem({ task, isLast }: { task: ShotTask; isLast: boolean }) {
  const isCaptured = task.status === 'CAPTURED'
  const hasAssets = task.rawAssets && task.rawAssets.length > 0

  return (
    <div className="relative zen-reveal">
      {/* 左侧竖线（连接各步骤，最后一个不画线） */}
      {!isLast && (
        <span className="absolute left-[12px] top-[32px] bottom-0 w-[1px] bg-[var(--ll-hair)]" />
      )}

      <section
        className={`py-4 flex gap-3 transition-shadow duration-600 ${
          isCaptured ? 'animate-[zenGlow_0.6s_ease-out]' : ''
        }`}
      >
        {/* 状态圆点 */}
        <div className="flex-shrink-0 pt-0.5">
          {isCaptured ? (
            <CheckCircle className="h-6 w-6 text-[var(--ll-green)]" strokeWidth={1.5} />
          ) : (
            <Circle className="h-6 w-6 text-[var(--ll-text-3)]" strokeWidth={1.5} />
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-medium text-[var(--ll-text)]">
                镜头 {task.order}：{task.title}
              </h4>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-[var(--ll-text-3)]">时长 {task.durationSec}秒</span>
                {task.required ? (
                  <Badge variant="secondary" className="text-[10px]">
                    必拍
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] opacity-60">
                    选拍
                  </Badge>
                )}
              </div>
            </div>
            {hasAssets && (
              <Badge variant="secondary" className="text-[10px] bg-[var(--ll-green-light)] text-[var(--ll-green)]">
                已上传
              </Badge>
            )}
          </div>

          {/* 拍摄说明 */}
          <div className="p-3 rounded-[3px] bg-[var(--ll-ceramic)]">
            <p className="text-sm text-[var(--ll-text-2)] leading-relaxed">{task.instruction}</p>
            {task.framingGuide && (
              <div className="mt-2 text-[11px] text-[var(--ll-text-3)]">
                {(task.framingGuide as { tips?: string }).tips && (
                  <p className="flex items-center gap-1">
                    <Lightbulb className="h-3 w-3" strokeWidth={1.5} />
                    {(task.framingGuide as { tips: string }).tips}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ========================
// 主页面
// ========================

export default function TodayTaskPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = params.storeId as string

  const { data, isLoading, error } = useSWR(
    storeId ? `/api/stores/${storeId}/today` : null,
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
      <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-3">
        <p className="text-[var(--ll-text-2)]">{error.message || '加载失败'}</p>
        <Button variant="outline" onClick={() => router.back()} className="rounded-[var(--radius)]">
          返回
        </Button>
      </div>
    )
  }

  const brief: TodayBrief | null = data?.brief || null

  // 无今日任务
  if (!brief) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/merchant/stores/${storeId}`)}
            className="text-[var(--ll-text-2)]"
          >
            <ArrowLeft className="h-4 w-4 mr-1" strokeWidth={1.5} />
            返回
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
          <Clipboard className="h-10 w-10 text-[var(--ll-text-3)]" strokeWidth={1.5} />
          <h2 className="text-[var(--text-title)] font-semibold font-[var(--font-serif)]">今天没有安排任务</h2>
          <p className="text-sm text-[var(--ll-text-3)] text-center">
            去日历页查看本周计划，或生成新的内容计划
          </p>
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <ZenButton variant="primary">
              查看周计划
            </ZenButton>
          </Link>
        </div>
      </div>
    )
  }

  const shotTasks: ShotTask[] = brief.shotTasks || []
  const requiredTasks = shotTasks.filter(t => t.required)
  const capturedRequired = requiredTasks.filter(t => t.status === 'CAPTURED')
  const progress = requiredTasks.length > 0
    ? Math.round((capturedRequired.length / requiredTasks.length) * 100)
    : 0

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/merchant/stores/${storeId}`)}
          className="text-[var(--ll-text-2)]"
        >
          <ArrowLeft className="h-4 w-4 mr-1" strokeWidth={1.5} />
          返回
        </Button>
      </div>

      {/* 编辑式简报头 — 当日日期 + 任务数 + 预计时长 */}
      <section className="zen-reveal py-5 border-b border-[var(--ll-hair)]">
        <p className="text-[11px] tracking-[.08em] text-[var(--ll-text-3)] font-medium uppercase">
          {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="font-[var(--font-num)] text-2xl font-bold tabular-nums text-[var(--ll-text)]">
            {shotTasks.length}
          </span>
          <span className="text-sm text-[var(--ll-text-2)]">个镜头</span>
          <span className="text-[var(--ll-hair)]">·</span>
          <span className="text-sm text-[var(--ll-text-2)]">
            约 {Math.ceil(shotTasks.reduce((acc, t) => acc + t.durationSec, 0) / 60)} 分钟
          </span>
        </div>
      </section>

      {/* 今日任务 Hero */}
      <section className="py-6 zen-reveal">
        {/* Kicker 文字 + 绿发丝线 */}
        <div className="flex items-center gap-2 mb-3.5">
          <span className="w-6 h-[1.5px] bg-[var(--ll-green)]" />
          <span className="text-xs tracking-[.1em] text-[var(--ll-green)] font-medium">
            今日任务
          </span>
        </div>
        {/* 大标题 + 左侧绿色 border */}
        <h2 className="font-[var(--font-serif)] text-[var(--text-hero)] font-semibold leading-[1.38] pl-4 border-l-2 border-[var(--ll-green)]">
          {brief.title}
        </h2>
        <p className="mt-3 text-sm text-[var(--ll-text-2)]">
          目标：{GOAL_LABELS[brief.goal] || brief.goal}
        </p>
        {brief.hook && (
          <p className="mt-1 text-sm text-[var(--ll-text-3)] italic">
            开场钩子：{brief.hook}
          </p>
        )}

        {/* 拍摄进度 — 2px 细线 + Space Grotesk 数字 */}
        <div className="flex items-center gap-4 mt-5">
          <span className="font-[var(--font-num)] text-2xl font-semibold text-[var(--ll-green)] tabular-nums tracking-[-0.02em]">
            {capturedRequired.length}<small className="text-sm text-[var(--ll-text-3)] font-normal ml-0.5">/{requiredTasks.length}</small>
          </span>
          <div className="flex-1 h-[2px] bg-[var(--ll-hair)] rounded-[1px] relative">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--ll-green)] rounded-[1px]"
              style={{ width: `${progress}%`, transition: 'width 600ms var(--ease-out, cubic-bezier(.16,1,.3,1))' }}
            />
          </div>
        </div>
      </section>

      {/* 内容溯源展示 + 画像调整入口（需求 5.1/5.3/5.5/5.6） */}
      <BriefProvenanceCard storeId={storeId} briefId={brief.id} />

      {/* 拍摄任务列表 */}
      <div className="space-y-0">
        <h3 className="text-[var(--text-aux)] font-medium text-[var(--ll-text-3)] px-1 pb-2">
          拍摄列表（{shotTasks.length} 个镜头）
        </h3>
        {shotTasks.map((task, idx) => (
          <ShotTaskItem key={task.id} task={task} isLast={idx === shotTasks.length - 1} />
        ))}
      </div>

      {/* 底部操作按钮 — ZenButton */}
      <div className="sticky bottom-20 pt-4 pb-2">
        <Link href={`/merchant/stores/${storeId}/briefs/${brief.id}/shoot`}>
          <ZenButton variant="primary" fullWidth>
            <Camera className="h-5 w-5 mr-2" strokeWidth={1.5} />
            开始上传素材
          </ZenButton>
        </Link>
      </div>
    </div>
  )
}
