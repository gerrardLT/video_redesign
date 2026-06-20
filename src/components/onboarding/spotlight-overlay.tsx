'use client'

/**
 * SpotlightOverlay - 元素高亮遮罩组件
 *
 * 通过 CSS box-shadow 实现目标区域高亮、周围半透明遮罩效果。
 * 点击遮罩区域（非高亮区域）触发 dismiss，不阻塞对高亮元素的点击交互。
 * 使用 Portal 渲染到 body 层级，z-index 8000（低于 Tooltip）。
 *
 * Requirements: 3.2, 9.1, 9.3
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

// ========================
// Props 类型定义
// ========================

export interface SpotlightOverlayProps {
  /** 高亮目标元素的 CSS 选择器 */
  targetSelector: string
  /** 是否显示遮罩 */
  visible: boolean
  /** 点击遮罩区域（非高亮区域）的回调 */
  onDismiss?: () => void
  /** 高亮区域额外内边距，默认 8px */
  padding?: number
}

// ========================
// 目标元素矩形信息
// ========================

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

// ========================
// SpotlightOverlay 组件
// ========================

export function SpotlightOverlay({
  targetSelector,
  visible,
  onDismiss,
  padding = 8,
}: SpotlightOverlayProps) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [mounted, setMounted] = useState(false)
  const rafRef = useRef<number | null>(null)

  /**
   * 计算目标元素的位置和尺寸（含 padding）
   */
  const updateTargetRect = useCallback(() => {
    const targetEl = document.querySelector(targetSelector)
    if (!targetEl) {
      setTargetRect(null)
      return
    }

    const rect = targetEl.getBoundingClientRect()
    setTargetRect({
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    })
  }, [targetSelector, padding])

  // 客户端挂载检测（Portal 需要 document.body）
  useEffect(() => {
    setMounted(true)
  }, [])

  // 监听 visible 变化，更新目标位置
  useEffect(() => {
    if (!visible) {
      setTargetRect(null)
      return
    }

    // 初始计算
    updateTargetRect()

    // 监听窗口 resize 和 scroll，重新计算位置
    const handleUpdate = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = requestAnimationFrame(updateTargetRect)
    }

    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)

    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [visible, updateTargetRect])

  // 未挂载（SSR）或不可见或目标未找到时不渲染
  if (!mounted || !visible || !targetRect) {
    return null
  }

  // 计算 clip-path polygon：覆盖整个视口但挖除目标区域
  // 使用逆时针绕行在目标区域创建"洞"
  const { top, left, width, height } = targetRect
  const right = left + width
  const bottom = top + height

  const clipPath = `polygon(
    0px 0px,
    0px 100vh,
    ${left}px 100vh,
    ${left}px ${top}px,
    ${right}px ${top}px,
    ${right}px ${bottom}px,
    ${left}px ${bottom}px,
    ${left}px 100vh,
    100vw 100vh,
    100vw 0px
  )`

  const overlay = (
    <div
      className="fixed inset-0"
      style={{ zIndex: 8000 }}
      aria-hidden="true"
    >
      {/* 点击捕获层：使用 clip-path 排除目标区域，点击时触发 dismiss */}
      <div
        className="fixed inset-0 cursor-pointer"
        style={{
          zIndex: 8001,
          clipPath,
          pointerEvents: 'auto',
        }}
        onClick={onDismiss}
      />

      {/* 视觉遮罩层：定位在目标区域，通过 box-shadow 实现周围半透明效果 */}
      <div
        className="fixed rounded-lg transition-opacity duration-300"
        style={{
          zIndex: 8000,
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none',
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  )

  return createPortal(overlay, document.body)
}
