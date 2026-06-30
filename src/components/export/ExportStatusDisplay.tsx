'use client'

/**
 * 导出状态展示组件
 *
 * 覆盖四种导出状态的 UI 展示：
 * - MERGING：合并中 + 旋转进度动画
 * - UPSCALING：超分处理中 + 脉冲动画
 * - COMPLETED：视频预览播放器 + 下载按钮 + 分辨率标注
 * - FAILED：失败原因 + 已退还积分数 + 重试按钮
 *
 * 对应需求：Requirements 2.1, 2.2, 2.3
 */

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Download,
  RotateCcw,
} from 'lucide-react'

export type ExportStatus = 'MERGING' | 'UPSCALING' | 'COMPLETED' | 'FAILED'

interface ExportStatusDisplayProps {
  /** 当前导出状态 */
  status: ExportStatus
  /** 输出分辨率（如 "720p"、"1080p"） */
  resolution?: string
  /** 导出完成后的视频 URL */
  videoUrl?: string
  /** 失败时的错误信息 */
  errorMessage?: string
  /** 失败时已退还的积分数 */
  refundedCredits?: number
  /** 重试回调 */
  onRetry: () => void
}

export function ExportStatusDisplay({
  status,
  resolution,
  videoUrl,
  errorMessage,
  refundedCredits,
  onRetry,
}: ExportStatusDisplayProps) {
  return (
    <Card className="w-full">
      <CardContent className="p-6">
        {status === 'MERGING' && <MergingStatus />}
        {status === 'UPSCALING' && <UpscalingStatus resolution={resolution} />}
        {status === 'COMPLETED' && (
          <CompletedStatus resolution={resolution} videoUrl={videoUrl} />
        )}
        {status === 'FAILED' && (
          <FailedStatus
            errorMessage={errorMessage}
            refundedCredits={refundedCredits}
            onRetry={onRetry}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** 合并中状态：旋转图标 + 进度提示 */
function MergingStatus() {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative flex items-center justify-center h-14 w-14">
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
      <div className="text-center space-y-1">
        <p className="font-medium">视频合并中...</p>
        <p className="text-sm text-muted-foreground">
          正在将各分镜组视频拼接为完整视频
        </p>
      </div>
    </div>
  )
}

/** 超分处理中状态：脉冲动画 + 分辨率提示 */
function UpscalingStatus({ resolution }: { resolution?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative flex items-center justify-center h-14 w-14">
        <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20" />
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
      </div>
      <div className="text-center space-y-1">
        <p className="font-medium">超分处理中...</p>
        <p className="text-sm text-muted-foreground">
          正在将视频提升至 {resolution || '高清'} 分辨率
        </p>
      </div>
    </div>
  )
}

/** 导出完成状态：视频预览 + 下载按钮 + 分辨率标注 */
function CompletedStatus({
  resolution,
  videoUrl,
}: {
  resolution?: string
  videoUrl?: string
}) {
  return (
    <div className="space-y-4">
      {videoUrl && (
        <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
          <video
            src={videoUrl}
            controls
            className="w-full h-full object-contain"
            preload="metadata"
          />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <p className="font-medium text-green-500">导出完成</p>
          {resolution && (
            <span className="rounded-md bg-[var(--surface-3,#1f1f23)] px-2 py-0.5 text-xs text-[var(--ink-muted,#a1a1aa)]">
              {resolution}
            </span>
          )}
        </div>
        {videoUrl && (
          <a
            href={videoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold-2)]"
          >
            <Download className="h-4 w-4" />
            下载视频
          </a>
        )}
      </div>
    </div>
  )
}

/** 导出失败状态：错误信息 + 退还积分 + 重试按钮 */
function FailedStatus({
  errorMessage,
  refundedCredits,
  onRetry,
}: {
  errorMessage?: string
  refundedCredits?: number
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <XCircle className="h-7 w-7 text-destructive" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-destructive">导出失败</p>
        {errorMessage && (
          <p className="text-sm text-muted-foreground max-w-md">
            {errorMessage}
          </p>
        )}
        {refundedCredits != null && refundedCredits > 0 && (
          <p className="text-sm text-green-600">
            已退还 {refundedCredits} 积分
          </p>
        )}
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RotateCcw className="mr-2 h-4 w-4" />
        重试导出
      </Button>
    </div>
  )
}
