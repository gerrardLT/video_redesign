'use client'

/**
 * 模型选择组件（参数行内紧凑版）
 *
 * click 触发下拉，外部点击关闭。
 * 切换模型时联动更新 duration 和积分预估。
 */

import { useState, useRef, useEffect } from 'react'
import { Flame, Wand2 } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { MODEL_INFO } from '@/constants/workspace'
import { cn } from '@/lib/utils'
import type { WorkspaceModel } from '@/types/workspace'

/** 模型图标映射 */
function ModelIcon({ id, className }: { id: string; className?: string }) {
  if (id === 'seedance') return <Flame className={cn('w-3.5 h-3.5', className)} />
  return <Wand2 className={cn('w-3.5 h-3.5', className)} />
}

export function ModelSelector() {
  const model = useWorkspaceStore((s) => s.model)
  const setModel = useWorkspaceStore((s) => s.setModel)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentModel = MODEL_INFO.find((m) => m.id === model) || MODEL_INFO[0]

  // 外部点击关闭
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      {/* 当前选中模型 chip */}
      <div
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all border',
          'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] text-[var(--cine-gold)] font-medium'
        )}
      >
        <ModelIcon id={model} />
        {currentModel.name}
        <span className={cn('text-[10px] opacity-50 transition-transform', open && 'rotate-180')}>▾</span>
      </div>

      {/* 下拉列表 */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="w-56 rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-lg overflow-hidden p-1">
            {MODEL_INFO.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setModel(m.id as WorkspaceModel)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
                  model === m.id
                    ? 'bg-[var(--cine-gold-dim)] text-[var(--cine-gold)]'
                    : 'text-[var(--cine-text-2)] hover:bg-[var(--cine-line-2)]'
                )}
              >
                <ModelIcon id={m.id} className="text-base w-4 h-4" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{m.name}</div>
                  <div className="text-[10px] text-[var(--cine-text-3)] truncate">{m.badge}</div>
                </div>
                <span className="text-[10px] text-[var(--cine-text-3)] font-mono">{m.durationRange}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
