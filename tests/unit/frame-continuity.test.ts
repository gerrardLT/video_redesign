import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 单元测试: frame-continuity
 * 验证分镜组视频衔接模块的核心逻辑：
 * - getPrevGroupVideoUrl: 查询前一组已成功生成的视频 URL
 * - VIDEO_CONTINUATION_PROMPT_SUFFIX: 承接 prompt 后缀常量
 * - normScene: 废弃但仍导出的场景标准化函数
 * - applySameSceneContinuation: 废弃但仍导出的旧承接函数
 */

// mock prisma
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    shotGroup: {
      findFirst: vi.fn(),
    },
  },
}))

import {
  getPrevGroupVideoUrl,
  VIDEO_CONTINUATION_PROMPT_SUFFIX,
  normScene,
  applySameSceneContinuation,
} from '@/lib/video/frame-continuity'
import { prisma } from '@/lib/shared/db'

const mockFindFirst = prisma.shotGroup.findFirst as ReturnType<typeof vi.fn>

describe('frame-continuity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ========================
  // getPrevGroupVideoUrl
  // ========================
  describe('getPrevGroupVideoUrl', () => {
    it('前一组已成功且有视频URL时，返回该URL', async () => {
      mockFindFirst.mockResolvedValue({
        genVideoUrl: 'https://oss.example.com/prev-group-video.mp4',
      })

      const url = await getPrevGroupVideoUrl('proj-1', 2)

      expect(url).toBe('https://oss.example.com/prev-group-video.mp4')
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          groupIndex: { lt: 2 },
          genStatus: 'SUCCEEDED',
          genVideoUrl: { not: null },
        },
        orderBy: { groupIndex: 'desc' },
        select: { genVideoUrl: true },
      })
    })

    it('第一组（无前序组）时返回 null', async () => {
      mockFindFirst.mockResolvedValue(null)

      const url = await getPrevGroupVideoUrl('proj-1', 0)

      expect(url).toBeNull()
    })

    it('前一组未成功（genStatus != SUCCEEDED）时返回 null', async () => {
      // 查询条件已过滤 genStatus=SUCCEEDED，找不到匹配记录
      mockFindFirst.mockResolvedValue(null)

      const url = await getPrevGroupVideoUrl('proj-1', 3)

      expect(url).toBeNull()
    })

    it('前一组无视频URL（genVideoUrl 为 null）时返回 null', async () => {
      // 查询条件已过滤 genVideoUrl: { not: null }，找不到匹配记录
      mockFindFirst.mockResolvedValue(null)

      const url = await getPrevGroupVideoUrl('proj-1', 2)

      expect(url).toBeNull()
    })

    it('多组存在时返回最近的前一组（groupIndex 降序取第一条）', async () => {
      mockFindFirst.mockResolvedValue({
        genVideoUrl: 'https://oss.example.com/group-4-video.mp4',
      })

      const url = await getPrevGroupVideoUrl('proj-1', 5)

      expect(url).toBe('https://oss.example.com/group-4-video.mp4')
      // 验证 orderBy 为 desc，确保取最近的
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { groupIndex: 'desc' },
        })
      )
    })
  })

  // ========================
  // VIDEO_CONTINUATION_PROMPT_SUFFIX
  // ========================
  describe('VIDEO_CONTINUATION_PROMPT_SUFFIX', () => {
    it('包含视频承接指令关键词', () => {
      expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('上一组镜头')
      expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('自然续接')
      expect(VIDEO_CONTINUATION_PROMPT_SUFFIX).toContain('连贯性')
    })

    it('以换行开头（用于追加到 prompt 末尾）', () => {
      expect(VIDEO_CONTINUATION_PROMPT_SUFFIX.startsWith('\n')).toBe(true)
    })
  })

  // ========================
  // normScene（废弃但仍导出）
  // ========================
  describe('normScene（deprecated）', () => {
    it('去除两端空格', () => {
      expect(normScene('  咖啡厅  ')).toBe('咖啡厅')
    })

    it('合并中间多个空格', () => {
      expect(normScene('咖啡  厅  内景')).toBe('咖啡厅内景')
    })

    it('统一转小写', () => {
      expect(normScene('CoffeeShop')).toBe('coffeeshop')
    })

    it('大小写+空格组合不影响标准化结果', () => {
      const a = normScene('  Coffee  Shop  ')
      const b = normScene('coffeeshop')
      expect(a).toBe(b)
    })

    it('null/undefined 输入返回空字符串', () => {
      expect(normScene(null)).toBe('')
      expect(normScene(undefined)).toBe('')
    })

    it('空字符串输入返回空字符串', () => {
      expect(normScene('')).toBe('')
    })
  })

  // ========================
  // applySameSceneContinuation（废弃，始终返回 applied=false）
  // ========================
  describe('applySameSceneContinuation（deprecated）', () => {
    it('始终返回 applied=false，不修改参数', async () => {
      const referenceImages = ['https://oss.example.com/img1.jpg']
      const prompt = '一个女孩在咖啡厅喝咖啡'

      const result = await applySameSceneContinuation({
        prevGroupId: 'group-1',
        currentGroupId: 'group-2',
        lastFrameUrl: 'https://oss.example.com/last-frame.jpg',
        referenceImages,
        prompt,
      })

      expect(result.applied).toBe(false)
      expect(result.referenceImages).toEqual(referenceImages)
      expect(result.prompt).toBe(prompt)
    })

    it('即使 lastFrameUrl 存在也不承接', async () => {
      const result = await applySameSceneContinuation({
        prevGroupId: 'group-a',
        currentGroupId: 'group-b',
        lastFrameUrl: 'https://oss.example.com/frame.jpg',
        referenceImages: [],
        prompt: 'test',
      })

      expect(result.applied).toBe(false)
      expect(result.contIndex).toBeUndefined()
    })

    it('lastFrameUrl 为 null 时同样返回 applied=false', async () => {
      const result = await applySameSceneContinuation({
        prevGroupId: 'group-x',
        currentGroupId: 'group-y',
        lastFrameUrl: null,
        referenceImages: ['img1.jpg', 'img2.jpg'],
        prompt: 'prompt text',
      })

      expect(result.applied).toBe(false)
      expect(result.referenceImages).toEqual(['img1.jpg', 'img2.jpg'])
      expect(result.prompt).toBe('prompt text')
    })
  })
})
