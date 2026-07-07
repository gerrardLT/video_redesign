'use client'

/**
 * 拍摄上传页 — /merchant/stores/[storeId]/briefs/[briefId]/shoot
 *
 * 展示当前 ContentBrief 的所有拍摄任务（ShotTask），
 * 商家可逐个上传视频素材，查看质量检测结果，并在所有必拍镜头通过后触发视频生成。
 *
 * 功能：
 * - ShotTask 列表（按 order 排序），每个显示标题、说明、状态
 * - 拍摄前可视化引导（需求 3.1, 3.2, 3.6）：竖屏构图框示意 + 关键要点清单，小白默认全展开
 * - 量化阈值通俗转述（需求 3.3）：用日常语言说明达标条件，不暴露技术术语
 * - 参考图对照（需求 3.5）：展示已生成参考图；可一键生成参考画面供对照（消耗积分）
 * - 每个 ShotTask 有上传按钮（file input accept="video/*"）
 * - 上传后显示质量检测结果（QualityReportBadge）
 * - 检测不通过显示具体失败原因 + 针对失败维度的重拍建议（需求 3.4）+ 重新上传按钮
 * - 顶部显示整体进度（X/Y 个必拍镜头已完成）
 * - 底部 "生成视频" 按钮（仅所有必拍镜头 passed 时启用）
 * - 渲染中显示进度动画（复用 SSE 进度推送）
 *
 * API 调用：
 * - GET /api/content-briefs/{briefId}/shot-tasks
 * - GET /api/shot-tasks/{shotTaskId}/guide（拍摄前可视化引导，不消耗积分）
 * - GET /api/shot-tasks/{shotTaskId}/reshoot-advice（质检失败重拍建议，不消耗积分）
 * - POST /api/shot-tasks/{shotTaskId}/reference-image（生成参考图，消耗积分）
 * - POST /api/content-briefs/{briefId}/assets (FormData)
 * - DELETE /api/content-briefs/{briefId}/assets/{assetId}
 * - POST /api/content-briefs/{briefId}/render
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.4, 5.5, 5.7, 6.7, 15.3, 15.4
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Video,
  Trash2,
  RefreshCw,
  Film,
  Smartphone,
  ListChecks,
  Lightbulb,
  ImageIcon,
  Sparkles,
  Camera,
  Mic,
  MicOff,
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useSSEProgress } from '@/hooks/use-sse-progress'
import { BriefProvenanceCard } from '@/components/merchant'

// ─── 类型定义 ───

interface QualityReport {
  orientation: { value: string; pass: boolean; message?: string }
  resolution: { value: string; pass: boolean; message?: string }
  duration: { value: number; pass: boolean; message?: string }
  fileSize: { value: number; pass: boolean; message?: string }
  brightness: { value: number; pass: boolean; message?: string }
  audio: { value: boolean; pass: boolean; message?: string }
}

interface RawAsset {
  id: string
  ossKey: string
  filename: string | null
  qualityScore: number | null
  qualityReport: QualityReport | null
  thumbnailKey: string | null
  durationSec: number | null
  createdAt: string
}

interface ShotTask {
  id: string
  order: number
  type: string
  title: string
  instruction: string
  durationSec: number
  required: boolean
  status: string
  rawAssets: RawAsset[]
}

interface ContentBrief {
  id: string
  title: string
  status: string
}

// ─── 拍摄引导相关类型（与 capture-director 服务层结构一致） ───

/** 拍摄前可视化引导（GET /api/shot-tasks/[id]/guide 响应中的 guide） */
interface CaptureGuide {
  /** 构图示意：竖屏框 + 主体位置 + 运镜 */
  framing: { aspect: '9:16'; subjectPosition: string; movement: string }
  /** 已生成的参考图/示例片段 URL */
  referenceUrls: string[]
  /** 关键要点清单（日常语言） */
  checklist: string[]
  /** 硬性质检阈值（量化），前端仅用 needsAudio 与时长区间做通俗呈现 */
  qualityThresholds: {
    aspectRatio: { target: number; tolerancePct: number }
    minShortSidePx: number
    durationSec: { min: number; max: number }
    minAvgBrightness: number
    needsAudio: boolean
  }
  /** 用通俗语言转述的达标条件（不暴露技术术语） */
  plainLanguageTips: string[]
}

/** 单条重拍建议（GET /api/shot-tasks/[id]/reshoot-advice 响应中的 advices 项） */
interface ReshootAdvice {
  dimension: 'orientation' | 'resolution' | 'duration' | 'brightness' | 'audio'
  failedValue: string
  advice: string
}

// ─── SWR Fetcher ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || '请求失败')
  }
  return res.json()
}

// ─── 质量检测维度的中文标签（日常用语，隐藏技术参数） ───

const QUALITY_DIMENSION_LABELS: Record<string, string> = {
  orientation: '竖屏拍摄',
  resolution: '画面清晰度',
  duration: '拍摄时长',
  fileSize: '文件大小',
  brightness: '光线亮度',
  audio: '声音录制',
}

// ─── 主页面组件 ───

export default function ShootUploadPage() {
  const params = useParams<{ storeId: string; briefId: string }>()
  const { storeId, briefId } = params

  // 获取 ShotTask 列表
  const {
    data: tasksData,
    error: tasksError,
    isLoading: tasksLoading,
    mutate: mutateTasks,
  } = useSWR<{ shotTasks: ShotTask[] }>(
    `/api/content-briefs/${briefId}/shot-tasks`,
    fetcher
  )

  // 获取 ContentBrief 状态（用于判断是否正在渲染）
  const {
    data: briefData,
    mutate: mutateBrief,
  } = useSWR<{ brief: ContentBrief }>(
    `/api/content-briefs/${briefId}`,
    fetcher
  )

  // SSE 进度推送
  const { progressMap } = useSSEProgress(briefId, true)

  // 上传状态
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null)
  const [renderingState, setRenderingState] = useState<'idle' | 'submitting' | 'rendering'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const shotTasks = tasksData?.shotTasks ?? []
  const briefStatus = briefData?.brief?.status ?? ''

  // 计算进度
  const requiredTasks = shotTasks.filter((t) => t.required)
  const completedRequired = requiredTasks.filter((t) => {
    const passedAsset = t.rawAssets.find(
      (a) => a.qualityScore !== null && a.qualityScore >= 60
    )
    return !!passedAsset
  })
  const progressPercent = requiredTasks.length > 0
    ? Math.round((completedRequired.length / requiredTasks.length) * 100)
    : 0
  const allRequiredPassed = requiredTasks.length > 0 && completedRequired.length === requiredTasks.length

  // 是否正在渲染
  const isRendering = briefStatus === 'RENDERING' || renderingState === 'rendering'

  // 渲染完成（视频已生成）：brief 进入生成后态，引导去成片导出页
  const GENERATED_STATUSES = ['GENERATED', 'COMPLIANCE_REVIEW', 'READY_TO_EXPORT', 'EXPORTED', 'PUBLISHED']
  const isGenerated = GENERATED_STATUSES.includes(briefStatus)

  // 渲染进行中时，监听 SSE 进度完成事件，及时刷新 brief 状态以翻转到「已生成」
  useEffect(() => {
    if (!isRendering) return
    const entry = progressMap.get(briefId)
    const done = entry?.eventType === 'completed' || (entry?.progress ?? 0) >= 100
    if (done) {
      void mutateBrief()
    }
  }, [isRendering, progressMap, briefId, mutateBrief])

  // ─── 上传素材 ───
  const handleUpload = useCallback(async (taskId: string, file: File) => {
    setUploadingTaskId(taskId)
    setErrorMessage(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('shotTaskId', taskId)

    try {
      const res = await fetch(`/api/content-briefs/${briefId}/assets`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data?.error?.message || '上传失败，请重试'
        setErrorMessage(msg)
        return
      }

      // 刷新列表
      await mutateTasks()
    } catch {
      setErrorMessage('网络异常，请检查后重试')
    } finally {
      setUploadingTaskId(null)
    }
  }, [briefId, mutateTasks])

  // ─── 删除素材 ───
  const handleDelete = useCallback(async (assetId: string) => {
    try {
      const res = await fetch(`/api/content-briefs/${briefId}/assets/${assetId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await mutateTasks()
      }
    } catch {
      setErrorMessage('删除失败，请重试')
    }
  }, [briefId, mutateTasks])

  // ─── 触发视频生成 ───
  const handleRender = useCallback(async () => {
    setRenderingState('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/content-briefs/${briefId}/render`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data?.error?.message || '生成失败')
        setRenderingState('idle')
        return
      }

      setRenderingState('rendering')
      await mutateBrief()
    } catch {
      setErrorMessage('网络异常，请重试')
      setRenderingState('idle')
    }
  }, [briefId, mutateBrief])

  // ─── 加载 / 错误状态 ───
  if (tasksLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-gray-500 text-sm">加载中...</p>
      </div>
    )
  }

  if (tasksError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <XCircle className="h-10 w-10 text-red-400" />
        <p className="text-red-500">{tasksError.message || '加载失败'}</p>
        <Button variant="outline" onClick={() => mutateTasks()}>重试</Button>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-32">
      {/* 顶部进度 */}
      <div className="sticky top-0 z-10 bg-[var(--ll-surface)]/95 backdrop-blur-sm py-4 border-b border-[var(--ll-hair)]">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold text-[var(--ll-text)]">拍摄上传</h1>
          <span className="text-sm font-medium text-[var(--ll-green)]">
            {completedRequired.length}/{requiredTasks.length} 个必拍镜头
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* 渲染中状态 */}
      {isRendering && <RenderingProgress progressMap={progressMap} briefId={briefId} />}

      {/* 内容溯源展示 + 画像调整入口（需求 5.1/5.3/5.5/5.6）：拍摄前知道为啥拍这条 */}
      {!isRendering && (
        <div className="mt-4">
          <BriefProvenanceCard storeId={storeId} briefId={briefId} />
        </div>
      )}

      {/* 渲染完成：引导去成片导出页（闭环后半段入口） */}
      {!isRendering && isGenerated && (
        <div className="mt-8 flex flex-col items-center gap-4 py-12">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800">视频已生成</h2>
          <p className="text-sm text-gray-500 text-center">
            已生成 3 个版本（促销/氛围/口播），去挑选并导出
          </p>
          <Link href={`/merchant/stores/${storeId}/briefs/${briefId}/variants`} className="w-full max-w-xs">
            <Button className="w-full h-12 rounded-xl text-base font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-200">
              <Film className="h-5 w-5 mr-2" />
              查看成片并导出
            </Button>
          </Link>
        </div>
      )}

      {/* ShotTask 列表 */}
      {!isRendering && !isGenerated && (
        <div className="mt-4 space-y-3">
          {shotTasks.map((task) => (
            <ShotTaskCard
              key={task.id}
              task={task}
              isUploading={uploadingTaskId === task.id}
              onUpload={handleUpload}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* 底部生成按钮 — 全部通过时脉冲发光，文案切换为「开始创作」 */}
      {!isRendering && !isGenerated && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-sm border-t border-[var(--ll-hair)]">
          <div className="max-w-lg mx-auto">
            <Button
              className={cn(
                'w-full h-12 rounded-xl text-base font-bold transition-all',
                allRequiredPassed
                  ? 'bg-[var(--ll-green)] hover:bg-[var(--ll-green)]/90 text-white shadow-lg shadow-[var(--ll-green)]/20'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
              style={allRequiredPassed ? { animation: 'zenPulse 2.4s ease-in-out infinite' } : undefined}
              disabled={!allRequiredPassed || renderingState === 'submitting'}
              onClick={handleRender}
            >
              {renderingState === 'submitting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  提交中...
                </>
              ) : allRequiredPassed ? (
                <>
                  <Sparkles className="h-5 w-5 mr-2" />
                  开始创作
                </>
              ) : (
                <>
                  <Video className="h-5 w-5 mr-2" />
                  生成视频
                </>
              )}
            </Button>
            {!allRequiredPassed && (
              <p className="text-center text-xs text-gray-400 mt-2">
                请先完成所有必拍镜头的上传
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 单个拍摄任务卡片 ───

interface ShotTaskCardProps {
  task: ShotTask
  isUploading: boolean
  onUpload: (taskId: string, file: File) => void
  onDelete: (assetId: string) => void
}

function ShotTaskCard({ task, isUploading, onUpload, onDelete }: ShotTaskCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 找到最新的合格素材
  const latestAsset = task.rawAssets[0] ?? null
  const isPassed = latestAsset && latestAsset.qualityScore !== null && latestAsset.qualityScore >= 60
  const isFailed = latestAsset && latestAsset.qualityScore !== null && latestAsset.qualityScore < 60

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onUpload(task.id, file)
      // 清空 input 以支持重复选择同一文件
      e.target.value = ''
    }
  }

  return (
    <Card className={cn(
      'p-4 rounded-2xl border-2 transition-all',
      isPassed && 'border-green-200 bg-green-50/50',
      isFailed && 'border-red-200 bg-red-50/50',
      !latestAsset && 'border-gray-100 bg-white',
    )}>
      {/* 头部：序号 + 标题 + 状态 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold',
            isPassed ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600',
          )}>
            {task.order}
          </span>
          <div>
            <h3 className="text-sm font-bold text-gray-800">
              {task.title}
              {task.required && (
                <span className="ml-1 text-xs text-red-500">*必拍</span>
              )}
              {!task.required && (
                <span className="ml-1 text-xs text-gray-400">选拍</span>
              )}
            </h3>
          </div>
        </div>
        {isPassed && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
        {isFailed && <XCircle className="h-5 w-5 text-red-400 flex-shrink-0" />}
      </div>

      {/* 拍摄说明 */}
      <p className="mt-2 text-sm text-gray-600 leading-relaxed pl-9">
        {task.instruction}
      </p>
      <p className="mt-1 text-xs text-gray-400 pl-9">
        建议时长 {task.durationSec} 秒
      </p>

      {/* 拍摄前可视化引导（小白默认全展开，需求 3.1/3.2/3.3/3.5/3.6） */}
      <div className="mt-3 pl-9">
        <CaptureGuidePanel shotTaskId={task.id} />
      </div>

      {/* 已上传素材 & 质量检测结果 */}
      {latestAsset && (
        <div className="mt-3 pl-9">
          {isPassed && (
            <div className="flex items-center gap-2">
              <QualityReportBadge score={latestAsset.qualityScore!} passed={true} />
              <button
                onClick={() => onDelete(latestAsset.id)}
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                删除
              </button>
            </div>
          )}

          {isFailed && (
            <div className="space-y-2">
              <QualityReportBadge score={latestAsset.qualityScore!} passed={false} />
              {/* 显示具体失败原因 */}
              {latestAsset.qualityReport && (
                <FailedDimensionsList report={latestAsset.qualityReport} />
              )}
              {/* 针对失败维度的具体重拍建议（需求 3.4，反哺下一次拍摄） */}
              <ReshootAdvicePanel shotTaskId={task.id} />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 rounded-lg border-amber-300 text-amber-600 hover:bg-amber-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  重新上传
                </Button>
                <button
                  onClick={() => onDelete(latestAsset.id)}
                  className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 上传按钮 */}
      {!latestAsset && (
        <div className="mt-3 pl-9">
          <Button
            size="sm"
            className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs h-8"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 mr-1" />
                上传视频
              </>
            )}
          </Button>
        </div>
      )}

      {/* 隐藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label={`上传${task.title}的视频`}
      />
    </Card>
  )
}

// ─── 质量检测结果徽章 ───

function QualityReportBadge({ score, passed }: { score: number; passed: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
    )}>
      {passed ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {passed ? '质量合格' : '质量不合格'}
      <span className="text-[10px] opacity-70">({score}分)</span>
    </span>
  )
}

// ─── 质量检测失败维度列表 ───

function FailedDimensionsList({ report }: { report: QualityReport }) {
  const failedDimensions = Object.entries(report).filter(
    ([, dim]) => !dim.pass
  )

  if (failedDimensions.length === 0) return null

  return (
    <div className="space-y-1">
      {failedDimensions.map(([key, dim]) => (
        <div key={key} className="flex items-center gap-1.5 text-xs text-red-600">
          <XCircle className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">{QUALITY_DIMENSION_LABELS[key] || key}：</span>
          <span className="text-red-500">{dim.message || '未达标'}</span>
        </div>
      ))}
    </div>
  )
}

// ─── 渲染进度组件 ───

function RenderingProgress({
  progressMap,
  briefId,
}: {
  progressMap: Map<string, { progress?: number; status?: string; message?: string }>
  briefId: string
}) {
  // 尝试从 SSE 进度获取当前渲染进度
  const progressEntry = progressMap.get(briefId)
  const progress = progressEntry?.progress ?? 0
  const statusMessage = progressEntry?.message ?? '正在生成视频...'

  return (
    <div className="mt-8 flex flex-col items-center gap-4 py-12">
      {/* 动画 */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-4 border-amber-200 animate-pulse" />
        <Video className="absolute inset-0 m-auto h-8 w-8 text-amber-500 animate-bounce" />
      </div>

      <h2 className="text-lg font-bold text-gray-800">视频生成中</h2>
      <p className="text-sm text-gray-500 text-center">{statusMessage}</p>

      {/* 进度条 */}
      <div className="w-full max-w-xs">
        <Progress value={progress} className="h-3 bg-amber-100" />
        <p className="text-center text-xs text-gray-400 mt-1">{progress}%</p>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        请耐心等待，通常需要 2-5 分钟
      </p>
    </div>
  )
}

// ─── 重拍建议维度的中文标签（日常用语） ───

const RESHOOT_DIMENSION_LABELS: Record<ReshootAdvice['dimension'], string> = {
  orientation: '竖屏拍摄',
  resolution: '画面清晰度',
  duration: '拍摄时长',
  brightness: '光线亮度',
  audio: '声音录制',
}

// ─── 拍摄前可视化引导面板 ───
//
// 拉取 GET /api/shot-tasks/[id]/guide，把构图/清单/通俗达标提示/参考图对照
// 一并展开呈现（小白默认全展开、不暴露技术术语）。

function CaptureGuidePanel({ shotTaskId }: { shotTaskId: string }) {
  const { data, error, isLoading, mutate } = useSWR<{ guide: CaptureGuide }>(
    `/api/shot-tasks/${shotTaskId}/guide`,
    fetcher
  )

  // 参考图生成状态
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // 本次会话内刚生成的参考图（接口仅返回 URL、未落库为 RawAsset，故本地暂存即时展示）
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([])

  const handleGenerateReference = useCallback(async () => {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch(`/api/shot-tasks/${shotTaskId}/reference-image`, {
        method: 'POST',
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 积分不足等显式提示，不静默
        const msg =
          result?.error?.code === 'INSUFFICIENT_CREDITS'
            ? '账户余额不足，充值后再生成参考图'
            : result?.error?.message || '参考图生成失败，请稍后再试'
        setGenError(msg)
        return
      }
      // 即时展示刚生成的参考图，并刷新引导以同步后端已落库的参考图
      if (typeof result?.referenceUrl === 'string' && result.referenceUrl) {
        setGeneratedUrls((prev) => [result.referenceUrl, ...prev])
      }
      await mutate()
    } catch {
      setGenError('网络异常，请稍后再试')
    } finally {
      setGenerating(false)
    }
  }, [shotTaskId, mutate])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在准备拍摄引导...
      </div>
    )
  }

  // 引导拉取失败时不阻断上传主流程，给出轻提示 + 重试
  if (error || !data?.guide) {
    return (
      <button
        onClick={() => mutate()}
        className="text-xs text-gray-400 hover:text-amber-600 flex items-center gap-1 py-2 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        拍摄引导加载失败，点此重试
      </button>
    )
  }

  const guide = data.guide
  // 合并后端已落库的参考图与本次会话刚生成的参考图（去重）
  const referenceUrls = Array.from(new Set([...generatedUrls, ...guide.referenceUrls]))

  return (
    <div className="rounded-xl bg-amber-50/60 border border-amber-100 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
        <Camera className="h-3.5 w-3.5" />
        拍之前先看这里
      </div>

      {/* 构图示意 + 参考图对照 */}
      <div className="flex gap-3">
        <VerticalFramePreview subjectPosition={guide.framing.subjectPosition} />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-[11px] leading-relaxed text-gray-600">
            <span className="font-medium text-gray-700">画面这样摆：</span>
            {guide.framing.subjectPosition}
          </div>
          <div className="text-[11px] leading-relaxed text-gray-600">
            <span className="font-medium text-gray-700">镜头怎么动：</span>
            {guide.framing.movement}
          </div>
          {/* 是否需要录声音（通俗呈现，不暴露「音轨」术语） */}
          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            {guide.qualityThresholds.needsAudio ? (
              <>
                <Mic className="h-3 w-3 text-amber-600" />
                这个镜头要把说话声录清楚
              </>
            ) : (
              <>
                <MicOff className="h-3 w-3 text-gray-400" />
                这个镜头不录声音也行
              </>
            )}
          </div>
        </div>
      </div>

      {/* 参考图对照（需求 3.5） */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
          <ImageIcon className="h-3.5 w-3.5 text-amber-600" />
          参考画面对照
        </div>
        {referenceUrls.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {referenceUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt="拍摄参考画面"
                className="aspect-[9/16] w-full rounded-lg object-cover border border-amber-100 bg-white"
              />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">
            还没有参考画面，点下面按钮生成一张照着拍就行
          </p>
        )}

        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 rounded-lg border-amber-300 text-amber-600 hover:bg-amber-50"
          onClick={handleGenerateReference}
          disabled={generating}
        >
          {generating ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              {referenceUrls.length > 0 ? '再生成一张参考图' : '生成参考图'}
            </>
          )}
        </Button>
        {genError && <p className="text-[11px] text-red-500">{genError}</p>}
      </div>

      {/* 关键要点清单 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
          <ListChecks className="h-3.5 w-3.5 text-amber-600" />
          照着这几条拍
        </div>
        <ul className="space-y-1">
          {guide.checklist.map((item, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-[11px] text-gray-600 leading-relaxed">
              <CheckCircle2 className="h-3 w-3 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 通俗达标提示（量化阈值的日常语言转述，不暴露技术术语） */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
          <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
          这样拍才算合格
        </div>
        <ul className="space-y-1">
          {guide.plainLanguageTips.map((tip, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-[11px] text-gray-500 leading-relaxed">
              <span className="text-amber-400 flex-shrink-0">·</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ─── 竖屏构图框示意（9:16） ───
//
// 用纯 CSS 绘制竖屏框 + 三分构图参考线 + 主体位置标记，
// 让小白老板拍之前直观看到画面该怎么摆。

function VerticalFramePreview({ subjectPosition }: { subjectPosition: string }) {
  return (
    <div className="flex-shrink-0">
      <div className="relative aspect-[9/16] w-20 rounded-lg border-2 border-amber-300 bg-gradient-to-b from-amber-100/40 to-amber-50 overflow-hidden">
        {/* 三分构图参考线 */}
        <div className="absolute inset-0">
          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-amber-200/70" />
          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-amber-200/70" />
          <div className="absolute top-1/3 left-0 right-0 h-px bg-amber-200/70" />
          <div className="absolute top-2/3 left-0 right-0 h-px bg-amber-200/70" />
        </div>
        {/* 主体位置标记（画面中心） */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className="h-6 w-6 rounded-full border-2 border-dashed border-amber-500/80 flex items-center justify-center">
              <Camera className="h-3 w-3 text-amber-500" />
            </div>
            <span className="text-[8px] text-amber-600 font-medium">主体</span>
          </div>
        </div>
        {/* 竖屏标识 */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[7px] text-amber-500 font-medium">
          <Smartphone className="h-2.5 w-2.5" />
          竖屏
        </div>
      </div>
      <p className="mt-1 text-center text-[8px] text-gray-400 w-20 leading-tight" title={subjectPosition}>
        手机竖着拍
      </p>
    </div>
  )
}

// ─── 质检失败后的重拍建议面板 ───
//
// 拉取 GET /api/shot-tasks/[id]/reshoot-advice，仅针对未通过维度展示具体重拍话术。
// 无质检结果时如实提示，不伪造建议。

function ReshootAdvicePanel({ shotTaskId }: { shotTaskId: string }) {
  const { data, isLoading } = useSWR<
    | { hasReport: true; advices: ReshootAdvice[] }
    | { hasReport: false; message: string }
  >(`/api/shot-tasks/${shotTaskId}/reshoot-advice`, fetcher)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-gray-400 py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        正在分析怎么重拍...
      </div>
    )
  }

  if (!data) return null

  // 无质检结果：如实提示，不伪造
  if (!data.hasReport) {
    return <p className="text-[11px] text-gray-400">{data.message}</p>
  }

  if (data.advices.length === 0) return null

  return (
    <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-bold text-orange-700">
        <Lightbulb className="h-3.5 w-3.5" />
        这样重拍就能过
      </div>
      <ul className="space-y-1.5">
        {data.advices.map((adv) => (
          <li key={adv.dimension} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <span className="flex-shrink-0 rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
              {RESHOOT_DIMENSION_LABELS[adv.dimension]}
            </span>
            <span className="text-gray-600">{adv.advice}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
