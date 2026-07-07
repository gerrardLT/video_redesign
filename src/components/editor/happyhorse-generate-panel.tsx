'use client'

/**
 * HappyHorse V-Edit 生成面板（增强版）
 *
 * 完整面板组装：
 * TemplatePicker → PromptArea → ReferenceImageUploader →
 * CreditEstimator → 生成按钮 → ProgressIndicator → ResultPreview → HistoryList
 *
 * 连接 HappyHorseStore 状态到各组件，实现生成全流程。
 */

import { useCallback, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TemplatePicker } from '@/components/editor/template-picker'
import { PromptArea, type PromptAreaRef } from '@/components/editor/prompt-area'
import { ReferenceImageUploader } from '@/components/editor/reference-image-uploader'
import { CreditEstimator } from '@/components/editor/credit-estimator'
import { ProgressIndicator } from '@/components/editor/progress-indicator'
import { ResultPreview } from '@/components/editor/result-preview'
import { HistoryList, type HistoryRecord } from '@/components/editor/history-list'
import { useHappyHorseStore } from '@/stores/happyhorse-store'
import { insertPlaceholder } from '@/lib/shared/placeholder-utils'
import type { PromptTemplate } from '@/constants/prompt-templates'

interface HappyHorseGeneratePanelProps {
  /** 项目 ID */
  projectId: string
  /** 输入视频时长（秒） */
  videoDuration: number
  /** 原视频 URL（用于 Before/After 对比） */
  originalVideoUrl: string
  /** 是否禁用（如引擎切换中） */
  disabled?: boolean
}

export function HappyHorseGeneratePanel({
  projectId,
  videoDuration,
  originalVideoUrl,
  disabled = false,
}: HappyHorseGeneratePanelProps) {
  const promptAreaRef = useRef<PromptAreaRef>(null)
  const [insufficientBalance, setInsufficientBalance] = useState(false)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | undefined>()

  // Zustand store 状态
  const {
    prompt,
    referenceImages,
    isGenerating,
    currentTaskId,
    latestResult,
    setPrompt,
    setCursorPosition,
    addReferenceImage,
    removeReferenceImage,
    setGenerating,
    setLatestResult,
  } = useHappyHorseStore()

  // 模板选择回调
  const handleTemplateSelect = useCallback(
    (template: PromptTemplate) => {
      setPrompt(template.prompt)
      promptAreaRef.current?.focus()
    },
    [setPrompt]
  )

  // 参考图上传
  const handleUpload = useCallback(
    async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '上传失败')
      }

      const { url } = await response.json()
      return { url, thumbnailUrl: url }
    },
    []
  )

  // 添加参考图后自动插入占位符
  const handleImagesChange = useCallback(
    (images: typeof referenceImages) => {
      // 如果新增了图片（比当前多一张），插入占位符
      if (images.length > referenceImages.length) {
        const newIndex = images.length
        const cursorPos = useHappyHorseStore.getState().cursorPosition
        const currentPrompt = useHappyHorseStore.getState().prompt
        const newPrompt = insertPlaceholder(currentPrompt, cursorPos, newIndex)
        setPrompt(newPrompt)
      }

      // 更新 store 中的图片列表
      useHappyHorseStore.setState({ referenceImages: images })
    },
    [referenceImages.length, setPrompt]
  )

  // 移除参考图
  const handleRemoveImage = useCallback(
    (id: string) => {
      removeReferenceImage(id)
    },
    [removeReferenceImage]
  )

  // 发起生成
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error('请输入编辑指令')
      return
    }

    setGenerating(true)

    try {
      // 先上传所有本地参考图获取 URL
      const imageUrls = referenceImages
        .filter((img) => img.status === 'success')
        .map((img) => img.url)

      const response = await fetch(`/api/projects/${projectId}/generate-happyhorse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          referenceImages: imageUrls.length > 0 ? imageUrls : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 402) {
          toast.error(data.message || '积分不足，请充值后重试')
        } else {
          toast.error(data.error || '生成失败')
        }
        setGenerating(false)
        return
      }

      const result = await response.json()
      setLatestResult(result)

      // 设置任务 ID 用于进度追踪
      if (result.jobs && result.jobs.length > 0) {
        setGenerating(true, result.jobs[0].id)
      }

      toast.success('生成任务已创建')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '网络错误')
      setGenerating(false)
    }
  }, [prompt, referenceImages, projectId, setGenerating, setLatestResult])

  // 历史记录点击回放
  const handleSelectHistoryRecord = useCallback((record: HistoryRecord) => {
    if (record.videoUrl) {
      setPreviewVideoUrl(record.videoUrl)
    }
  }, [])

  // 生成完成后获取结果视频 URL
  const generatedVideoUrl = previewVideoUrl
    || (latestResult?.jobs?.[0] as { videoUrl?: string } | undefined)?.videoUrl

  // 判断是否展示进度
  const showProgress = isGenerating && currentTaskId

  return (
    <div className="p-4 space-y-5">
      {/* Prompt 模板选择器 */}
      <TemplatePicker
        onSelectTemplate={handleTemplateSelect}
        hasExistingContent={prompt.length > 0}
      />

      {/* Prompt 输入区域 */}
      <div>
        <label className="text-sm font-medium text-zinc-300 mb-1.5 block">
          编辑指令
        </label>
        <PromptArea
          ref={promptAreaRef}
          value={prompt}
          onChange={setPrompt}
          onCursorChange={setCursorPosition}
          disabled={disabled || isGenerating}
        />
      </div>

      {/* 参考图上传 */}
      <ReferenceImageUploader
        images={referenceImages}
        onImagesChange={handleImagesChange}
        onUpload={handleUpload}
        onRemove={handleRemoveImage}
        disabled={disabled || isGenerating}
      />

      {/* 积分预估 */}
      <CreditEstimator
        projectId={projectId}
        videoDuration={videoDuration}
        onInsufficientBalance={setInsufficientBalance}
      />

      {/* 生成按钮 */}
      <Button
        onClick={handleGenerate}
        disabled={disabled || isGenerating || !prompt.trim() || insufficientBalance}
        className="w-full bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
      >
        {isGenerating ? (
          <>生成中...</>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-1.5" />
            HappyHorse 生成
          </>
        )}
      </Button>

      {/* 生成进度 */}
      {showProgress && (
        <ProgressIndicator taskId={currentTaskId} />
      )}

      {/* 生成结果预览 */}
      {generatedVideoUrl && (
        <ResultPreview
          originalVideoUrl={originalVideoUrl}
          generatedVideoUrl={generatedVideoUrl}
        />
      )}

      {/* 历史记录 */}
      <HistoryList
        projectId={projectId}
        onSelectRecord={handleSelectHistoryRecord}
      />
    </div>
  )
}
