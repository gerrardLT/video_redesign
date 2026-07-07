'use client'

import { useRef, useCallback, useMemo } from 'react'
import { parseAssetReferences, validateReferences } from '@/lib/video/prompt-parser'

interface Asset {
  id: string
  url: string
  thumbUrl: string | null
  fileName: string | null
  isCharImage: boolean
  displayNum: number
}

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  assets: Asset[]
  onInsertAsset?: (displayNum: number) => void
  totalAssets: number
  onValidationChange?: (valid: boolean, errors: string[]) => void
}

export default function PromptEditor({
  value,
  onChange,
  assets,
  onInsertAsset,
  totalAssets,
  onValidationChange,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 解析当前引用
  const refs = useMemo(() => parseAssetReferences(value), [value])

  // 校验结果
  const validation = useMemo(() => {
    const result = validateReferences(refs, totalAssets)
    onValidationChange?.(result.valid, result.errors)
    return result
  }, [refs, totalAssets, onValidationChange])

  // 匹配引用的素材
  const referencedAssets = useMemo(() => {
    return refs
      .map((num) => assets.find((a) => a.displayNum === num))
      .filter((a): a is Asset => a !== undefined)
  }, [refs, assets])

  // 点击素材插入 [图N]
  const handleInsertAsset = useCallback((displayNum: number) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const insertText = `[图${displayNum}]`
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newValue = value.slice(0, start) + insertText + value.slice(end)

    onChange(newValue)
    onInsertAsset?.(displayNum)

    // 恢复光标位置
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = start + insertText.length
        textareaRef.current.selectionStart = newPos
        textareaRef.current.selectionEnd = newPos
        textareaRef.current.focus()
      }
    })
  }, [value, onChange, onInsertAsset])

  return (
    <div className="rounded-lg border border-[#222] bg-[var(--cine-surface)] p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-300">Prompt 编辑</h3>
        <span className="text-[11px] text-gray-500">
          已引用 {refs.length} 张素材
        </span>
      </div>

      {/* 文本输入区域 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-[#333] bg-[var(--cine-bg)] px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-[var(--cine-gold)] focus:outline-none resize-none"
        placeholder="输入分镜 prompt，点击下方素材可插入 [图N] 引用..."
        rows={6}
      />

      {/* 素材缩略图栏 */}
      {assets.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-gray-500 mb-1">点击素材插入引用：</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {assets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => handleInsertAsset(asset.displayNum)}
                className="relative flex-shrink-0 h-10 w-10 rounded border border-[#333] bg-[var(--cine-bg)] overflow-hidden hover:border-[var(--cine-gold)] transition-colors"
                title={`插入 [图${asset.displayNum}]`}
              >
                {asset.url ? (
                  <img
                    src={asset.thumbUrl || asset.url}
                    alt={asset.fileName || `图${asset.displayNum}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[8px] text-gray-500">
                    图{asset.displayNum}
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-center text-[8px] text-white font-mono">
                  {asset.displayNum}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 引用预览区域 - [图N] 高亮 */}
      {referencedAssets.length > 0 && (
        <div className="mt-2 border-t border-[#222] pt-2">
          <p className="text-[11px] text-gray-500 mb-1">引用的素材：</p>
          <div className="flex gap-1.5 flex-wrap">
            {referencedAssets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-1 rounded bg-[var(--cine-gold-dim)] border border-[var(--cine-gold)]/30 px-1.5 py-0.5"
              >
                {asset.url ? (
                  <img
                    src={asset.thumbUrl || asset.url}
                    alt={`图${asset.displayNum}`}
                    className="h-5 w-5 rounded object-cover"
                  />
                ) : (
                  <div className="h-5 w-5 rounded bg-[#333] flex items-center justify-center text-[8px] text-gray-400">
                    ?
                  </div>
                )}
                <span className="text-[10px] text-[var(--cine-gold)] font-mono">[图{asset.displayNum}]</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 校验错误提示 */}
      {!validation.valid && (
        <div className="mt-2 border-t border-red-900/30 pt-2">
          {validation.errors.map((err, i) => (
            <p key={i} className="text-[11px] text-red-400">
              ⚠ {err}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
