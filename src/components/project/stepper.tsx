'use client'

import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

// ========================
// Types
// ========================

export interface StepItem {
  label: string
  anchorId: string
  status: 'completed' | 'active' | 'upcoming'
}

export interface StepperProps {
  steps: StepItem[]
  onStepClick?: (step: StepItem) => void
  className?: string
}

// ========================
// 步骤跳转逻辑
// ========================

/**
 * 滚动到指定 anchorId 对应的页面区域
 */
function scrollToAnchor(anchorId: string): void {
  const element = document.getElementById(anchorId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ========================
// Stepper Component
// ========================

export default function Stepper({ steps, onStepClick, className }: StepperProps) {
  const [shakingIndex, setShakingIndex] = useState<number | null>(null)

  /**
   * 处理步骤点击
   * - completed/active 步骤：滚动到对应区域 + 触发 onStepClick 回调
   * - upcoming 步骤：触发 shake 动画视觉反馈，不跳转
   */
  const handleStepClick = useCallback(
    (step: StepItem, index: number) => {
      if (step.status === 'completed' || step.status === 'active') {
        // 已完成或当前步骤：执行滚动跳转
        scrollToAnchor(step.anchorId)
        onStepClick?.(step)
      } else {
        // 未完成前置步骤的后续步骤：shake 动画反馈
        setShakingIndex(index)
        // 动画结束后清除状态
        setTimeout(() => setShakingIndex(null), 500)
      }
    },
    [onStepClick]
  )

  return (
    <nav className={cn('w-full', className)} aria-label="创作流程步骤">
      {/* 桌面端：水平步骤条 */}
      <ol className="hidden md:flex items-center w-full">
        {steps.map((step, index) => {
          const isNavigable = step.status === 'completed' || step.status === 'active'
          const isShaking = shakingIndex === index

          return (
            <li key={step.anchorId} className="flex items-center flex-1 last:flex-none">
              {/* 步骤节点 */}
              <button
                type="button"
                onClick={() => handleStepClick(step, index)}
                className={cn(
                  'flex flex-col items-center gap-1.5 group relative',
                  isNavigable ? 'cursor-pointer' : 'cursor-not-allowed',
                  isShaking && 'stepper-shake'
                )}
                aria-current={step.status === 'active' ? 'step' : undefined}
                aria-label={`${step.label}${step.status === 'completed' ? '（已完成)' : step.status === 'active' ? '（当前步骤)' : '（未到达)'}`}
                title={step.status === 'upcoming' ? '请先完成前置步骤' : undefined}
              >
                {/* 步骤图标圆圈 */}
                <span
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-medium transition-all shrink-0',
                    step.status === 'completed' &&
                      'bg-[var(--cine-green-dim)] border-[var(--cine-green)] text-[var(--cine-green)]',
                    step.status === 'active' &&
                      'bg-[var(--cine-gold-dim)] border-[var(--cine-gold)] text-[var(--cine-gold)] shadow-[0_0_8px_var(--cine-gold-dim)]',
                    step.status === 'upcoming' &&
                      'bg-transparent border-[var(--cine-line-2)] text-[var(--cine-text-3)]'
                  )}
                >
                  {step.status === 'completed' ? (
                    <CheckIcon />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </span>

                {/* 步骤名称 */}
                <span
                  className={cn(
                    'text-xs whitespace-nowrap transition-colors',
                    step.status === 'completed' && 'text-[var(--cine-green)]',
                    step.status === 'active' && 'text-[var(--cine-text)] font-bold',
                    step.status === 'upcoming' && 'text-[var(--cine-text-3)]'
                  )}
                >
                  {step.label}
                </span>

                {/* Tooltip：点击不可用步骤时显示 */}
                {isShaking && (
                  <span
                    className="absolute -bottom-7 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[var(--cine-surface)] border border-[var(--cine-line-2)] rounded text-[10px] text-[var(--cine-text-2)] whitespace-nowrap z-10"
                    role="tooltip"
                  >
                    请先完成前置步骤
                  </span>
                )}
              </button>

              {/* 连接线（最后一个步骤不需要) */}
              {index < steps.length - 1 && (
                <div className="flex-1 mx-2">
                  <div
                    className={cn(
                      'h-0.5 w-full transition-colors',
                      step.status === 'completed' && 'bg-[var(--cine-green)]',
                      step.status === 'active' && 'bg-[var(--cine-gold)]',
                      step.status === 'upcoming' &&
                        'border-t-2 border-dashed border-[var(--cine-line-2)] bg-transparent h-0'
                    )}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* 移动端：紧凑展示 */}
      <MobileStepper steps={steps} onStepClick={handleStepClick} />
    </nav>
  )
}

// ========================
// MobileStepper - 移动端紧凑视图
// ========================

function MobileStepper({
  steps,
  onStepClick,
}: {
  steps: StepItem[]
  onStepClick: (step: StepItem, index: number) => void
}) {
  const [shakingMobileIndex, setShakingMobileIndex] = useState<number | null>(null)
  const activeStep = steps.find((s) => s.status === 'active')
  const activeIndex = steps.findIndex((s) => s.status === 'active')
  const completedCount = steps.filter((s) => s.status === 'completed').length

  const handleMobileDotClick = useCallback(
    (step: StepItem, index: number) => {
      if (step.status === 'completed' || step.status === 'active') {
        onStepClick(step, index)
      } else {
        setShakingMobileIndex(index)
        setTimeout(() => setShakingMobileIndex(null), 500)
      }
    },
    [onStepClick]
  )

  return (
    <div className="flex md:hidden items-center gap-3 px-1">
      {/* 进度指示器 */}
      <div className="flex items-center gap-1">
        {steps.map((step, index) => (
          <button
            key={step.anchorId}
            type="button"
            onClick={() => handleMobileDotClick(step, index)}
            className={cn(
              'w-2 h-2 rounded-full transition-all',
              step.status === 'completed' && 'bg-[var(--cine-green)]',
              step.status === 'active' && 'bg-[var(--cine-gold)] w-4',
              step.status === 'upcoming' && 'bg-[var(--cine-line-2)]',
              shakingMobileIndex === index && 'stepper-shake'
            )}
            aria-label={`步骤 ${index + 1}: ${step.label}`}
          />
        ))}
      </div>

      {/* 当前步骤信息 */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--cine-gold)] font-medium">
          {activeIndex + 1}/{steps.length}
        </span>
        <span className="text-[var(--cine-text)] font-medium">
          {activeStep?.label ?? `已完成 ${completedCount} 步`}
        </span>
      </div>
    </div>
  )
}

// ========================
// CheckIcon - 已完成打勾图标
// ========================

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={3}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
