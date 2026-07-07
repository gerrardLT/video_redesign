'use client'

/**
 * TemplatePicker — Prompt 模板快捷选择器
 *
 * 以标签组（Tag Group）形式展示在 PromptArea 上方，
 * 点击时若 Prompt 已有内容则弹 AlertDialog 确认替换。
 */

import { useState } from 'react'
import { cn } from '@/lib/shared/utils'
import { PROMPT_TEMPLATES, type PromptTemplate } from '@/constants/prompt-templates'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface TemplatePickerProps {
  /** 模板选中回调 */
  onSelectTemplate: (template: PromptTemplate) => void
  /** 当前 Prompt 是否有内容（决定是否弹确认） */
  hasExistingContent: boolean
}

export function TemplatePicker({ onSelectTemplate, hasExistingContent }: TemplatePickerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<PromptTemplate | null>(null)

  const handleTemplateClick = (template: PromptTemplate) => {
    if (hasExistingContent) {
      // Prompt 已有内容，需要确认
      setPendingTemplate(template)
      setConfirmOpen(true)
    } else {
      // Prompt 为空，直接填入
      onSelectTemplate(template)
    }
  }

  const handleConfirm = () => {
    if (pendingTemplate) {
      onSelectTemplate(pendingTemplate)
    }
    setConfirmOpen(false)
    setPendingTemplate(null)
  }

  const handleCancel = () => {
    setConfirmOpen(false)
    setPendingTemplate(null)
  }

  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs text-zinc-500">快捷模板</label>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => handleTemplateClick(template)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs',
                'bg-zinc-800/80 border border-zinc-700/50 text-zinc-400',
                'hover:bg-zinc-700/80 hover:text-zinc-300 hover:border-zinc-600',
                'transition-all'
              )}
            >
              <span>{template.icon}</span>
              <span>{template.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 替换确认弹窗 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-200">替换当前内容？</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              当前 Prompt 已有内容，使用模板将替换全部现有文本。确定要使用「{pendingTemplate?.name}」模板吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel} className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700">
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className="bg-green-600 hover:bg-green-700 text-white">
              确认替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
