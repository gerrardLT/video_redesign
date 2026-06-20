'use client'

/**
 * WelcomeWizard - 4 步欢迎向导 Modal
 *
 * 步骤序列：平台介绍 → 功能概览 → 积分说明 → 开始体验
 * 每步包含标题、描述文案、图标/动画区域
 * 包含"下一步"按钮、"跳过引导"按钮、步骤进度指示器（dots）
 * 最后一步显示"开始体验"按钮
 *
 * 完成时调用 completeStep('WELCOME_WIZARD')
 * 跳过时调用 skipStep('WELCOME_WIZARD')
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 9.3
 */

import { useState, useCallback } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Sparkles, Layers, Coins, Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useOnboardingContext } from './onboarding-provider'

// ========================
// 步骤数据定义
// ========================

interface WizardStep {
  /** 步骤标题 */
  title: string
  /** 步骤描述 */
  description: string
  /** 步骤图标 */
  icon: React.ReactNode
}

const WIZARD_STEPS: WizardStep[] = [
  {
    title: '欢迎来到视频创作平台',
    description:
      '利用 AI 智能技术，一键将视频创意转化为高质量短视频。从脚本到成片，让创作更简单、更高效。',
    icon: <Sparkles className="size-8 text-[var(--cine-gold)]" />,
  },
  {
    title: '核心功能',
    description:
      '分镜编辑器帮你精细控制每一帧画面；AI 智能生成省去繁琐制作流程；人物一致性技术确保角色形象前后统一。',
    icon: <Layers className="size-8 text-[var(--cine-gold)]" />,
  },
  {
    title: '积分系统',
    description:
      '新注册即获 100 积分。每次 AI 生成消耗一定积分，积分用完后可通过套餐充值继续创作。',
    icon: <Coins className="size-8 text-[var(--cine-gold)]" />,
  },
  {
    title: '准备就绪！',
    description:
      '一切已就绪，开始你的第一个视频创作之旅吧。我们已为你准备了一个示例项目，方便快速上手。',
    icon: <Rocket className="size-8 text-[var(--cine-gold)]" />,
  },
]

// ========================
// 组件 Props
// ========================

interface WelcomeWizardProps {
  /** 控制 Modal 是否显示 */
  open: boolean
}

// ========================
// WelcomeWizard 组件
// ========================

export function WelcomeWizard({ open }: WelcomeWizardProps) {
  const { completeStep, skipStep } = useOnboardingContext()
  const [currentIndex, setCurrentIndex] = useState(0)
  /** 步骤切换动画方向：'next' 或 'prev' */
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  /** 是否正在动画中（防止快速点击） */
  const [isAnimating, setIsAnimating] = useState(false)

  const isLastStep = currentIndex === WIZARD_STEPS.length - 1
  const step = WIZARD_STEPS[currentIndex]

  // 下一步
  const handleNext = useCallback(async () => {
    if (isAnimating) return

    if (isLastStep) {
      // 最后一步点击"开始体验"→ 完成步骤
      await completeStep('WELCOME_WIZARD')
      return
    }

    setDirection('next')
    setIsAnimating(true)
    // 短暂延迟触发动画
    setTimeout(() => {
      setCurrentIndex((prev) => prev + 1)
      setIsAnimating(false)
    }, 200)
  }, [isLastStep, isAnimating, completeStep])

  // 跳过引导
  const handleSkip = useCallback(async () => {
    await skipStep('WELCOME_WIZARD')
  }, [skipStep])

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity duration-300" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-2xl">
            {/* 顶部装饰光晕 */}
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-[var(--cine-gold)] opacity-[0.04] blur-3xl" />

            {/* 内容区 */}
            <div className="relative px-8 pt-10 pb-6">
              {/* 图标区域 */}
              <div
                className={cn(
                  'mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--cine-gold-dim)] transition-all duration-200',
                  isAnimating && 'scale-90 opacity-0'
                )}
              >
                {step.icon}
              </div>

              {/* 标题 */}
              <h2
                className={cn(
                  'text-center text-xl font-semibold text-[var(--cine-text)] transition-all duration-200',
                  isAnimating && direction === 'next' && '-translate-x-4 opacity-0',
                  isAnimating && direction === 'prev' && 'translate-x-4 opacity-0'
                )}
              >
                {step.title}
              </h2>

              {/* 描述 */}
              <p
                className={cn(
                  'mt-3 text-center text-sm leading-relaxed text-[var(--cine-text-2)] transition-all duration-200',
                  isAnimating && direction === 'next' && '-translate-x-4 opacity-0',
                  isAnimating && direction === 'prev' && 'translate-x-4 opacity-0'
                )}
              >
                {step.description}
              </p>
            </div>

            {/* 底部操作区 */}
            <div className="border-t border-[var(--cine-line)] px-8 py-5">
              {/* 进度指示器 (dots) */}
              <div className="mb-5 flex items-center justify-center gap-2">
                {WIZARD_STEPS.map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-2 rounded-full transition-all duration-300',
                      index === currentIndex
                        ? 'w-6 bg-[var(--cine-gold)]'
                        : 'w-2 bg-[var(--cine-text-3)]'
                    )}
                  />
                ))}
              </div>

              {/* 按钮 */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleSkip}
                  className="text-sm text-[var(--cine-text-3)] transition-colors hover:text-[var(--cine-text-2)]"
                >
                  跳过引导
                </button>

                <Button
                  onClick={handleNext}
                  className="bg-[var(--cine-gold)] text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)]"
                  size="lg"
                >
                  {isLastStep ? '开始体验' : '下一步'}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
