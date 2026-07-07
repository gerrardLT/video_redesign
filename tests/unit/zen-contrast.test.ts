import { describe, it, expect } from 'vitest'

/**
 * zen-editorial-ui-overhaul · WCAG AA 对比度验证测试（Task 10.2）
 *
 * Validates Correctness Property 2 / Requirements 15.1, 15.2, 15.3。
 *
 * 为什么用计算而非 Playwright：对比度是由设计 token 的固定色值决定的纯函数，
 * 用 WebAIM/WCAG 标准算法（相对亮度 + 对比度比值，含 alpha 合成）即可确定性验证，
 * 不依赖浏览器渲染，避免视觉测试的环境依赖与不稳定。
 */

// ── WCAG 2.x 相对亮度与对比度算法（与 WebAIM Contrast Checker 一致） ──

/** sRGB 单通道（0-255）线性化 */
function linearize(channel8: number): number {
  const c = channel8 / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** 相对亮度 L */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** 对比度比值（lighter+0.05)/(darker+0.05) */
function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** 半透明前景色按 alpha 合成到不透明背景上，得到实际渲染的不透明色 */
function compositeOver(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number]
): [number, number, number] {
  return [
    Math.round(alpha * fg[0] + (1 - alpha) * bg[0]),
    Math.round(alpha * fg[1] + (1 - alpha) * bg[1]),
    Math.round(alpha * fg[2] + (1 - alpha) * bg[2]),
  ]
}

// ── v3 Zen 设计 token 色值（与 globals.css .ll-root 一致） ──
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]
const GREEN: [number, number, number] = [0x00, 0x75, 0x4a] // #00754A 大地绿主色
const CANVAS: [number, number, number] = [0xf4, 0xf2, 0xed] // #F4F2ED 暖奶油画布

describe('zen-editorial · WCAG AA 对比度（Property 2 / Req 15.1-15.3）', () => {
  // Req 15.1：主按钮白字 #FFFFFF 在绿底 #00754A 上 ≥ 4.5:1
  it('白字 #FFFFFF on 绿底 #00754A ≥ 4.5:1', () => {
    const ratio = contrastRatio(WHITE, GREEN)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  // Req 15.2：主文字 rgba(0,0,0,.87) 在暖奶油底 #F4F2ED 上 ≥ 4.5:1
  it('主文字 rgba(0,0,0,.87) on 画布 #F4F2ED ≥ 4.5:1', () => {
    const composed = compositeOver(BLACK, 0.87, CANVAS)
    const ratio = contrastRatio(composed, CANVAS)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  // Req 15.3：次级文字 rgba(0,0,0,.58) 在暖奶油底 #F4F2ED 上 ≥ 4.5:1
  it('次级文字 rgba(0,0,0,.58) on 画布 #F4F2ED ≥ 4.5:1', () => {
    const composed = compositeOver(BLACK, 0.58, CANVAS)
    const ratio = contrastRatio(composed, CANVAS)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  // 三级文字 rgba(0,0,0,.40) on #F4F2ED 实测 ≈ 2.82:1，低于 3:1。
  // 结论（修正设计文档 Testing Strategy 中「≥3:1」的不准确说法）：
  // --ll-text-3 不满足任何 WCAG AA 阈值，必须仅用于占位符 / 装饰性微标签（10-11px aux），
  // 不得用于承载实质信息的正文，避免可读性问题。Req 15 未将其纳入强制对比度范围。
  it('三级文字 rgba(0,0,0,.40) on 画布 #F4F2ED 实测 ≈ 2.82:1（仅限装饰，禁用于正文）', () => {
    const composed = compositeOver(BLACK, 0.4, CANVAS)
    const ratio = contrastRatio(composed, CANVAS)
    expect(ratio).toBeCloseTo(2.82, 1)
    // 显式记录其不达 AA：守护未来若误用为正文色将被此断言提示
    expect(ratio).toBeLessThan(4.5)
  })

  // 算法自检：纯黑/纯白对比度应为 21:1（标准值），确保算法实现正确
  it('算法自检：黑白对比度 = 21:1', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1)
  })
})
