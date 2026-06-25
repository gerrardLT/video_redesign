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
 * Requirements: 15.1, 5.2
 */

import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArrowLeft, Camera, CheckCircle, Circle } from 'lucide-react'

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

// ========================
// 单个拍摄任务卡片
// ========================

function ShotTaskItem({ task }: { task: ShotTask }) {
  const isCaptured = task.status === 'CAPTURED'
  const hasAssets = task.rawAssets && task.rawAssets.length > 0

  return (
    <Card className={`rounded-2xl border transition-all ${
      isCaptured
        ? 'border-green-200 bg-green-50/50'
        : 'border-amber-100 bg-white'
    }`}>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {/* 完成状态 */}
            {isCaptured ? (
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" />
            )}
            <div>
              <h4 className="font-medium text-gray-800">
                镜头 {task.order}：{task.title}
              </h4>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">时长 {task.durationSec}秒</span>
                {task.required ? (
                  <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-600 border-orange-200 rounded-full">
                    必拍
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs bg-gray-50 text-gray-500 border-gray-200 rounded-full">
                    选拍
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* 素材状态 */}
          {hasAssets && (
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200 rounded-full">
              已上传
            </Badge>
          )}
        </div>

        {/* 拍摄说明 */}
        <div className="ml-7 p-3 bg-amber-50/50 rounded-xl">
          <p className="text-sm text-gray-700 leading-relaxed">{task.instruction}</p>
          {task.framingGuide && (
            <div className="mt-2 text-xs text-gray-500">
              {(task.framingGuide as { tips?: string }).tips && (
                <p>💡 {(task.framingGuide as { tips: string }).tips}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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
        <p className="text-gray-500">{error.message || '加载失败'}</p>
        <Button variant="outline" onClick={() => router.back()} className="rounded-xl">
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
            className="text-amber-700 hover:bg-amber-100 rounded-xl"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
          <div className="text-5xl">📋</div>
          <h2 className="text-lg font-semibold text-gray-800">今天没有安排任务</h2>
          <p className="text-sm text-gray-500 text-center">
            去日历页查看本周计划，或生成新的内容计划
          </p>
          <Link href={`/merchant/stores/${storeId}/calendar`}>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl">
              查看周计划
            </Button>
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
          className="text-amber-700 hover:bg-amber-100 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
      </div>

      {/* 今日任务标题 */}
      <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-800">
            <span>{GOAL_ICONS[brief.goal] || '📋'}</span>
            今日任务
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <h3 className="font-semibold text-gray-900 text-lg">{brief.title}</h3>
          <p className="text-sm text-gray-600">
            目标：{GOAL_LABELS[brief.goal] || brief.goal}
          </p>
          {brief.hook && (
            <p className="text-sm text-orange-700 italic">
              开场钩子：{brief.hook}
            </p>
          )}

          {/* 拍摄进度条 */}
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">必拍镜头进度</span>
              <span className="font-medium text-orange-700">
                {capturedRequired.length}/{requiredTasks.length}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-orange-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-orange-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 拍摄任务列表 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-500 px-1">
          拍摄列表（{shotTasks.length} 个镜头）
        </h3>
        {shotTasks.map((task) => (
          <ShotTaskItem key={task.id} task={task} />
        ))}
      </div>

      {/* 底部操作按钮 */}
      <div className="sticky bottom-20 pt-4 pb-2">
        <Link href={`/merchant/stores/${storeId}/briefs/${brief.id}/shoot`}>
          <Button className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white text-base font-medium rounded-2xl shadow-lg shadow-orange-200">
            <Camera className="h-5 w-5 mr-2" />
            开始上传素材
          </Button>
        </Link>
      </div>
    </div>
  )
}
