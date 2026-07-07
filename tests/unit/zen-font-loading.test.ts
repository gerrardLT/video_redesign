import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * zen-editorial-ui-overhaul · 字体加载验证测试（Task 10.3）
 *
 * Validates Requirement 1.1（next/font/google 加载三字体族）+ Property 3。
 *
 * 为什么用源码静态分析而非 document.fonts.check：next/font 在构建期注入字体，
 * 运行期校验需真实浏览器 + 网络下载 woff2，环境依赖重且不稳定。
 * 字体「以正确 weight/variable 被声明加载」这一契约由 layout.tsx 源码决定，
 * 静态断言其 import 与配置即可确定性验证 Req 1.1。
 */

let layout = ''

beforeAll(() => {
  layout = readFileSync(resolve(process.cwd(), 'src/app/merchant/layout.tsx'), 'utf-8')
})

describe('zen-editorial · 字体加载（Req 1.1 / Property 3）', () => {
  it('从 next/font/google 引入 Noto Serif SC / Noto Sans SC / Space Grotesk', () => {
    expect(layout).toMatch(/from\s+['"]next\/font\/google['"]/)
    expect(layout).toContain('Noto_Serif_SC')
    expect(layout).toContain('Noto_Sans_SC')
    expect(layout).toContain('Space_Grotesk')
  })

  it('Noto Serif SC 加载 500/600/700 weight 并绑定 --font-noto-serif-sc', () => {
    const block = layout.slice(layout.indexOf('Noto_Serif_SC('))
    expect(block).toMatch(/weight:\s*\[\s*'500',\s*'600',\s*'700'\s*\]/)
    expect(block).toMatch(/variable:\s*'--font-noto-serif-sc'/)
  })

  it('Noto Sans SC 加载 400/500/700 weight 并绑定 --font-noto-sans-sc', () => {
    const block = layout.slice(layout.indexOf('Noto_Sans_SC('))
    expect(block).toMatch(/weight:\s*\[\s*'400',\s*'500',\s*'700'\s*\]/)
    expect(block).toMatch(/variable:\s*'--font-noto-sans-sc'/)
  })

  it('Space Grotesk 加载 400/500/600/700 weight 并绑定 --font-space-grotesk', () => {
    const block = layout.slice(layout.indexOf('Space_Grotesk('))
    expect(block).toMatch(/weight:\s*\[\s*'400',\s*'500',\s*'600',\s*'700'\s*\]/)
    expect(block).toMatch(/variable:\s*'--font-space-grotesk'/)
  })

  it('三字体均使用 display: swap（加载失败时回退可见，降级策略）', () => {
    const swaps = layout.match(/display:\s*'swap'/g) ?? []
    expect(swaps.length).toBeGreaterThanOrEqual(3)
  })

  it('三字体的 CSS variable class 注入到 .ll-root 容器', () => {
    expect(layout).toMatch(/ll-root[^"'`]*notoSerif\.variable/)
    expect(layout).toContain('notoSans.variable')
    expect(layout).toContain('spaceGrotesk.variable')
  })
})
