import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * zen-editorial-ui-overhaul · prefers-reduced-motion 降级验证测试（Task 10.4）
 *
 * Validates Requirement 5.5（动效降级）。
 *
 * 为什么用静态分析：媒体查询的降级行为由 globals.css 中的 @media 规则静态决定，
 * 真实浏览器模拟 reduced-motion 需运行 dev server。断言降级规则存在且关闭了
 * .zen-reveal 动画与噪点纹理，即可确定性验证 Req 5.5。
 */

let css = ''

/** 提取 prefers-reduced-motion 媒体查询块（可能有多处，合并返回） */
function reducedMotionBlocks(source: string): string {
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g
  let combined = ''
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const braceStart = m.index + m[0].length - 1
    let depth = 0
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          combined += source.slice(braceStart + 1, i) + '\n'
          break
        }
      }
    }
  }
  return combined
}

beforeAll(() => {
  css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf-8')
})

describe('zen-editorial · prefers-reduced-motion 降级（Req 5.5）', () => {
  it('存在 @media (prefers-reduced-motion: reduce) 降级规则', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('reduced-motion 下关闭 .zen-reveal 入场动画', () => {
    const block = reducedMotionBlocks(css)
    expect(block).toContain('.zen-reveal')
    expect(block).toMatch(/animation:\s*none/)
    // 关闭后内容须保持可见（opacity 复位 + transform 复位）
    expect(block).toMatch(/opacity:\s*1/)
    expect(block).toMatch(/transform:\s*none/)
  })

  it('reduced-motion 下隐藏 .ll-root::after 噪点纹理', () => {
    const block = reducedMotionBlocks(css)
    expect(block).toContain('.ll-root::after')
    expect(block).toMatch(/display:\s*none/)
  })
})

describe('zen-editorial · Stagger 入场动效定义（Req 5.2）', () => {
  it('定义 .zen-reveal 与 @keyframes zen-revealIn', () => {
    expect(css).toContain('.zen-reveal')
    expect(css).toContain('@keyframes zen-revealIn')
  })

  it('zen-reveal 子元素延迟覆盖 nth-child(1)~(7)，间隔 60ms', () => {
    for (let i = 1; i <= 7; i++) {
      expect(css).toContain(`.zen-reveal:nth-child(${i})`)
    }
    expect(css).toMatch(/\.zen-reveal:nth-child\(2\)\s*\{\s*animation-delay:\s*60ms/)
  })
})
