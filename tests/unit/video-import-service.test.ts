import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Feature: product-competitiveness
 * 视频导入服务单元测试
 *
 * 测试链接导入后创建下载任务、轮询进度、下载失败错误信息
 * **Validates: Requirements 1.2, 1.3, 1.7**
 */

// ========================
// Mock Prisma 和队列
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    project: {
      create: vi.fn(),
    },
    videoDownloadTask: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/shared/queue', () => ({
  videoDownloadQueue: {
    add: vi.fn(),
  },
}))

// 使用动态导入以确保 mock 生效
const { prisma } = await import('@/lib/shared/db')
const { videoDownloadQueue } = await import('@/lib/shared/queue')
const { validateShareLink, validateAndImport, getImportStatus } = await import(
  '@/lib/shared/video-import-service'
)

// ========================
// 测试
// ========================

describe('视频导入服务单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validateShareLink', () => {
    it('有效的抖音链接返回 valid: true, platform: douyin', () => {
      const result = validateShareLink('https://v.douyin.com/abc12345')
      expect(result.valid).toBe(true)
      expect(result.platform).toBe('douyin')
    })

    it('有效的快手链接返回 valid: true, platform: kuaishou', () => {
      const result = validateShareLink('https://v.kuaishou.com/xyz789')
      expect(result.valid).toBe(true)
      expect(result.platform).toBe('kuaishou')
    })

    it('有效的微信视频号链接返回 valid: true, platform: weixin', () => {
      const result = validateShareLink('https://channels.weixin.qq.com/abc123def')
      expect(result.valid).toBe(true)
      expect(result.platform).toBe('weixin')
    })

    it('空字符串返回错误', () => {
      const result = validateShareLink('')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('请输入')
    })

    it('非 URL 格式返回错误', () => {
      const result = validateShareLink('not-a-url')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('未识别到视频链接')
    })

    it('未匹配已知平台的 URL 标记为 other 并放行', () => {
      const result = validateShareLink('https://www.youtube.com/watch?v=abc')
      expect(result.valid).toBe(true)
      expect(result.platform).toBe('other')
    })
  })

  describe('validateAndImport', () => {
    it('有效链接创建 Project 和 VideoDownloadTask 并入队', async () => {
      const mockProject = { id: 'proj-1', userId: 'user-1', name: '导入视频 - douyin', status: 'DOWNLOADING' }
      const mockTask = { id: 'task-1', projectId: 'proj-1', userId: 'user-1', sourceUrl: 'https://v.douyin.com/abc123', platform: 'douyin', status: 'PENDING', progress: 0 }

      vi.mocked(prisma.project.create).mockResolvedValue(mockProject as never)
      vi.mocked(prisma.videoDownloadTask.create).mockResolvedValue(mockTask as never)
      vi.mocked(videoDownloadQueue.add).mockResolvedValue({} as never)

      const result = await validateAndImport('user-1', 'https://v.douyin.com/abc123')

      expect(result.projectId).toBe('proj-1')
      expect(result.taskId).toBe('task-1')
      expect(result.platform).toBe('douyin')

      // 验证 Project 创建时 status 为 DOWNLOADING
      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DOWNLOADING' }),
        })
      )

      // 验证入队
      expect(videoDownloadQueue.add).toHaveBeenCalledWith(
        'download-video',
        expect.objectContaining({
          taskId: 'task-1',
          projectId: 'proj-1',
          platform: 'douyin',
        })
      )
    })

    it('无效链接抛出错误', async () => {
      await expect(
        validateAndImport('user-1', 'not-a-valid-link')
      ).rejects.toThrow()
    })

    it('YouTube 链接作为 other 平台导入成功', async () => {
      const mockProject = { id: 'proj-yt', userId: 'user-1', name: '导入视频 - other', status: 'DOWNLOADING' }
      const mockTask = { id: 'task-yt', projectId: 'proj-yt', userId: 'user-1', sourceUrl: 'https://www.youtube.com/watch?v=abc', platform: 'other', status: 'PENDING', progress: 0 }

      vi.mocked(prisma.project.create).mockResolvedValue(mockProject as never)
      vi.mocked(prisma.videoDownloadTask.create).mockResolvedValue(mockTask as never)
      vi.mocked(videoDownloadQueue.add).mockResolvedValue({} as never)

      const result = await validateAndImport('user-1', 'https://www.youtube.com/watch?v=abc')

      expect(result.projectId).toBe('proj-yt')
      expect(result.taskId).toBe('task-yt')
      expect(result.platform).toBe('other')
    })
  })

  describe('getImportStatus', () => {
    it('返回下载任务的进度信息', async () => {
      const mockTask = {
        id: 'task-1',
        status: 'DOWNLOADING',
        progress: 45,
        errorMsg: null,
        platform: 'douyin',
        createdAt: new Date(),
      }

      vi.mocked(prisma.videoDownloadTask.findFirst).mockResolvedValue(mockTask as never)

      const result = await getImportStatus('proj-1', 'user-1')

      expect(result).not.toBeNull()
      expect(result!.taskId).toBe('task-1')
      expect(result!.status).toBe('DOWNLOADING')
      expect(result!.progress).toBe(45)
      expect(result!.platform).toBe('douyin')
    })

    it('无任务时返回 null', async () => {
      vi.mocked(prisma.videoDownloadTask.findFirst).mockResolvedValue(null)

      const result = await getImportStatus('proj-nonexist', 'user-1')

      expect(result).toBeNull()
    })

    it('下载失败时返回错误信息', async () => {
      const mockTask = {
        id: 'task-1',
        status: 'FAILED',
        progress: 0,
        errorMsg: '视频下载超时，请稍后重试',
        platform: 'kuaishou',
        createdAt: new Date(),
      }

      vi.mocked(prisma.videoDownloadTask.findFirst).mockResolvedValue(mockTask as never)

      const result = await getImportStatus('proj-1', 'user-1')

      expect(result).not.toBeNull()
      expect(result!.status).toBe('FAILED')
      expect(result!.errorMsg).toContain('超时')
    })
  })
})
