'use client'

/**
 * 拍摄上传页 — /merchant/stores/[storeId]/briefs/[briefId]/shoot
 *
 * 展示当前 ContentBrief 的所有拍摄任务（ShotTask），
 * 商家可逐个上传视频素材，查看质量检测结果，并在所有必拍镜头通过后触发视频生成。
 *
 * 功能：
 * - ShotTask 列表（按 order 排序），每个显示标题、说明、状态
 * - 每个 ShotTask 有上传按钮（file input accept="video/*"）
 * - 上传后显示质量检测结果（QualityReportBadge）
 * - 检测不通过显示具体失败原因 + 重新上传按钮
 * - 顶部显示整体进度（X/Y 个必拍镜头已完成）
 * - 底部 "生成视频" 按钮（仅所有必拍镜头 passed 时启用）
 * - 渲染中显示进度动画（复用 SSE 进度推送）
 *
 * API 调用：
 * - GET /api/content-briefs/{briefId}/shot-tasks
 * - POST /api/content-briefs/{briefId}/assets (FormData)
 * - DELETE /api/content-briefs/{briefId}/assets/{assetId}
 * - POST /api/content-briefs/{briefId}/render
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 6.7, 15.3, 15.4
 */

import { useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useSSEProgress } from '@/hooks/use-sse-progress'

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
  const { briefId } = params

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
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm py-4 border-b border-amber-100">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold text-gray-800">拍摄上传</h1>
          <span className="text-sm font-medium text-amber-600">
            {completedRequired.length}/{requiredTasks.length} 个必拍镜头
          </span>
        </div>
        <Progress value={progressPercent} className="h-2.5 bg-amber-100" />
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* 渲染中状态 */}
      {isRendering && <RenderingProgress progressMap={progressMap} briefId={briefId} />}

      {/* ShotTask 列表 */}
      {!isRendering && (
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

      {/* 底部生成按钮 */}
      {!isRendering && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-sm border-t border-amber-100">
          <div className="max-w-lg mx-auto">
            <Button
              className={cn(
                'w-full h-12 rounded-xl text-base font-bold transition-all',
                allRequiredPassed
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-200'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
              disabled={!allRequiredPassed || renderingState === 'submitting'}
              onClick={handleRender}
            >
              {renderingState === 'submitting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  提交中...
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
