'use client'

/**
 * OnboardingProvider - 新手引导状态 Context Provider
 *
 * 使用 React Context 将引导状态分发给子组件。
 * 内部包裹 useOnboarding hook，通过 Context 暴露所有引导操作。
 * 仅在用户已登录时激活（未登录不请求 API，返回空状态）。
 *
 * Requirements: 5.3, 9.4
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useOnboarding, type UseOnboardingReturn } from '@/hooks/use-onboarding'
import type { OnboardingStepId, OnboardingProgress } from '@/lib/onboarding-service'

// ========================
// Context 类型定义
// ========================

export interface OnboardingContextValue {
  /** 当前引导进度（未加载或未登录时为 null） */
  progress: OnboardingProgress | null
  /** 当前应执行的步骤 */
  currentStep: OnboardingStepId | null
  /** 是否正在加载 */
  isLoading: boolean
  /** 判断指定步骤是否为当前激活步骤 */
  isStepActive: (stepId: OnboardingStepId) => boolean
  /** 完成指定步骤 */
  completeStep: (stepId: OnboardingStepId) => Promise<void>
  /** 跳过指定步骤 */
  skipStep: (stepId: OnboardingStepId) => Promise<void>
  /** 重置所有引导进度 */
  resetOnboarding: () => Promise<void>
}

// ========================
// Context 创建
// ========================

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

// ========================
// Provider Props
// ========================

interface OnboardingProviderProps {
  children: ReactNode
  /** 用户是否已登录，未登录时不请求 API */
  isAuthenticated?: boolean
}

// ========================
// 未登录时的空操作函数
// ========================

const noop = async () => {}
const noopBool = () => false

/** 未登录状态下的默认 Context 值 */
const UNAUTHENTICATED_VALUE: OnboardingContextValue = {
  progress: null,
  currentStep: null,
  isLoading: false,
  isStepActive: noopBool,
  completeStep: noop,
  skipStep: noop,
  resetOnboarding: noop,
}

// ========================
// 内部 Provider（已登录时使用）
// ========================

function AuthenticatedProvider({ children }: { children: ReactNode }) {
  const onboarding = useOnboarding()

  const value: OnboardingContextValue = {
    progress: onboarding.progress,
    currentStep: onboarding.currentStep,
    isLoading: onboarding.isLoading,
    isStepActive: onboarding.isStepActive,
    completeStep: onboarding.completeStep,
    skipStep: onboarding.skipStep,
    resetOnboarding: onboarding.resetOnboarding,
  }

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

// ========================
// 导出 Provider
// ========================

/**
 * OnboardingProvider
 *
 * 为子组件树提供引导状态和操作方法。
 * isAuthenticated 为 false 时不请求 API，返回空状态。
 */
export function OnboardingProvider({
  children,
  isAuthenticated = false,
}: OnboardingProviderProps) {
  // 未登录：直接返回空状态 Context，不触发任何 API 请求
  if (!isAuthenticated) {
    return (
      <OnboardingContext.Provider value={UNAUTHENTICATED_VALUE}>
        {children}
      </OnboardingContext.Provider>
    )
  }

  // 已登录：使用内部 AuthenticatedProvider 激活 hook
  return <AuthenticatedProvider>{children}</AuthenticatedProvider>
}

// ========================
// 导出 Consumer Hook
// ========================

/**
 * useOnboardingContext
 *
 * 子组件通过此 hook 消费引导状态。
 * 必须在 OnboardingProvider 内部使用，否则抛出错误。
 */
export function useOnboardingContext(): OnboardingContextValue {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboardingContext 必须在 OnboardingProvider 内部使用')
  }
  return context
}
