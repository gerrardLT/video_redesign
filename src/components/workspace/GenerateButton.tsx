'use client'

/**
 * 生成按钮组件（积分预估 + 生成 一体化）
 *
 * 设计参考即梦：左侧积分消耗数字 + 右侧生成图标
 * 合并为一个胶囊形按钮，高级感 + 信息密度。
 */

import { useCallback, useState, useEffect, useRef } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { estimateWorkspaceCost } from '@/lib/shared/credit-calc'
import { toast } from 'sonner'
import { cn } from '@/lib/shared/utils'
import type { WorkspaceGenerateRequest } from '@/types/workspace'

export function GenerateButton() {
  const prompt = useWorkspaceStore((s) => s.prompt)
  const model = useWorkspaceStore((s) => s.model)
  const aspectRatio = useWorkspaceStore((s) => s.aspectRatio)
  const duration = useWorkspaceStore((s) => s.duration)
  const resolution = useWorkspaceStore((s) => s.resolution)
  const assets = useWorkspaceStore((s) => s.assets)
  const creditBalance = useWorkspaceStore((s) => s.creditBalance)
  const generateStatus = useWorkspaceStore((s) => s.generateStatus)
  const setGenerateStatus = useWorkspaceStore((s) => s.setGenerateStatus)
  const setCurrentJobId = useWorkspaceStore((s) => s.setCurrentJobId)
  const setCurrentProjectId = useWorkspaceStore((s) => s.setCurrentProjectId)

  // 积分预估（300ms 防抖）
  const [displayCost, setDisplayCost] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDisplayCost(estimateWorkspaceCost(model, duration, resolution))
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [model, duration, resolution])

  const isInsufficient = creditBalance < displayCost
  const isDisabled = !prompt.trim() || isInsufficient || generateStatus === 'submitting'

  const handleGenerate = useCallback(async () => {
    if (isDisabled) return
    setGenerateStatus('submitting')

    const uploadedAssets = assets.filter((a) => a.status === 'uploaded' && a.ossUrl)
    const assetUrls = uploadedAssets.map((a) => a.ossUrl)
    const assetTypes: Record<string, 'image' | 'video' | 'audio'> = {}
    for (const asset of uploadedAssets) {
      assetTypes[asset.ossUrl] = asset.type
    }

    const requestBody: WorkspaceGenerateRequest = {
      prompt: prompt.trim(), model, aspectRatio, duration, resolution, assetUrls, assetTypes,
    }

    try {
      const res = await fetch('/api/workspace/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (res.status === 402) {
          toast.error(`积分不足，需要 ${errData.required || displayCost}，余额 ${errData.balance || creditBalance}`, {
            action: { label: '充值', onClick: () => window.location.href = '/dashboard/packages' },
          })
          setGenerateStatus('idle')
          return
        }
        if (res.status === 429) {
          toast.warning(errData.message || '生成任务排队中，请稍后')
          setGenerateStatus('idle')
          return
        }
        throw new Error(errData.message || errData.error || `请求失败 (${res.status})`)
      }

      const data = await res.json()
      setCurrentJobId(data.jobId)
      setCurrentProjectId(data.projectId)
      setGenerateStatus('generating')
      toast.success('生成中...')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败', {
        action: { label: '重试', onClick: () => handleGenerate() },
      })
      setGenerateStatus('idle')
    }
  }, [
    isDisabled, prompt, model, aspectRatio, duration, resolution,
    assets, creditBalance, displayCost,
    setGenerateStatus, setCurrentJobId, setCurrentProjectId,
  ])

  return (
    <button
      onClick={handleGenerate}
      disabled={isDisabled}
      className={cn(
        'group relative inline-flex items-center gap-2 h-8 pl-3 pr-3.5 rounded-full text-xs font-medium transition-all duration-200',
        'bg-gradient-to-r from-[var(--cine-gold)] to-[var(--cine-gold-2)]',
        'text-[var(--cine-bg)]',
        'hover:brightness-110 hover:shadow-[0_4px_16px_rgba(199,168,119,0.35)]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
        !isDisabled && 'animate-[gentle-pulse_3s_ease-in-out_infinite]'
      )}
      title={!prompt.trim() ? '请输入描述' : isInsufficient ? '积分不足' : `消耗 ${displayCost} 积分生成`}
    >
      {/* 积分消耗数字 */}
      <span className={cn(
        'tabular-nums transition-colors',
        isInsufficient && 'text-red-900'
      )}>
        {displayCost}
      </span>

      {/* 分隔线 */}
      <span className="w-px h-3.5 bg-[var(--cine-bg)]/20" />

      {/* 图标 */}
      {generateStatus === 'submitting' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Sparkles className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
      )}
    </button>
  )
}
