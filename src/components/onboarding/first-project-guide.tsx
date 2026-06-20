'use client'

/**
 * FirstProjectGuide - 首次创建项目流程指引组件
 *
 * 在用户首次创建非示例项目时，以 Banner 形式展示项目创建流程概览。
 * 不阻塞用户操作，用户可通过"知道了"按钮或关闭按钮完成/关闭引导。
 *
 * 激活条件：
 * - FIRST_PROJECT_GUIDE 步骤为 NOT_COMPLETED
 *
 * 交互规则：
 * - 点击"知道了"→ completeStep('FIRST_PROJECT_GUIDE')
 * - 点击"×"关闭 → completeStep('FIRST_PROJECT_GUIDE')
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { useState, useMemo, useCallback } from 'react'
import { useOnboardingContext } from './onboarding-provider'

// ========================
// 流程步骤定义
// ========================

interface FlowStep {
  /** 步骤图标 */
  icon: string
  /** 步骤标签 */
  label: string
}

/**
 * 项目创建流程步骤
 * 输入视频链接 → 等待解析 → 编辑分镜和提示词 → 选择人物 → 发起生成
 */
const PROJECT_FLOW_STEPS: FlowStep[] = [
  { icon: '🔗', label: '输入视频链接' },
  { icon: '⏳', label: '等待解析' },
  { icon: '✏️', label: '编辑分镜和提示词' },
  { icon: '👤', label: '选择人物' },
  { icon: '🚀', label: '发起生成' },
]

// ========================
// FirstProjectGuide 组件
// ========================

export function FirstProjectGuide() {
  const { progress, completeStep } = useOnboardingContext()
  const [dismissed, setDismissed] = useState(false)

  // 激活条件：FIRST_PROJECT_GUIDE 为 NOT_COMPLETED
  const isActive = useMemo(() => {
    if (!progress) return false
    return progress.steps.FIRST_PROJECT_GUIDE === 'NOT_COMPLETED'
  }, [progress])

  /**
   * 完成/关闭引导，标记步骤为 COMPLETED
   */
  const handleDismiss = useCallback(() => {
    setDismissed(true)
    completeStep('FIRST_PROJECT_GUIDE')
  }, [completeStep])

  // 不满足激活条件或已关闭时不渲染
  if (!isActive || dismissed) return null

  return (
    <div
      className="mb-6 rounded-xl border border-[var(--cine-gold)]/20 bg-[var(--cine-gold)]/5 px-4 py-3"
      role="alert"
      aria-label="首次创建项目流程指引"
    >
      {/* 标题行 + 关闭按钮 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {/* 标题 */}
          <p className="text-sm font-medium text-[var(--cine-gold)]">
            💡 项目创建流程指引
          </p>

          {/* 流程步骤展示 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--cine-text-2)]">
            {PROJECT_FLOW_STEPS.map((step, index) => (
              <span key={step.label} className="flex items-center gap-1">
                <span>{step.icon}</span>
                <span>{step.label}</span>
                {index < PROJECT_FLOW_STEPS.length - 1 && (
                  <span className="mx-1 text-[var(--cine-text-3)]">→</span>
                )}
              </span>
            ))}
          </div>

          {/* "知道了"按钮 */}
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-2.5 rounded-md bg-[var(--cine-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--cine-gold)] transition-colors hover:bg-[var(--cine-gold)]/20"
          >
            知道了
          </button>
        </div>

        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-md p-1 text-[var(--cine-text-3)] transition-colors hover:bg-white/5 hover:text-[var(--cine-text-2)]"
          aria-label="关闭引导"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
