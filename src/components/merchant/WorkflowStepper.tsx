'use client'

/**
 * WorkflowStepper — 5 步线性工作流指示器
 *
 * 步骤：[1.看任务] → [2.拍摄] → [3.上传] → [4.生成] → [5.导出]
 * - 当前步骤高亮（暖橙色）
 * - 已完成步骤显示打勾（绿色）
 * - 每步只展示一个主操作按钮
 * - 暖色调、大圆角、大字体，面向非技术用户
 *
 * Requirements: 15.2, 15.4
 * 隐藏所有技术参数，使用日常用语
 */

import { Check } from 'lucide-react'
import { cn } from '@/lib/shared/utils'

/** 工作流步骤标签 — 使用日常用语 */
const STEP_LABELS = ['看任务', '拍摄', '上传', '生成', '导出'] as const

interface WorkflowStepperProps {
  /** 当前步骤 (1-5) */
  currentStep: 1 | 2 | 3 | 4 | 5
  /** 已完成的步骤编号列表 */
  completedSteps: number[]
}

export function WorkflowStepper({ currentStep, completedSteps }: WorkflowStepperProps) {
  return (
    <div className="w-full px-2 py-3" role="navigation" aria-label="工作流进度">
      <div className="flex items-center justify-between">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1
          const isCompleted = completedSteps.includes(stepNumber)
          const isCurrent = stepNumber === currentStep
          const isPending = !isCompleted && !isCurrent

          return (
            <div key={stepNumber} className="flex items-center flex-1 last:flex-none">
              {/* 步骤圆圈 + 标签 */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold transition-all',
                    isCompleted && 'bg-green-100 text-green-600 ring-2 ring-green-200',
                    isCurrent && 'bg-amber-500 text-white ring-2 ring-amber-300 shadow-md shadow-amber-200',
                    isPending && 'bg-gray-100 text-gray-400 ring-1 ring-gray-200'
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-4.5 w-4.5" strokeWidth={3} />
                  ) : (
                    stepNumber
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap',
                    isCompleted && 'text-green-600',
                    isCurrent && 'text-amber-700 font-semibold',
                    isPending && 'text-gray-400'
                  )}
                >
                  {label}
                </span>
              </div>

              {/* 连接线（最后一步不需要） */}
              {stepNumber < STEP_LABELS.length && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2 rounded-full transition-colors',
                    isCompleted ? 'bg-green-300' : 'bg-gray-200'
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
