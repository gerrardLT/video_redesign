'use client'

/**
 * DashboardGuide - Dashboard 功能点 Tooltip 引导序列组件
 *
 * 组合 TooltipGuide + SpotlightOverlay 按序展示 Dashboard 关键功能点引导。
 * 引导序列：新建项目按钮 → 资产库入口 → 套餐入口 → 帮助中心入口
 *
 * 激活条件：
 * - WELCOME_WIZARD 已完成或已跳过（!== 'NOT_COMPLETED'）
 * - DASHBOARD_TOOLTIP 为 NOT_COMPLETED
 *
 * 交互规则：
 * - 点击"知道了"或目标元素 → 前进到下一步
 * - 全部查看完毕 → completeStep('DASHBOARD_TOOLTIP')
 * - 点击"跳过"或按 Escape → skipStep('DASHBOARD_TOOLTIP')
 *
 * Requirements: 3.1, 3.3, 3.4, 3.5
 */

import { useState, useCallback, useMemo } from 'react'
import { TooltipGuide } from './tooltip-guide'
import { SpotlightOverlay } from './spotlight-overlay'
import { useOnboardingContext } from './onboarding-provider'

// ========================
// 引导步骤定义
// ========================

interface GuideStep {
  /** 目标元素的 CSS 选择器 */
  targetSelector: string
  /** 提示标题 */
  title: string
  /** 提示描述内容 */
  content: string
  /** Tooltip 相对于目标元素的位置方向 */
  position: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Dashboard 引导序列步骤配置
 * 按顺序依次展示：新建项目按钮 → 资产库入口 → 套餐入口 → 帮助中心入口
 */
const DASHBOARD_GUIDE_STEPS: GuideStep[] = [
  {
    targetSelector: '[data-onboarding="new-project"]',
    title: '新建项目',
    content: '点击这里可以创建新的视频项目，输入视频链接即可开始 AI 解析与创作。',
    position: 'bottom',
  },
  {
    targetSelector: '[data-onboarding="asset-library"]',
    title: '资产库',
    content: '管理你的所有素材资源，包括生成的视频、角色形象和分镜素材。',
    position: 'bottom',
  },
  {
    targetSelector: '[data-onboarding="packages"]',
    title: '套餐中心',
    content: '查看和购买积分套餐，获取更多生成额度来创作更多作品。',
    position: 'bottom',
  },
  {
    targetSelector: '[data-onboarding="help"]',
    title: '帮助中心',
    content: '遇到问题？这里有使用教程、常见问题解答和客服入口。',
    position: 'bottom',
  },
]

// ========================
// DashboardGuide 组件
// ========================

export function DashboardGuide() {
  const { progress, completeStep, skipStep } = useOnboardingContext()
  const [currentStepIndex, setCurrentStepIndex] = useState(0)

  // 激活条件判断：WELCOME_WIZARD 已完成/已跳过 且 DASHBOARD_TOOLTIP 为 NOT_COMPLETED
  const isActive = useMemo(() => {
    if (!progress) return false
    return (
      progress.steps.WELCOME_WIZARD !== 'NOT_COMPLETED' &&
      progress.steps.DASHBOARD_TOOLTIP === 'NOT_COMPLETED'
    )
  }, [progress])

  // 当前步骤数据
  const currentStep = DASHBOARD_GUIDE_STEPS[currentStepIndex]

  /**
   * 前进到下一步，全部完成时调用 completeStep
   */
  const handleNext = useCallback(() => {
    if (currentStepIndex < DASHBOARD_GUIDE_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1)
    } else {
      // 全部查看完毕
      completeStep('DASHBOARD_TOOLTIP')
    }
  }, [currentStepIndex, completeStep])

  /**
   * 跳过引导序列
   */
  const handleSkip = useCallback(() => {
    skipStep('DASHBOARD_TOOLTIP')
  }, [skipStep])

  // 不满足激活条件时不渲染
  if (!isActive) return null

  return (
    <>
      {/* 高亮遮罩 */}
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
