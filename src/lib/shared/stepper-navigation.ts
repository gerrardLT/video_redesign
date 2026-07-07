/**
 * Stepper Navigation - 步骤跳转与滚动逻辑
 *
 * 处理 Stepper 组件中的步骤点击行为：
 * 1. 已完成/当前步骤 → 平滑滚动到对应区域
 * 2. 未完成前置步骤的后续步骤 → 视觉反馈（shake 动画）
 */

import type { StepItem } from '@/components/project/stepper'

// ========================
// Types
// ========================

export interface StepNavigationOptions {
  /** 无法跳转时的提示文案 */
  blockMessage?: string
  /** 滚动行为配置 */
  scrollBehavior?: ScrollBehavior
  /** 滚动对齐方式 */
  scrollBlock?: ScrollLogicalPosition
  /** 滚动偏移量（像素），用于补偿固定头部等 */
  scrollOffset?: number
  /** 自定义 toast 函数，若提供则使用 toast 提示代替 shake 动画 */
  onBlocked?: (message: string) => void
}

const DEFAULT_OPTIONS: Required<StepNavigationOptions> = {
  blockMessage: '请先完成前置步骤',
  scrollBehavior: 'smooth',
  scrollBlock: 'start',
  scrollOffset: 0,
  onBlocked: () => {},
}

// ========================
// CSS Shake 动画相关
// ========================

const SHAKE_CLASS = 'stepper-shake'
const SHAKE_DURATION = 500 // ms

/**
 * 给 Stepper 容器添加 shake 动画类（需在全局 CSS 中定义 .stepper-shake 动画）
 */
function triggerShakeAnimation(stepperElement: HTMLElement | null) {
  if (!stepperElement) return

  // 防止重复触发动画
  stepperElement.classList.remove(SHAKE_CLASS)
  // 强制回流以重新触发动画
  void stepperElement.offsetWidth
  stepperElement.classList.add(SHAKE_CLASS)

  setTimeout(() => {
    stepperElement.classList.remove(SHAKE_CLASS)
  }, SHAKE_DURATION)
}

// ========================
// 核心导航函数
// ========================

/**
 * 处理步骤点击导航
 *
 * @param step - 被点击的步骤
 * @param canNavigateTo - 判断是否可以导航到指定步骤的函数
 * @param stepIndex - 被点击步骤的索引
 * @param options - 导航配置选项
 * @returns 是否成功执行了滚动导航
 *
 * @example
 * ```tsx
 * const { steps, canNavigateTo } = useProjectSteps(project)
 *
 * <Stepper
 *   steps={steps}
 *   onStepClick={(step) => {
 *     const index = steps.findIndex(s => s.anchorId === step.anchorId)
 *     handleStepNavigation(step, canNavigateTo, index, {
 *       onBlocked: (msg) => toast.error(msg)
 *     })
 *   }}
 * />
 * ```
 */
export function handleStepNavigation(
  step: StepItem,
  canNavigateTo: (index: number) => boolean,
  stepIndex: number,
  options?: StepNavigationOptions
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (canNavigateTo(stepIndex)) {
    // 可以导航：平滑滚动到对应锚点区域
    const targetElement = document.getElementById(step.anchorId)
    if (targetElement) {
      if (opts.scrollOffset !== 0) {
        // 有偏移量时使用 window.scrollTo 精确控制位置
        const elementTop = targetElement.getBoundingClientRect().top + window.scrollY
        window.scrollTo({
          top: elementTop - opts.scrollOffset,
          behavior: opts.scrollBehavior,
        })
      } else {
        targetElement.scrollIntoView({
          behavior: opts.scrollBehavior,
          block: opts.scrollBlock,
        })
      }
      return true
    }
    return false
  } else {
    // 不可导航：视觉反馈
    if (opts.onBlocked) {
      opts.onBlocked(opts.blockMessage)
    }

    // 同时触发 shake 动画（查找 Stepper 的 nav 容器）
    const stepperNav = document.querySelector('[aria-label="创作流程步骤"]') as HTMLElement | null
    triggerShakeAnimation(stepperNav)

    return false
  }
}

/**
 * 创建一个绑定了 canNavigateTo 的步骤点击处理器
 * 适用于直接作为 Stepper 的 onStepClick 回调
 *
 * @param steps - 当前步骤列表
 * @param canNavigateTo - 导航可达性判断函数
 * @param options - 导航配置选项
 * @returns onStepClick 回调函数
 *
 * @example
 * ```tsx
 * const { steps, canNavigateTo } = useProjectSteps(project)
 * const onStepClick = createStepClickHandler(steps, canNavigateTo, {
 *   onBlocked: (msg) => toast.error(msg)
 * })
 *
 * <Stepper steps={steps} onStepClick={onStepClick} />
 * ```
 */
export function createStepClickHandler(
  steps: StepItem[],
  canNavigateTo: (index: number) => boolean,
  options?: StepNavigationOptions
): (step: StepItem) => void {
  return (step: StepItem) => {
    const stepIndex = steps.findIndex((s) => s.anchorId === step.anchorId)
    if (stepIndex === -1) return
    handleStepNavigation(step, canNavigateTo, stepIndex, options)
  }
}
