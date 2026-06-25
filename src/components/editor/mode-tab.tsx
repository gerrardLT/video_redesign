'use client'

/**
 * ModeTab — Tab 切换控制器
 *
 * 渲染 Seedance / HappyHorse 两个引擎 Tab 标签页，
 * 实现面板的互斥显示（通过 display:none 保留 DOM 状态）。
 *
 * 功能：
 * - 每个 Tab 展示引擎图标、名称、功能简介和功能对比 Tag
 * - HappyHorse Tab 展示"推荐"角标
 * - 选中高亮 + 切换时调用后端 PATCH 接口 + 加载中禁用交互
 */

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface ModeTabProps {
  projectId: string
  currentEngine: 'seedance' | 'happyhorse'
  onEngineChange: (engine: 'seedance' | 'happyhorse') => void
  /** Seedance 面板内容 */
  seedancePanel: ReactNode
  /** HappyHorse 面板内容 */
  happyhorsePanel: ReactNode
}

/** 引擎 Tab 配置 */
const ENGINE_TABS = [
  {
    id: 'seedance' as const,
    name: 'Seedance 分镜模式',
    icon: '🎬',
    description: '基于分镜脚本逐组生成，适合脚本驱动的创作',
    tags: ['分镜脚本', '批量生成', '镜头衔接'],
    recommended: false,
  },
  {
    id: 'happyhorse' as const,
    name: 'HappyHorse 风格化模式',
    icon: '🐴',
    description: '一键风格化转换，支持真人脸保持',
    tags: ['支持真人脸', '风格化转换', '一键生成'],
    recommended: true,
  },
] as const

export function ModeTab({
  projectId,
  currentEngine,
  onEngineChange,
  seedancePanel,
  happyhorsePanel,
}: ModeTabProps) {
  const [activeEngine, setActiveEngine] = useState<'seedance' | 'happyhorse'>(currentEngine)
  const [isLoading, setIsLoading] = useState(false)

  const handleTabClick = async (engine: 'seedance' | 'happyhorse') => {
    if (engine === activeEngine || isLoading) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/engine`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine }),
      })

      if (!response.ok) {
        throw new Error('切换引擎失败')
      }

      setActiveEngine(engine)
      onEngineChange(engine)
    } catch {
      toast.error('切换失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab 标签栏 */}
      <div className="flex gap-2 p-2 border-b border-zinc-800">
        {ENGINE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            disabled={isLoading}
            className={cn(
              'relative flex-1 rounded-lg border p-3 text-left transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500',
              activeEngine === tab.id
                ? 'border-green-500/50 bg-green-500/5 ring-1 ring-green-500/20'
                : 'border-zinc-700/50 bg-zinc-900/50 hover:border-zinc-600',
              isLoading && 'opacity-60 cursor-not-allowed'
            )}
          >
            {/* 推荐角标 */}
            {tab.recommended && (
              <Badge variant="default" className="absolute -top-2 right-2 bg-green-600 text-[10px] px-1.5 py-0">
                推荐
              </Badge>
            )}

            {/* Tab 内容 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{tab.icon}</span>
              <span className={cn(
                'text-sm font-medium',
                activeEngine === tab.id ? 'text-green-400' : 'text-zinc-300'
              )}>
                {tab.name}
              </span>
            </div>

            <p className="text-xs text-zinc-500 mb-2">{tab.description}</p>

            {/* 功能对比 Tag */}
            <div className="flex flex-wrap gap-1">
              {tab.tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-block text-[10px] px-1.5 py-0.5 rounded-full',
                    activeEngine === tab.id
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* 加载状态 */}
            {isLoading && activeEngine !== tab.id && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 rounded-lg">
                <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* 面板内容区域（通过 display 控制显隐，保留 DOM 状态） */}
      <div className="flex-1 overflow-y-auto">
        <div style={{ display: activeEngine === 'seedance' ? 'block' : 'none' }}>
          {seedancePanel}
        </div>
        <div style={{ display: activeEngine === 'happyhorse' ? 'block' : 'none' }}>
          {happyhorsePanel}
        </div>
      </div>
    </div>
  )
}
