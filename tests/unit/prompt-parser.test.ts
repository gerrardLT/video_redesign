import { describe, it, expect } from 'vitest'
import { resolveReferences } from '@/lib/video/prompt-parser'

/**
 * 单元测试: resolveReferences
 * 验证 [图N] 引用解析功能的各种场景
 */
describe('resolveReferences', () => {
  const mockShotAssets = [
    { displayNum: 1, asset: { url: 'https://oss.example.com/asset1.jpg' } },
    { displayNum: 2, asset: { url: 'https://oss.example.com/asset2.jpg' } },
    { displayNum: 3, asset: { url: 'https://oss.example.com/asset3.jpg' } },
  ]

  describe('无引用场景', () => {
    it('无 [图N] 引用时返回原始 prompt 和空 resolvedRefs', () => {
      const prompt = 'A woman walks through the park'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe(prompt)
      expect(result.resolvedRefs).toEqual([])
    })

    it('空 prompt 返回空字符串和空 resolvedRefs', () => {
      const result = resolveReferences('', mockShotAssets)

      expect(result.cleanPrompt).toBe('')
      expect(result.resolvedRefs).toEqual([])
    })

    it('包含类似但不匹配的文本不会被误解析', () => {
      const prompt = '图1是一个人 [图片] 第2图'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe(prompt)
      expect(result.resolvedRefs).toEqual([])
    })
  })

  describe('单引用场景', () => {
    it('单个 [图1] 引用返回 cleanPrompt 和 1 个 resolvedRef', () => {
      const prompt = '参考[图1]生成视频'
      const result = resolveReferences(prompt, mockShotAssets)

      // 中文紧邻时移除标记后不会产生空格
      expect(result.cleanPrompt).toBe('参考生成视频')
      expect(result.resolvedRefs).toEqual([
        { displayNum: 1, url: 'https://oss.example.com/asset1.jpg' },
      ])
    })

    it('prompt 开头的引用移除后正确 trim', () => {
      const prompt = '[图2] beautiful sunset scene'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe('beautiful sunset scene')
      expect(result.resolvedRefs).toEqual([
        { displayNum: 2, url: 'https://oss.example.com/asset2.jpg' },
      ])
    })

    it('prompt 末尾的引用移除后正确 trim', () => {
      const prompt = 'a girl dancing [图3]'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe('a girl dancing')
      expect(result.resolvedRefs).toEqual([
        { displayNum: 3, url: 'https://oss.example.com/asset3.jpg' },
      ])
    })
  })

  describe('多引用场景', () => {
    it('多个 [图N] 引用返回排序后的 resolvedRefs', () => {
      const prompt = '参考[图3]和[图1]以及[图2]生成'
      const result = resolveReferences(prompt, mockShotAssets)

      // 中文紧邻时移除标记后不产生空格
      expect(result.cleanPrompt).toBe('参考和以及生成')
      expect(result.resolvedRefs).toEqual([
        { displayNum: 1, url: 'https://oss.example.com/asset1.jpg' },
        { displayNum: 2, url: 'https://oss.example.com/asset2.jpg' },
        { displayNum: 3, url: 'https://oss.example.com/asset3.jpg' },
      ])
    })

    it('连续的引用标记之间不会产生多余空格', () => {
      const prompt = '[图1][图2][图3] dancing in the rain'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe('dancing in the rain')
      expect(result.resolvedRefs).toHaveLength(3)
    })
  })

  describe('无效引用场景', () => {
    it('displayNum 不存在于 shotAssets 的引用被跳过', () => {
      const prompt = '参考[图1]和[图5]生成'
      const result = resolveReferences(prompt, mockShotAssets)

      // [图5] 不在 shotAssets 中，被跳过
      expect(result.resolvedRefs).toEqual([
        { displayNum: 1, url: 'https://oss.example.com/asset1.jpg' },
      ])
      // cleanPrompt 仍移除所有 [图N] 标记
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)
    })

    it('所有引用都无效时 resolvedRefs 为空', () => {
      const prompt = '参考[图10][图20]生成'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.resolvedRefs).toEqual([])
      expect(result.cleanPrompt).toBe('参考生成')
    })

    it('shotAssets 为空数组时所有引用都无效', () => {
      const prompt = '参考[图1]生成'
      const result = resolveReferences(prompt, [])

      expect(result.resolvedRefs).toEqual([])
      expect(result.cleanPrompt).toBe('参考生成')
    })
  })

  describe('重复引用场景', () => {
    it('重复的 [图1][图1] 去重为单个结果', () => {
      const prompt = '参考[图1]风格，再看[图1]'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.resolvedRefs).toEqual([
        { displayNum: 1, url: 'https://oss.example.com/asset1.jpg' },
      ])
      expect(result.cleanPrompt).toBe('参考风格，再看')
    })

    it('多次出现的不同引用各只保留一份', () => {
      const prompt = '[图1][图2][图1][图2][图3]'
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.resolvedRefs).toHaveLength(3)
      expect(result.resolvedRefs.map(r => r.displayNum)).toEqual([1, 2, 3])
    })
  })

  describe('cleanPrompt 空格处理', () => {
    it('移除标记后多余空格合并为单个', () => {
      const prompt = 'a  [图1]  b  [图2]  c'
      const result = resolveReferences(prompt, mockShotAssets)

      // 所有多余空格被合并
      expect(result.cleanPrompt).toBe('a b c')
    })

    it('首尾空格被 trim 掉', () => {
      const prompt = '  [图1] hello world [图2]  '
      const result = resolveReferences(prompt, mockShotAssets)

      expect(result.cleanPrompt).toBe('hello world')
    })
  })
})
