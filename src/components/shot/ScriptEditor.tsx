'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface ScriptEditorProps {
  groupId: string
  groupIndex: number
  initialScript: string | null
  onSaved: (newScript: string) => void
  open: boolean
  onClose: () => void
}

const MAX_SCRIPT_LENGTH = 10000

export function ScriptEditor({ groupId, groupIndex, initialScript, onSaved, open, onClose }: ScriptEditorProps) {
  const [script, setScript] = useState(initialScript || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // 同步外部 initialScript 变化
  useEffect(() => {
    setScript(initialScript || '')
  }, [initialScript])

  const charCount = script.length
  const isOverLimit = charCount > MAX_SCRIPT_LENGTH
  const hasChanges = script !== (initialScript || '')

  const handleSave = useCallback(async () => {
    if (isOverLimit) {
      setError('脚本内容不能超过10000个字符')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch(`/api/shot-groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineScript: script }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 400 && data.error?.includes('10000')) {
          setError('脚本内容不能超过10000个字符')
        } else if (res.status === 404) {
          setError('保存失败，请刷新页面重试')
        } else {
          setError(data.error || '保存失败，请重试')
        }
        return
      }

      setSuccess(true)
      onSaved(script)
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 1000)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }, [groupId, script, isOverLimit, onSaved, onClose])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-2xl mx-4 rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white">
            编辑脚本 — 第 {groupIndex + 1} 组
          </h3>
          <div className="flex items-center gap-3">
            <span className={`text-[11px] ${isOverLimit ? 'text-red-400' : 'text-[var(--cine-text-3)]'}`}>
              {charCount}/{MAX_SCRIPT_LENGTH}
            </span>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[var(--cine-text-3)] hover:text-white hover:bg-[var(--cine-surface)] transition-colors"
              aria-label="关闭"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* textarea */}
        <textarea
          value={script}
          onChange={(e) => {
            setScript(e.target.value)
            setError(null)
            setSuccess(false)
          }}
          placeholder="尚未生成脚本，首次生成时将自动合并组内分镜提示词"
          className="flex-1 min-h-[300px] w-full resize-y rounded-md border border-[var(--cine-line-2)] bg-black/30 p-3 text-sm text-[var(--cine-text)] placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]/30 font-mono leading-relaxed"
        />

        {/* 错误/成功提示 */}
        {error && (
          <p className="mt-2 text-[11px] text-red-400">{error}</p>
        )}
        {success && (
          <p className="mt-2 text-[11px] text-[var(--cine-green)]">保存成功</p>
        )}

        {/* 底部操作栏 */}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-[10px] text-[var(--cine-text-3)]">
            保存后，生成该组时将使用此脚本作为 prompt
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || isOverLimit || !hasChanges}
              className="bg-[var(--cine-gold)] text-white hover:bg-[var(--cine-gold-2)] disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存脚本'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
