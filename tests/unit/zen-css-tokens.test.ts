import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * zen-editorial-ui-overhaul · CSS Token 与作用域隔离验证测试（Task 10.1）
 *
 * Validates Correctness Property 1（作用域隔离不变性）+ Property 3（字体变量可解析）
 * 以及 Requirements 1.2, 5.1, 6.3, 13.1。
 *
 * 为什么用静态分析而非 Playwright getComputedStyle：jsdom 不解析 Tailwind @import，
 * 真实浏览器又需运行 dev server + 登录态。v3 Zen token 是 globals.css 中的静态声明，
 * 通过解析样式表文本即可确定性断言「token 已定义」「3px 圆角仅在 .ll-root 生效」
 * 「:root 默认圆角未被污染」等不变量，验证同样的正确性属性且零环境依赖。
 */

let css = ''

/** 截取某个选择器块 `{ ... }` 的内容（取该选择器首次出现处的第一个花括号块） */
function selectorBlock(source: string, selector: string): string {
  const idx = source.indexOf(selector)
  if (idx === -1) return ''
  const braceStart = source.indexOf('{', idx)
  if (braceStart === -1) return ''
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart + 1, i)
    }
  }
  return ''
}

beforeAll(() => {
  css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf-8')
})

describe('zen-editorial · .ll-root v3 Zen Token 定义（Property 3 / Req 1.2, 5.1, 6.3）', () => {
  it('.ll-root 定义字体变量 --font-serif / --font-sans / --font-num', () => {
    const block = selectorBlock(css, '.ll-root {')
    expect(block).toContain('--font-serif:')
    expect(block).toContain('--font-sans:')
    expect(block).toContain('--font-num:')
    // 字体变量须指向目标字体族（next/font 变量 + 回退族名）
    expect(block).toMatch(/--font-serif:[^;]*Noto Serif SC/)
    expect(block).toMatch(/--font-num:[^;]*Space Grotesk/)
  })

  it('.ll-root 定义动效曲线与时长 token（Req 5.1）', () => {
    const block = selectorBlock(css, '.ll-root {')
    expect(block).toContain('--ease-out:')
    expect(block).toContain('--ease-spring:')
    expect(block).toContain('--dur-fast:')
    expect(block).toContain('--dur-base:')
    expect(block).toContain('--dur-slow:')
    expect(block).toMatch(/--ease-out:\s*cubic-bezier\(\.16,\s*1,\s*\.3,\s*1\)/)
  })

  it('.ll-root 将 --radius 降级为 0.1875rem（3px，Req 6.3）', () => {
    const block = selectorBlock(css, '.ll-root {')
    expect(block).toMatch(/--radius:\s*0\.1875rem/)
  })

  it('.ll-root 画布升级为 #F4F2ED 且定义深绿按下态 --ll-green-deep', () => {
    const block = selectorBlock(css, '.ll-root {')
    expect(block).toMatch(/--ll-canvas:\s*#F4F2ED/i)
    expect(block).toMatch(/--ll-green-deep:\s*#0E3A2A/i)
  })
})

describe('zen-editorial · 作用域隔离不变性（Property 1 / Req 13.1）', () => {
  it(':root 默认 --radius 仍为 0.625rem（未被 3px 污染）', () => {
    const rootBlock = selectorBlock(css, ':root {')
    expect(rootBlock).toMatch(/--radius:\s*0\.625rem/)
    // :root 不得出现 3px 圆角降级
    expect(rootBlock).not.toMatch(/--radius:\s*0\.1875rem/)
  })

  it('v3 Zen 字体/动效 token 不在 :root 泄漏（仅 .ll-root 作用域）', () => {
    const rootBlock = selectorBlock(css, ':root {')
    expect(rootBlock).not.toContain('--font-serif:')
    expect(rootBlock).not.toContain('--ease-out:')
  })

  it('噪点纹理伪元素挂在 .ll-root::after 上（不污染全局）', () => {
    expect(css).toContain('.ll-root::after')
    const block = selectorBlock(css, '.ll-root::after')
    expect(block).toContain('feTurbulence')
    expect(block).toMatch(/opacity:\s*0\.025/)
    expect(block).toContain('pointer-events: none')
  })

  it('视频重塑端 [data-surface="studio"] 独立保留 --cine-* 暗色 token（Req 13.4）', () => {
    const block = selectorBlock(css, '[data-surface="studio"]')
    expect(block).toMatch(/--background:\s*var\(--cine-bg\)/)
    expect(block).toMatch(/--primary:\s*var\(--cine-gold\)/)
  })
})
