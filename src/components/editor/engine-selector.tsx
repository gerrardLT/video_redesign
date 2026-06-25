'use client'

/**
 * 引擎选择组件
 * 在项目编辑器中显示引擎选择 UI（单选切换）
 * - Seedance 2.0：标注"不支持真人脸（会被审核拦截）"
 * - HappyHorse：标注"支持真人脸"
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface EngineSelectorProps {
  projectId: string
  currentEngine: 'seedance' | 'happyhorse'
  onEngineChange?: (engine: 'seedance' | 'happyhorse') => void
  disabled?: boolean
}

export function EngineSelector({
  projectId,
  currentEngine,
  onEngineChange,
  disabled = false,
}: EngineSelectorProps) {
  const [engine, setEngine] = useState<'seedance' | 'happyhorse'>(currentEngine)
  const [isLoading, setIsLoading] = useState(false)

  const handleEngineSwitch = async (newEngine: 'seedance' | 'happyhorse') => {
    if (newEngine === engine || disabled) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/engine`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: newEngine }),
      })

      if (!response.ok) {
        throw new Error('切换引擎失败')
      }

      setEngine(newEngine)
      onEngineChange?.(newEngine)
    } catch (error) {
      console.error('切换引擎失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleEngineSwitch('seedance')}
        disabled={disabled || isLoading}
        className={cn(
          'flex-1 px-3 py-2 rounded-lg border text-sm transition-all',
          engine === 'seedance'
            ? 'border-blue-500 bg-blue-500/10 text-blue-400'
            : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
        )}
      >
        <div className="font-medium">Seedance 2.0</div>
        <div className="text-xs mt-0.5 opacity-70">不支持真人脸（会被审核拦截）</div>
      </button>

      <button
        onClick={() => handleEngineSwitch('happyhorse')}
        disabled={disabled || isLoading}
        className={cn(
          'flex-1 px-3 py-2 rounded-lg border text-sm transition-all',
          engine === 'happyhorse'
            ? 'border-green-500 bg-green-500/10 text-green-400'
            : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
        )}
      >
        <div className="font-medium">HappyHorse</div>
        <div className="text-xs mt-0.5 opacity-70">支持真人脸</div>
      </button>
    </div>
  )
}
