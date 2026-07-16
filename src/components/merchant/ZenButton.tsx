'use client'

import { cn } from '@/lib/shared/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * ZenButton — Runway 暗色按钮组件
 *
 * 两种变体：
 * - primary：白底黑字，4px 微圆角，:active scale(0.985)
 * - ghost：透明背景，#27272a 边框，白字，:active 白色高亮
 *
 * 动效全部纯 CSS，transition 预声明确保 :active 即时响应。
 */

interface ZenButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** 按钮变体：primary 主操作 | ghost 次级操作 */
  variant: 'primary' | 'ghost'
  /** 按钮内容 */
  children: ReactNode
  /** 点击回调 */
  onClick?: () => void
  /** 禁用状态 */
  disabled?: boolean
  /** 是否撑满宽度 */
  fullWidth?: boolean
  /** 额外 className */
  className?: string
}

/**
 * Runway 暗色按钮
 *
 * Primary: 白底 + 黑字 + 4px 圆角 + :active scale(0.985)
 * Ghost: 透明底 + #27272a 边框 + 白字 + :active 白色高亮
 */
export function ZenButton({
  variant,
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  className,
  ...rest
}: ZenButtonProps) {
  const baseStyles = [
    // 基础布局
    'inline-flex items-center justify-center',
    // 字体规格：15px, 600 weight, -0.16px letter-spacing
    'text-[15px] font-semibold tracking-[-.16px]',
    // 圆角 4px
    'rounded-[4px]',
    // transition 预声明
    'transition-[background-color,transform,color,border-color] duration-[200ms] ease-[cubic-bezier(.16,1,.3,1)]',
    // 禁用态
    disabled && 'opacity-50 pointer-events-none cursor-not-allowed',
    // 全宽
    fullWidth && 'w-full',
  ]

  const variantStyles = {
    primary: [
      // 背景：白底黑字（Runway CTA）
      'bg-white',
      'text-black',
      // 内边距
      'px-6 py-4',
      // :active 态：浅灰背景 + scale(0.985)
      'active:bg-[#e9ecf2] active:scale-[0.985]',
    ],
    ghost: [
      // 透明背景 + 暗色边框
      'bg-transparent',
      'text-white',
      'border border-[#27272a]',
      // 内边距
      'px-4 py-3',
      // :active / hover：边框变亮 + 背景微亮
      'hover:border-[#3a3a3e] hover:bg-[#0e0e0e]',
      'active:border-white',
    ],
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ...baseStyles,
        ...variantStyles[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
