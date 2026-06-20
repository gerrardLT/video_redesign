'use client'

/**
 * EditorGuide - 编辑器页面 Tooltip 引导序列
 *
 * 在用户首次进入编辑器时，按序展示以下功能点引导：
 * 1. 分镜列表区域 - 管理视频分镜片段
 * 2. 提示词编辑框 - 编写 AI 生成提示词
 * 3. 人物选择面板 - 选择视频中的角色
 * 4. 生成按钮 - 发起 AI 视频生成
 *
 * 组合 TooltipGuide + SpotlightOverlay 按序展示，不阻塞编辑器操作。
 * 全部查看完毕调用 completeStep('EDITOR_GUIDE')，
 * 中途跳过或 Escape 调用 skipStep('EDITOR_GUIDE')。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { useState, useCallback } from 'react'
import { TooltipGuide } from './tooltip-guide'
import { SpotlightOverlay } from './spotlight-overlay'
import { useOnboardingContext } from './onboarding-provider'

// ========================
// 引导步骤定义
// ========================

interface EditorGuideStep {
  /** 目标元素 CSS 选择器 */
  targetSelector: string
  /** 提示标题 */
  title: string
  /** 功能说明和推荐用法描述 */
  content: string
  /** Tooltip 显示位置 */
  position: 'top' | 'bottom' | 'left' | 'right'
}

/** Editor 引导序列：分镜列表 → 提示词编辑框 → 人物选择面板 → 生成按钮 */
const EDITOR_GUIDE_STEPS: EditorGuideStep[] = [
  {
    targetSelector: '[data-onboarding="shot-list"]',
    title: '分镜列表',
    content:
      '这里展示视频的所有分镜片段。你可以点击切换分镜、调整顺序或修改时长，每个分镜对应一段独立的画面内容。',
    position: 'right',
  },
  {
    targetSelector: '[data-onboarding="prompt-editor"]',
    title: '提示词编辑框',
    content:
      '在此输入画面描述提示词，AI 将根据提示词生成对应画面。建议描述具体场景、动作和情绪，效果会更好。',
    position: 'bottom',
  },
  {
    targetSelector: '[data-onboarding="character-panel"]',
    title: '人物选择面板',
    content:
      '选择视频中出现的角色形象。你可以从已有角色中选择，也可以上传自定义角色图片，保持角色在不同分镜中的一致性。',
    position: 'left',
  },
  {
    targetSelector: '[data-onboarding="generate-btn"]',
    title: '生成按钮',
    content:
      '一切准备就绪后，点击此按钮发起 AI 视频生成。生成过程中你可以继续编辑其他分镜，无需等待。',
    position: 'top',
  },
]

// ========================
// EditorGuide 组件
// ========================

export function EditorGuide() {
  const { progress, completeStep, skipStep } = useOnboardingContext()
  const [currentStepIndex, setCurrentStepIndex] = useState(0)

  // 激活条件：EDITOR_GUIDE 步骤状态为 NOT_COMPLETED
  const isActive = progress?.steps.EDITOR_GUIDE === 'NOT_COMPLETED'

  /**
   * 前进到下一步，最后一步完成后标记引导完成
   */
  const handleNext = useCallback(() => {
    if (currentStepIndex < EDITOR_GUIDE_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1)
    } else {
      // 全部步骤查看完毕，标记 EDITOR_GUIDE 为 COMPLETED
      completeStep('EDITOR_GUIDE')
    }
  }, [currentStepIndex, completeStep])

  /**
   * 跳过引导序列，标记为 SKIPPED
   */
  const handleSkip = useCallback(() => {
    skipStep('EDITOR_GUIDE')
  }, [skipStep])

  // 不满足激活条件时不渲染
  if (!isActive) {
    return null
  }

  const currentStep = EDITOR_GUIDE_STEPS[currentStepIndex]

  return (
    <>
      {/* 目标区域高亮遮罩 */}
      <SpotlightOverlay
        targetSelector={currentStep.targetSelector}
        visible={true}
        onDismiss={handleSkip}
      />

      {/* Tooltip 引导卡片 */}
      <TooltipGuide
        targetSelector={currentStep.targetSelector}
        title={currentStep.title}
        content={currentStep.content}
        position={currentStep.position}
        onNext={handleNext}
        onSkip={handleSkip}
        visible={true}
      />
    </>
  )
}
