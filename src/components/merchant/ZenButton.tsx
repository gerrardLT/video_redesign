'use client'

import { cn } from '@/lib/shared/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Zen_Button — v3 禅意编辑式按钮组件
 *
 * 两种变体：
 * - primary：深绿实心，白字，3px 微圆角，:active scale(0.97)
 * - ghost：透明背景，次级文字色，底部 1px 发丝线，:active 文字变绿
 *
 * 动效全部纯 CSS，transition 预声明确保 :active 即时响应。
 * 不引入任何 JS 动画库。
 *
 * @see Requirements 7.1, 7.2, 7.3, 5.3
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
 * v3 禅意风格按钮
 *
 * Primary: 深绿底(--ll-green) + 白字 + 3px 圆角 + :active scale(0.97) + 深绿深色
 * Ghost: 透明底 + 次级文字色(--ll-text-2) + 底部发丝线 + :active 文字变绿
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
    // 字体规格：15px, 500 weight, 0.04em letter-spacing
    'text-[15px] font-medium tracking-[.04em]',
    // 圆角 3px
    'rounded-[3px]',
    // transition 预声明（确保 :active 时即时响应）
    'transition-[background-color,transform,color] duration-[150ms] ease-out',
    // 禁用态
    disabled && 'opacity-50 pointer-events-none cursor-not-allowed',
    // 全宽
    fullWidth && 'w-full',
  ]

  const variantStyles = {
    primary: [
      // 背景：品牌绿
      'bg-[var(--ll-green)]',
      // 文字：白色
      'text-white',
      // 内边距
      'px-6 py-4',
      // :active 态：深绿背景 + scale(0.97)
      // transform 的 transition 为 80ms
      'active:bg-[var(--ll-green-deep)] active:scale-[0.97]',
      // 单独控制 transform 的 transition 时长为 80ms
      '[transition:background-color_150ms,transform_80ms]',
    ],
    ghost: [
      // 背景透明
      'bg-transparent',
      // 文字：次级颜色
      'text-[var(--ll-text-2)]',
      // 内边距
      'px-4 py-3',
      // 底部发丝线
      'border-b border-b-[var(--ll-hair)]',
      // :active 态：文字变绿
      'active:text-[var(--ll-green)]',
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
