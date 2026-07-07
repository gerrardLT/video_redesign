import { describe, it, expect, vi } from 'vitest'

// Mock db 模块，避免 DATABASE_URL 缺失导致的初始化错误
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))

import { getPromptExcerpt } from '@/lib/video/version-history-service'

/**
 * getPromptExcerpt 单元测试
 *
 * 验证 prompt 摘要截断逻辑：
 * - null/空字符串返回 "(无提示词)"
 * - 长度 ≤ 30 返回原文
 * - 长度 > 30 截断并追加 "..."
 *
 * Requirements: 3.2
 */
describe('getPromptExcerpt', () => {
  it('null 输入返回 "(无提示词)"', () => {
    expect(getPromptExcerpt(null)).toBe('(无提示词)')
  })

  it('空字符串返回 "(无提示词)"', () => {
    expect(getPromptExcerpt('')).toBe('(无提示词)')
  })

  it('长度等于 30 的字符串返回原文', () => {
    const prompt = 'a'.repeat(30)
    expect(getPromptExcerpt(prompt)).toBe(prompt)
  })

  it('长度小于 30 的字符串返回原文', () => {
    const prompt = '短提示词'
    expect(getPromptExcerpt(prompt)).toBe(prompt)
  })

  it('长度超过 30 的字符串截断并追加 "..."', () => {
    const prompt = 'a'.repeat(31)
    expect(getPromptExcerpt(prompt)).toBe('a'.repeat(30) + '...')
  })

  it('中文长字符串正确截断', () => {
    const prompt = '这是一段超过三十个字符的中文提示词用来测试截断逻辑是否正确工作'
    expect(getPromptExcerpt(prompt)).toBe(prompt.slice(0, 30) + '...')
    expect(getPromptExcerpt(prompt).length).toBe(33) // 30 + "..."
  })
})
