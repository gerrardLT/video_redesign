import { describe, it, expect } from 'vitest'
import ExpiryBadge from '@/components/asset/expiry-badge'

/**
 * ExpiryBadge 组件单元测试
 * 验证四种过期状态的样式和文案渲染是否正确
 *
 * Validates: Requirements 3.5
 */
describe('ExpiryBadge 组件渲染', () => {
  it('permanent 状态渲染绿色"永久"标签', () => {
    const result = ExpiryBadge({ status: 'permanent', remainingDays: null })
    expect(result).not.toBeNull()
    // 验证绿色样式（使用 cine-green 变量）
    expect(result!.props.className).toContain('cine-green')
    // 验证文案为"永久"
    expect(result!.props.children).toBe('永久')
  })

  it('expiring_soon 状态渲染红色"{N}天后过期"标签', () => {
    const result = ExpiryBadge({ status: 'expiring_soon', remainingDays: 3 })
    expect(result).not.toBeNull()
    // 验证红色样式
    expect(result!.props.className).toContain('red')
    // 验证文案包含天数和"天后过期"
    const children = result!.props.children
    expect(children).toContain(3)
    expect(children).toContain('天后过期')
  })

  it('active 状态渲染默认"剩余{N}天"标签', () => {
    const result = ExpiryBadge({ status: 'active', remainingDays: 10 })
    expect(result).not.toBeNull()
    // 验证使用 cine-text-secondary 中性样式
    expect(result!.props.className).toContain('cine-text-secondary')
    // 验证文案包含"剩余"和天数
    const children = result!.props.children
    expect(children).toContain('剩余')
    expect(children).toContain(10)
    expect(children).toContain('天')
  })

  it('expired 状态渲染灰色"已过期"标签', () => {
    const result = ExpiryBadge({ status: 'expired', remainingDays: null })
    expect(result).not.toBeNull()
    // 验证灰色样式
    expect(result!.props.className).toContain('gray')
    // 验证文案为"已过期"
    expect(result!.props.children).toBe('已过期')
  })

  it('permanent 状态 remainingDays 为 null 时不显示天数', () => {
    const result = ExpiryBadge({ status: 'permanent', remainingDays: null })
    expect(result).not.toBeNull()
    const children = result!.props.children
    // 永久状态只显示"永久"，不包含天数
    expect(children).toBe('永久')
    expect(children).not.toContain('天')
  })

  it('expired 状态 remainingDays 为 null 时不显示天数', () => {
    const result = ExpiryBadge({ status: 'expired', remainingDays: null })
    expect(result).not.toBeNull()
    const children = result!.props.children
    // 已过期状态只显示"已过期"，不包含天数数字
    expect(children).toBe('已过期')
  })
})
