/**
 * 单元测试：frame-continuity 核心模块
 *
 * 覆盖场景：
 * - getPrevGroupVideoUrl：前一组存在且成功 / 第一组无前序 / 前一组未成功
 * - normScene：大小写/空格/null/undefined 标准化（@deprecated 但仍导出）
 * - applySameSceneContinuation：废弃方法始终返回 applied=false，透传参数
 * - VIDEO_CONTINUATION_PROMPT_SUFFIX：包含承接指令关键词
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========================
// Mock prisma — 精确模拟 shotGroup.findFirst
// ========================
const mockFindFirst = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    shotGroup: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}))

// 动态 import，确保 mock 在 import 之前生效
const {
  getPrevGroupVideoUrl,
  VIDEO_CONTINUATION_PROMPT_SUFFIX,
  normScene,
  applySameSceneContinuation,
} = await import('@/lib/video/frame-continuity')

// ========================
// 每个测试前重置 mock
// ========================
beforeEach(() => {
  mockFindFirst.mockReset()
})

// ========================
// getPrevGroupVideoUrl
// ========================
describe('getPrevGroupVideoUrl', () => {
  it('前一组存在且生成成功时返回其 genVideoUrl', async () => {
    const fakeUrl = 'https://oss.example.com/video/prev-group.mp4'
    mockFindFirst.mockResolvedValue({ genVideoUrl: fakeUrl })

    const result = await getPrevGroupVideoUrl('project-1', 3)

    expect(result).toBe(fakeUrl)
    // 验证查询条件
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        groupIndex: { lt: 3 },
        genStatus: 'SUCCEEDED',
        genVideoUrl: { not: null },
      },
      orderBy: { groupIndex: 'desc' },
      select: { genVideoUrl: true },
    })
  })

  it('当前是第一组（groupIndex=0）时无前序，返回 null', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await getPrevGroupVideoUrl('project-1', 0)

    expect(result).toBeNull()
  })

  it('前一组未成功（genStatus != SUCCEEDED）时返回 null', async () => {
    // 查询结果为 null 代表不存在符合条件的记录
    mockFindFirst.mockResolvedValue(null)

    const result = await getPrevGroupVideoUrl('project-2', 2)

    expect(result).toBeNull()
  })

  it('前一组 genVideoUrl 为 null 时返回 null', async () => {
    mockFindFirst.mockResolvedValue({ genVideoUrl: null })

    const result = await getPrevGroupVideoUrl('project-3', 1)

    expect(result).toBeNull()
  })
})

// ========================
// normScene（@deprecated，但仍需保证编译兼容行为正确）
// ========================
describe('normScene', () => {
  it('标准化为小写', () => {
    expect(normScene('Kitchen')).toBe('kitchen')
    expect(normScene('OUTDOOR')).toBe('outdoor')
  })

  it('移除所有空格', () => {
    expect(normScene('living room')).toBe('livingroom')
    expect(normScene('  coffee  shop  ')).toBe('coffeeshop')
  })

  it('大小写 + 空格组合标准化', () => {
    expect(normScene('Living Room')).toBe('livingroom')
    expect(normScene(' Dark  Alley ')).toBe('darkalley')
  })

  it('null 输入返回空字符串', () => {
    expect(normScene(null)).toBe('')
  })

  it('undefined 输入返回空字符串', () => {
    expect(normScene(undefined)).toBe('')
  })

  it('空字符串输入返回空字符串', () => {
    expect(normScene('')).toBe('')
  })

  it('纯空格输入返回空字符串', () => {
    expect(normScene('   ')).toBe('')
  })

  it('中文场景名正确处理（不含空格时大小写无影响）', () => {
    expect(normScene('客厅')).toBe('客厅')
    expect(normScene(' 咖啡 厅 ')).toBe('咖啡厅')
  })
})

// ========================
// applySameSceneContinuation（@deprecated，始终返回 applied=false）
// ========================
describe('applySameSceneContinuation', () => {
  it('同场景条件下仍返回 applied=false（方法已废弃）', async () => {
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: ['img1.jpg', 'img2.jpg'],
      prompt: '一个男人走进咖啡厅',
    })

    expect(result.applied).toBe(false)
  })

  it('跨场景条件下同样返回 applied=false', async () => {
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: null,
      referenceImages: ['img1.jpg'],
      prompt: '室外街道',
    })

    expect(result.applied).toBe(false)
  })

  it('前一组无尾帧（lastFrameUrl=null）时返回 applied=false', async () => {
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: null,
      referenceImages: ['img1.jpg', 'img2.jpg', 'img3.jpg'],
      prompt: '厨房场景',
    })

    expect(result.applied).toBe(false)
  })

  it('透传 referenceImages 不做修改', async () => {
    const images = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: images,
      prompt: '测试',
    })

    expect(result.referenceImages).toEqual(images)
    expect(result.referenceImages.length).toBe(5)
  })

  it('referenceImages 数量为 9 张时仍直接透传', async () => {
    const images = Array.from({ length: 9 }, (_, i) => `img-${i}.jpg`)
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: images,
      prompt: '测试',
    })

    // 废弃方法直接透传，不裁切
    expect(result.referenceImages).toHaveLength(9)
    expect(result.referenceImages).toEqual(images)
  })

  it('referenceImages 超过 9 张时仍直接透传（废弃方法不限制）', async () => {
    const images = Array.from({ length: 12 }, (_, i) => `img-${i}.jpg`)
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: images,
      prompt: '测试',
    })

    expect(result.referenceImages).toHaveLength(12)
  })

  it('透传 prompt 不做修改', async () => {
    const prompt = '一个女孩在公园跑步'
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: [],
      prompt,
    })

    expect(result.prompt).toBe(prompt)
  })

  it('referenceImages 为空数组时透传空数组', async () => {
    const result = await applySameSceneContinuation({
      prevGroupId: 'group-1',
      currentGroupId: 'group-2',
      lastFrameUrl: 'https://oss.example.com/frame.jpg',
      referenceImages: [],
      prompt: '测试',
    })

    expect(result.referenceImages).toEqual([])
  })
})

// ========================
// VIDEO_CONTINUATION_PROMPT_SUFFIX
// ========================
describe('VIDEO_CONTINUATION_PROMPT_SUFFIX', () => {
  it('包含"续接"承接指令关键词', () => {
    expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('续接')
  })

  it('包含"连贯性"关键词', () => {
    expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('连贯性')
  })

  it('包含"上一组"引用指令', () => {
    expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('上一组')
  })

  it('是非空字符串', () => {
    expect(VIDEO_CONTINUATION_PROMPT_SUFFIX.trim().length).toBeGreaterThan(0)
  })
})
