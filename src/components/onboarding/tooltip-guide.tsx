'use client'

/**
 * TooltipGuide - 功能点 Tooltip 提示引导组件
 *
 * 定位到目标元素旁的浮动卡片，显示引导标题、描述及操作按钮。
 * 使用 React Portal 渲染在 document.body 层级，使用 getBoundingClientRect 手动计算位置。
 *
 * 交互规则：
 * - 点击"知道了"或目标元素本身 → 触发 onNext
 * - 点击外部区域或按 Escape → 触发 onSkip
 * - 300ms 内完成 dismiss 动画（opacity + transform）
 *
 * z-index: 9000（高于页面内容，低于 toast 通知 9999）
 *
 * Requirements: 3.2, 3.3, 3.4, 9.1, 9.2, 9.5
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ========================
// Props 类型定义
// ========================

export interface TooltipGuideProps {
  /** 目标元素的 CSS 选择器 */
  targetSelector: string
  /** 提示标题 */
  title: string
  /** 提示描述内容 */
  content: string
  /** Tooltip 相对于目标元素的位置方向 */
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** 点击"知道了"或目标元素时触发 */
  onNext: () => void
  /** 点击外部区域或按 Escape 时触发 */
  onSkip: () => void
  /** 是否可见 */
  visible?: boolean
}

// ========================
// 常量
// ========================

/** Tooltip 与目标元素的间距（px） */
const TOOLTIP_GAP = 12
/** 动画持续时间（ms），与 CSS transition 保持一致 */
const ANIMATION_DURATION = 300
/** z-index：高于页面内容，低于 toast 通知（sonner 默认 9999） */
const Z_INDEX = 9000

// ========================
// 位置计算
// ========================

interface TooltipPosition {
  top: number
  left: number
  transformOrigin: string
}

/**
 * 根据目标元素的 BoundingClientRect 和指定的 position 方向，计算 Tooltip 卡片的绝对位置
 */
function calculatePosition(
  targetRect: DOMRect,
  tooltipRect: DOMRect,
  position: 'top' | 'bottom' | 'left' | 'right'
): TooltipPosition {
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  switch (position) {
    case 'top':
      return {
        top: targetRect.top + scrollY - tooltipRect.height - TOOLTIP_GAP,
        left: targetRect.left + scrollX + (targetRect.width - tooltipRect.width) / 2,
        transformOrigin: 'bottom center',
      }
    case 'bottom':
      return {
        top: targetRect.bottom + scrollY + TOOLTIP_GAP,
        left: targetRect.left + scrollX + (targetRect.width - tooltipRect.width) / 2,
        transformOrigin: 'top center',
      }
    case 'left':
      return {
        top: targetRect.top + scrollY + (targetRect.height - tooltipRect.height) / 2,
        left: targetRect.left + scrollX - tooltipRect.width - TOOLTIP_GAP,
        transformOrigin: 'center right',
      }
    case 'right':
      return {
        top: targetRect.top + scrollY + (targetRect.height - tooltipRect.height) / 2,
        left: targetRect.right + scrollX + TOOLTIP_GAP,
        transformOrigin: 'center left',
      }
  }
}

/**
 * 将 Tooltip 位置约束在视口范围内，防止溢出屏幕
 */
function clampToViewport(
  pos: TooltipPosition,
  tooltipRect: DOMRect
): TooltipPosition {
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const padding = 8

  let { top, left } = pos

  // 水平边界约束
  const minLeft = scrollX + padding
  const maxLeft = scrollX + viewportWidth - tooltipRect.width - padding
  left = Math.max(minLeft, Math.min(left, maxLeft))

  // 垂直边界约束
  const minTop = scrollY + padding
  const maxTop = scrollY + viewportHeight - tooltipRect.height - padding
  top = Math.max(minTop, Math.min(top, maxTop))

  return { ...pos, top, left }
}

// ========================
// 组件实现
// ========================

export function TooltipGuide({
  targetSelector,
  title,
  content,
  position = 'bottom',
  onNext,
  onSkip,
  visible = true,
}: TooltipGuideProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null)
  const [isAnimatingIn, setIsAnimatingIn] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ========================
  // 位置更新逻辑
  // ========================

  const updatePosition = useCallback(() => {
    const targetEl = document.querySelector(targetSelector)
    const tooltipEl = tooltipRef.current
    if (!targetEl || !tooltipEl) return

    const targetRect = targetEl.getBoundingClientRect()
    const tooltipRect = tooltipEl.getBoundingClientRect()

    const rawPos = calculatePosition(targetRect, tooltipRect, position)
    const clampedPos = clampToViewport(rawPos, tooltipRect)
    setTooltipPos(clampedPos)
  }, [targetSelector, position])

  // ========================
  // 可见性动画控制
  // ========================

  useEffect(() => {
    if (visible) {
      // 显示：开始渲染 → 下一帧触发进入动画
      setShouldRender(true)
      setIsAnimatingOut(false)
      // 使用 requestAnimationFrame 确保 DOM 已挂载后再触发动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimatingIn(true)
        })
      })
    } else if (shouldRender) {
      // 隐藏：触发退出动画 → 动画结束后移除 DOM
      setIsAnimatingIn(false)
      setIsAnimatingOut(true)
      animationTimerRef.current = setTimeout(() => {
        setShouldRender(false)
        setIsAnimatingOut(false)
      }, ANIMATION_DURATION)
    }

    return () => {
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current)
      }
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // ========================
  // 位置初始化和窗口事件监听
  // ========================

  useEffect(() => {
    if (!shouldRender) return

    // 初始定位（延迟一帧等 DOM 挂载）
    requestAnimationFrame(() => {
      updatePosition()
    })

    // 监听 resize 和 scroll 以更新位置
    const handleResize = () => updatePosition()
    const handleScroll = () => updatePosition()

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true) // true 捕获所有滚动

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [shouldRender, updatePosition])

  // ========================
  // 目标元素点击监听（点击目标元素触发 onNext）
  // ========================

  useEffect(() => {
    if (!shouldRender) return

    const targetEl = document.querySelector(targetSelector)
    if (!targetEl) return

    const handleTargetClick = () => onNext()
    targetEl.addEventListener('click', handleTargetClick)

    return () => {
      targetEl.removeEventListener('click', handleTargetClick)
    }
  }, [shouldRender, targetSelector, onNext])

  // ========================
  // 点击外部区域和 Escape 键监听
  // ========================

  useEffect(() => {
    if (!shouldRender) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      const tooltipEl = tooltipRef.current
      const targetEl = document.querySelector(targetSelector)

      // 点击在 tooltip 或目标元素内部则不处理
      if (tooltipEl && tooltipEl.contains(e.target as Node)) return
      if (targetEl && targetEl.contains(e.target as Node)) return

      onSkip()
    }

    document.addEventListener('keydown', handleKeyDown)
    // 使用 mousedown 而非 click，避免与目标元素的 click 事件冲突
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [shouldRender, targetSelector, onSkip])

  // ========================
  // 渲染
  // ========================

  if (!shouldRender) return null

  // 动画状态：进入时 opacity 1 + scale 1；退出/初始时 opacity 0 + scale 0.95
  const isVisible = isAnimatingIn && !isAnimatingOut

  const tooltipContent = (
    <div
      ref={tooltipRef}
      role="tooltip"
      aria-label={title}
      style={{
        position: 'absolute',
        top: tooltipPos?.top ?? -9999,
        left: tooltipPos?.left ?? -9999,
        zIndex: Z_INDEX,
        transformOrigin: tooltipPos?.transformOrigin ?? 'top center',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(4px)',
        transition: `opacity ${ANIMATION_DURATION}ms ease, transform ${ANIMATION_DURATION}ms ease`,
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {/* Tooltip 卡片 - cinematic dark theme 样式 */}
      <div
        style={{
          background: 'var(--cine-surface, #141619)',
          border: '1px solid var(--cine-line-2, rgba(255,255,255,0.09))',
          borderRadius: '12px',
          padding: '20px',
          maxWidth: '320px',
          minWidth: '240px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(199,168,119,0.08)',
        }}
      >
        {/* 标题 */}
        <h4
          style={{
            margin: '0 0 8px 0',
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--cine-text, #E9E6DF)',
            lineHeight: 1.4,
          }}
        >
          {title}
        </h4>

        {/* 描述 */}
        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: '13px',
            color: 'var(--cine-text-2, #8C8B85)',
            lineHeight: 1.7,
          }}
        >
          {content}
        </p>

        {/* 操作按钮 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '8px',
          }}
        >
          {/* 跳过按钮 */}
          <button
            onClick={onSkip}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--cine-text-3, #5A5B57)',
              background: 'transparent',
              border: '1px solid var(--cine-line-2, rgba(255,255,255,0.09))',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
              e.currentTarget.style.color = 'var(--cine-text-2, #8C8B85)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--cine-line-2, rgba(255,255,255,0.09))'
              e.currentTarget.style.color = 'var(--cine-text-3, #5A5B57)'
            }}
          >
            跳过
          </button>

          {/* 知道了按钮 */}
          <button
            onClick={onNext}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--cine-ink, #1A1408)',
              background: 'var(--cine-gold, #C7A877)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 0 20px rgba(199,168,119,0.15)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--cine-gold-2, #B89765)'
              e.currentTarget.style.boxShadow = '0 0 30px rgba(199,168,119,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--cine-gold, #C7A877)'
              e.currentTarget.style.boxShadow = '0 0 20px rgba(199,168,119,0.15)'
            }}
          >
            知道了
          </button>
        </div>
      </div>

      {/* 指向目标元素的小三角箭头 */}
      <TooltipArrow position={position} />
    </div>
  )

  // 使用 Portal 渲染在 document.body 层级
  return createPortal(tooltipContent, document.body)
}

// ========================
// 箭头子组件
// ========================

interface TooltipArrowProps {
  position: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Tooltip 指向目标元素的小三角箭头
 */
function TooltipArrow({ position }: TooltipArrowProps) {
  const arrowSize = 8
  const color = 'var(--cine-surface, #141619)'

  // 根据 position 确定箭头方向（箭头指向目标元素）
  const arrowStyles: React.CSSProperties = (() => {
    const base: React.CSSProperties = {
      position: 'absolute',
      width: 0,
      height: 0,
      borderStyle: 'solid',
    }

    switch (position) {
      case 'top':
        // tooltip 在上方，箭头在底部指向下方
        return {
          ...base,
          bottom: -arrowSize,
          left: '50%',
          transform: 'translateX(-50%)',
          borderWidth: `${arrowSize}px ${arrowSize}px 0 ${arrowSize}px`,
          borderColor: `${color} transparent transparent transparent`,
        }
      case 'bottom':
        // tooltip 在下方，箭头在顶部指向上方
        return {
          ...base,
          top: -arrowSize,
          left: '50%',
          transform: 'translateX(-50%)',
          borderWidth: `0 ${arrowSize}px ${arrowSize}px ${arrowSize}px`,
          borderColor: `transparent transparent ${color} transparent`,
        }
      case 'left':
        // tooltip 在左侧，箭头在右侧指向右方
        return {
          ...base,
          top: '50%',
          right: -arrowSize,
          transform: 'translateY(-50%)',
          borderWidth: `${arrowSize}px 0 ${arrowSize}px ${arrowSize}px`,
          borderColor: `transparent transparent transparent ${color}`,
        }
      case 'right':
        // tooltip 在右侧，箭头在左侧指向左方
        return {
          ...base,
          top: '50%',
          left: -arrowSize,
          transform: 'translateY(-50%)',
          borderWidth: `${arrowSize}px ${arrowSize}px ${arrowSize}px 0`,
          borderColor: `transparent ${color} transparent transparent`,
        }
    }
  })()

  return <div style={arrowStyles} aria-hidden="true" />
}
