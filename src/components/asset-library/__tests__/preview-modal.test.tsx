// @vitest-environment jsdom

/**
 * Preview_Modal 组件测试
 *
 * 测试预览模态框的核心交互行为：
 * - 打开/关闭（asset 为 null 时不渲染内容）
 * - 缩放按钮交互（放大/缩小/重置）
 * - 图片加载失败显示错误占位
 * - 下载按钮触发回调
 *
 * Requirements: 1.1, 1.4, 1.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PreviewModal } from '../preview-modal'
import type { AssetLibraryItem } from '../asset-grid'

// Mock asset 数据
const mockAsset: AssetLibraryItem = {
  id: 'asset-001',
  displayName: '测试角色图.png',
  category: 'CHARACTER',
  type: 'image/png',
  url: '/api/media/test-key.png',
  thumbUrl: '/api/media/test-key-thumb.png',
  projectName: '测试项目',
  fileSize: 2048576, // ~2MB
  createdAt: '2025-06-10T08:30:00Z',
}

describe('PreviewModal', () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>
  let onDownload: ReturnType<typeof vi.fn<(assetId: string) => void>>

  beforeEach(() => {
    onClose = vi.fn<() => void>()
    onDownload = vi.fn<(assetId: string) => void>()
  })

  describe('打开/关闭行为', () => {
    it('当 asset 为 null 时，不应渲染模态框内容', () => {
      render(
        <PreviewModal asset={null} onClose={onClose} onDownload={onDownload} />
      )

      // 不应该找到资产名称或工具栏
      expect(screen.queryByText('测试角色图.png')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('缩小')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('放大')).not.toBeInTheDocument()
    })

    it('当提供 asset 时，应显示资产名称和元数据', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      // 资产名称
      expect(screen.getByText('测试角色图.png')).toBeInTheDocument()
      // 分类徽章（CHARACTER → 角色）
      expect(screen.getByText('角色')).toBeInTheDocument()
      // 文件大小（2048576 bytes ≈ 2.0 MB）
      expect(screen.getByText('2.0 MB')).toBeInTheDocument()
      // 创建日期（2025-06-10）
      expect(screen.getByText('2025-06-10')).toBeInTheDocument()
    })
  })

  describe('缩放按钮交互', () => {
    it('初始缩放应为 100%', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('点击放大按钮应增加缩放比例', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      const zoomInBtn = screen.getByLabelText('放大')
      act(() => {
        fireEvent.click(zoomInBtn)
      })

      // 初始 100% + 25% 步进 = 125%
      expect(screen.getByText('125%')).toBeInTheDocument()
    })

    it('点击缩小按钮应减少缩放比例', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      const zoomOutBtn = screen.getByLabelText('缩小')
      act(() => {
        fireEvent.click(zoomOutBtn)
      })

      // 初始 100% - 25% 步进 = 75%
      expect(screen.getByText('75%')).toBeInTheDocument()
    })

    it('点击重置按钮应恢复到 100%', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      // 先放大
      const zoomInBtn = screen.getByLabelText('放大')
      act(() => {
        fireEvent.click(zoomInBtn)
        fireEvent.click(zoomInBtn)
      })

      expect(screen.getByText('150%')).toBeInTheDocument()

      // 重置
      const resetBtn = screen.getByLabelText('重置缩放')
      act(() => {
        fireEvent.click(resetBtn)
      })

      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('缩放不应超过最大值 300%', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      const zoomInBtn = screen.getByLabelText('放大')
      // 点击 9 次（100% + 9*25% = 325%，应被限制到 300%）
      act(() => {
        for (let i = 0; i < 9; i++) {
          fireEvent.click(zoomInBtn)
        }
      })

      expect(screen.getByText('300%')).toBeInTheDocument()
    })

    it('缩放不应低于最小值 50%', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      const zoomOutBtn = screen.getByLabelText('缩小')
      // 点击 3 次（100% - 3*25% = 25%，应被限制到 50%）
      act(() => {
        for (let i = 0; i < 3; i++) {
          fireEvent.click(zoomOutBtn)
        }
      })

      expect(screen.getByText('50%')).toBeInTheDocument()
    })
  })

  describe('图片加载失败', () => {
    it('图片加载失败时应显示错误占位和重试按钮', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      // 触发图片 onError 事件
      const img = screen.getByAltText('测试角色图.png')
      act(() => {
        fireEvent.error(img)
      })

      // 应显示错误占位消息
      expect(screen.getByText('图片加载失败')).toBeInTheDocument()
      // 应显示重试按钮
      expect(screen.getByText('重试')).toBeInTheDocument()
    })

    it('点击重试按钮应重新尝试加载图片', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      // 触发图片加载失败
      const img = screen.getByAltText('测试角色图.png')
      act(() => {
        fireEvent.error(img)
      })

      // 点击重试
      const retryBtn = screen.getByText('重试')
      act(() => {
        fireEvent.click(retryBtn)
      })

      // 错误信息应消失，图片应重新渲染（通过 _retry 参数变化触发重加载）
      expect(screen.queryByText('图片加载失败')).not.toBeInTheDocument()
      // 图片应重新出现
      const newImg = screen.getByAltText('测试角色图.png')
      expect(newImg).toBeInTheDocument()
      // URL 应包含 _retry 参数
      expect(newImg.getAttribute('src')).toContain('_retry=1')
    })
  })

  describe('下载按钮', () => {
    it('点击下载按钮应调用 onDownload 并传入 asset ID', () => {
      render(
        <PreviewModal asset={mockAsset} onClose={onClose} onDownload={onDownload} />
      )

      const downloadBtn = screen.getByLabelText('下载')
      act(() => {
        fireEvent.click(downloadBtn)
      })

      expect(onDownload).toHaveBeenCalledOnce()
      expect(onDownload).toHaveBeenCalledWith('asset-001')
    })
  })
})
