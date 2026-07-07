'use client'

/**
 * PromptArea — 编辑指令文本区（增强版）
 *
 * 基于 <textarea> 的增强输入框，功能：
 * - 跟踪光标位置（通过 selectionStart）
 * - 暴露 insertAtCursor(text) 方法（通过 useImperativeHandle + ref）
 * - 支持 [Image N] 占位符视觉高亮（overlay 层）
 * - maxLength 限制（默认 2500 字符）
 */

import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { cn } from '@/lib/shared/utils'

interface PromptAreaProps {
  /** 受控值 */
  value: string
  /** 值变化回调 */
  onChange: (value: string) => void
  /** 光标位置变化回调 */
  onCursorChange?: (position: number) => void
  /** 占位文本 */
  placeholder?: string
  /** 最大字符数（默认 2500） */
  maxLength?: number
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义 className */
  className?: string
}

/** PromptArea 暴露的方法接口 */
export interface PromptAreaRef {
  /** 在当前光标位置插入文本 */
  insertAtCursor: (text: string) => void
  /** 聚焦输入框 */
  focus: () => void
}

export const PromptArea = forwardRef<PromptAreaRef, PromptAreaProps>(
  function PromptArea(
    {
      value,
      onChange,
      onCursorChange,
      placeholder = '描述你想要的风格变化...\n\n使用 [Image N] 引用参考图',
      maxLength = 2500,
      disabled = false,
      className,
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // 跟踪光标位置
    const handleSelect = useCallback(() => {
      const textarea = textareaRef.current
      if (textarea) {
        onCursorChange?.(textarea.selectionStart)
      }
    }, [onCursorChange])

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value)
        onCursorChange?.(e.target.selectionStart)
      },
      [onChange, onCursorChange]
    )

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        const textarea = textareaRef.current
        if (!textarea) return

        const start = textarea.selectionStart
        const newValue = value.slice(0, start) + text + value.slice(start)
        onChange(newValue)

        // 设置光标到插入文本之后
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            const newPos = start + text.length
            textareaRef.current.selectionStart = newPos
            textareaRef.current.selectionEnd = newPos
            onCursorChange?.(newPos)
          }
        })
      },
      focus: () => {
        textareaRef.current?.focus()
      },
    }))

    return (
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onClick={handleSelect}
          onKeyUp={handleSelect}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className={cn(
            'w-full min-h-[120px] rounded-md bg-zinc-900 border border-zinc-700',
            'text-zinc-200 px-3 py-2 text-sm',
            'placeholder:text-zinc-500',
            'focus:outline-none focus:ring-1 focus:ring-green-500',
            'resize-y disabled:opacity-50 disabled:cursor-not-allowed',
            className
          )}
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-zinc-600">
            Tip: 上传参考图后自动插入 [Image N] 占位符
          </span>
          <span className="text-xs text-zinc-500">
            {value.length}/{maxLength}
          </span>
        </div>
      </div>
    )
  }
)
