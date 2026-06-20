'use client'

/**
 * useOnboarding Hook
 *
 * 使用 SWR 获取引导进度并提供步骤操作方法。
 * 供 OnboardingProvider 内部使用，外部通过 useOnboardingContext() 访问。
 *
 * Requirements: 1.2, 3.1, 4.1, 5.3, 6.1, 6.3
 */

import useSWR from 'swr'
import { toast } from 'sonner'
import type { OnboardingStepId, OnboardingProgress } from '@/lib/onboarding-service'

// ========================
// 类型定义
// ========================

export interface UseOnboardingReturn {
  /** 当前引导进度（未加载完成时为 null） */
  progress: OnboardingProgress | null
  /** 当前应执行的步骤（第一个 NOT_COMPLETED 步骤） */
  currentStep: OnboardingStepId | null
  /** 是否正在加载进度 */
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
// 常量
// ========================

/** 引导步骤执行顺序 */
const STEP_ORDER: OnboardingStepId[] = [
  'WELCOME_WIZARD',
  'SAMPLE_PROJECT_CREATED',
  'DASHBOARD_TOOLTIP',
  'EDITOR_GUIDE',
  'FIRST_PROJECT_GUIDE',
]

/** SWR 缓存 key */
const SWR_KEY = '/api/onboarding'

/** fetcher 函数 */
const fetcher = async (url: string): Promise<OnboardingProgress> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('获取引导进度失败')
  return res.json()
}

// ========================
// Hook 实现
// ========================

/**
 * 引导进度管理 Hook
 *
 * 通过 SWR 获取 /api/onboarding 进度数据，提供完成、跳过、重置等操作。
 * 根据步骤顺序自动计算 currentStep（第一个 NOT_COMPLETED 步骤）。
 */
export function useOnboarding(): UseOnboardingReturn {
  const { data, isLoading, mutate } = useSWR<OnboardingProgress>(SWR_KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })

  const progress = data ?? null

  // 计算当前步骤：第一个状态为 NOT_COMPLETED 的步骤
  const currentStep: OnboardingStepId | null = progress
    ? STEP_ORDER.find((stepId) => progress.steps[stepId] === 'NOT_COMPLETED') ?? null
    : null

  /** 判断指定步骤是否为当前激活步骤 */
  function isStepActive(stepId: OnboardingStepId): boolean {
    return currentStep === stepId
  }

  /** 完成指定步骤：调用 PUT /api/onboarding 并刷新缓存，奖励授予时弹出 toast 通知 */
  async function completeStep(stepId: OnboardingStepId): Promise<void> {
    const res = await fetch('/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, status: 'COMPLETED' }),
    })
    if (!res.ok) throw new Error('更新引导步骤失败')
    const { progress: updatedProgress, rewardGranted } = await res.json()
    mutate(updatedProgress, false)

    // 奖励授予时显示 toast 通知（Requirements: 8.3）
    if (rewardGranted) {
      toast.success('🎉 恭喜完成新手引导！获得 20 积分奖励')
    }
  }

  /** 跳过指定步骤：标记为 SKIPPED */
  async function skipStep(stepId: OnboardingStepId): Promise<void> {
    const res = await fetch('/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, status: 'SKIPPED' }),
    })
    if (!res.ok) throw new Error('跳过引导步骤失败')
    const { progress: updatedProgress } = await res.json()
    mutate(updatedProgress, false)
  }

  /** 重置引导：调用 POST /api/onboarding/reset 并刷新缓存 */
  async function resetOnboarding(): Promise<void> {
    const res = await fetch('/api/onboarding/reset', { method: 'POST' })
    if (!res.ok) throw new Error('重置引导进度失败')
    const { progress: updatedProgress } = await res.json()
    mutate(updatedProgress, false)
  }

  return {
    progress,
    currentStep,
    isLoading,
    isStepActive,
    completeStep,
    skipStep,
    resetOnboarding,
  }
}
