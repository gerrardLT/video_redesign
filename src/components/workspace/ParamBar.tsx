'use client'

/**
 * 参数配置组件
 *
 * 比例选择（16:9/9:16/1:1）、分辨率固定 720P、
 * 时长根据模型动态渲染、数量固定 1 个。
 * click 触发下拉，外部点击关闭。
 */

import { useState, useRef, useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { getDurationOptions } from '@/lib/credit-calc'
import { cn } from '@/lib/utils'
import { Clock } from 'lucide-react'
import type { WorkspaceAspectRatio, WorkspaceResolution } from '@/types/workspace'

const ASPECT_RATIOS: WorkspaceAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const RESOLUTIONS: WorkspaceResolution[] = ['480p', '720p', '1080p']

export function ParamBar() {
  const model = useWorkspaceStore((s) => s.model)
  const aspectRatio = useWorkspaceStore((s) => s.aspectRatio)
  const duration = useWorkspaceStore((s) => s.duration)
  const resolution = useWorkspaceStore((s) => s.resolution)
  const setAspectRatio = useWorkspaceStore((s) => s.setAspectRatio)
  const setDuration = useWorkspaceStore((s) => s.setDuration)
  const setResolution = useWorkspaceStore((s) => s.setResolution)

  const durationOptions = getDurationOptions(model)

  return (
    <>
      {/* 比例 */}
      <Dropdown
        label={`⊞ ${aspectRatio}`}
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={(v) => setAspectRatio(v as WorkspaceAspectRatio)}
      />

      {/* 分辨率 */}
      <Dropdown
        label={resolution.toUpperCase()}
        options={RESOLUTIONS}
        value={resolution}
        onChange={(v) => setResolution(v as WorkspaceResolution)}
        renderOption={(v) => v.toUpperCase()}
      />

      {/* 时长 */}
      <Dropdown
        label={<><Clock className="w-3.5 h-3.5" />{duration}s</>}
        options={durationOptions.map(String)}
        value={String(duration)}
        onChange={(v) => setDuration(Number(v))}
        renderOption={(v) => `${v}s`}
      />
    </>
  )
}

/** 通用 click 下拉组件 */
function Dropdown({
  label,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: React.ReactNode
  options: string[]
  value: string
  onChange: (value: string) => void
  renderOption?: (value: string) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all border',
          'border-[var(--cine-line-2)] text-[var(--cine-text-2)] hover:border-[var(--cine-line)] hover:text-[var(--cine-text)]'
        )}
      >
        {label}
        <span className={cn('text-[10px] opacity-50 transition-transform', open && 'rotate-180')}>▾</span>
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-lg overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                className={cn(
                  'block w-full px-4 py-2 text-xs text-left hover:bg-[var(--cine-gold-dim)] transition-colors',
                  value === opt ? 'text-[var(--cine-gold)]' : 'text-[var(--cine-text-2)]'
                )}
              >
                {renderOption ? renderOption(opt) : opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ParamChip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-default transition-all border',
        active
          ? 'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] text-[var(--cine-gold)] font-medium'
          : 'border-[var(--cine-line-2)] text-[var(--cine-text-2)]'
      )}
    >
      {children}
    </div>
  )
}
