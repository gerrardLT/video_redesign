// @vitest-environment jsdom

/**
 * Character_Apply_Dialog 组件测试
 *
 * 测试两级选择流程（项目 → 角色）、覆盖警告显示、加载状态和确认应用行为。
 *
 * Validates: Requirements 3.1, 3.3, 3.7, 6.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CharacterApplyDialog } from '../character-apply-dialog'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// 模拟数据
const mockProjects = [
  { id: 'proj-1', name: '短剧项目A', characterCount: 3, updatedAt: '2025-06-10T10:00:00Z' },
  { id: 'proj-2', name: '口播项目B', characterCount: 1, updatedAt: '2025-06-09T08:00:00Z' },
]

const mockCharacters = [
  { id: 'char-1', name: '主角小明', imageUrl: 'https://oss.example.com/char1.png' },
  { id: 'char-2', name: '配角小红', imageUrl: null },
]

/**
 * 构造 fetch mock，根据 URL 返回不同响应
 */
function createFetchMock(options?: {
  projectsDelay?: number
  charactersDelay?: number
  applySuccess?: boolean
}) {
  const { projectsDelay = 0, charactersDelay = 0, applySuccess = true } = options ?? {}

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    // 项目列表请求（无 projectId 参数）
    if (url.includes('/api/projects/list-with-characters') && !url.includes('projectId=')) {
      if (projectsDelay > 0) {
        await new Promise((r) => setTimeout(r, projectsDelay))
      }
      return new Response(JSON.stringify({ projects: mockProjects }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 角色列表请求（含 projectId 参数）
    if (url.includes('/api/projects/list-with-characters') && url.includes('projectId=')) {
      if (charactersDelay > 0) {
        await new Promise((r) => setTimeout(r, charactersDelay))
      }
      return new Response(JSON.stringify({ characters: mockCharacters }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 应用到角色 API
    if (url.includes('/apply-to-character')) {
      if (applySuccess) {
        return new Response(
          JSON.stringify({
            character: { id: 'char-1', name: '主角小明', imageUrl: 'https://oss.example.com/asset-123.png', projectId: 'proj-1' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ error: '应用失败，请重试' }), { status: 500 })
    }

    return new Response('Not Found', { status: 404 })
  }) as any
}

// 默认 props
const defaultProps = {
  assetId: 'asset-123',
  assetUrl: 'https://oss.example.com/asset-123.png',
  open: true,
  onOpenChange: vi.fn(),
  onSuccess: vi.fn(),
}

describe('Character_Apply_Dialog 组件', () => {
  let fetchMock: ReturnType<typeof createFetchMock>

  beforeEach(() => {
    fetchMock = createFetchMock()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 测试1: 对话框打开时显示加载骨架屏
  it('打开时显示加载骨架屏（项目列表加载中）', async () => {
    // 使用较长延迟确保能捕获到 loading 状态
    global.fetch = createFetchMock({ projectsDelay: 500 })

    render(<CharacterApplyDialog {...defaultProps} />)

    // 对话框标题应该可见
    expect(screen.getByText('应用到角色')).toBeTruthy()
    // 应该显示"选择项目"标签
    expect(screen.getByText('选择项目')).toBeTruthy()
  })

  // 测试2: 项目加载完成后显示项目名称和角色计数
  it('项目加载完成后显示项目名称和角色计数', async () => {
    render(<CharacterApplyDialog {...defaultProps} />)

    // 等待项目列表渲染
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 验证项目名和角色计数都显示
    expect(screen.getByText('短剧项目A')).toBeTruthy()
    expect(screen.getByText('3 个角色')).toBeTruthy()
    expect(screen.getByText('口播项目B')).toBeTruthy()
    expect(screen.getByText('1 个角色')).toBeTruthy()
  })

  // 测试3: 选择项目后触发角色列表加载（显示骨架屏）
  it('选择项目后触发角色列表加载', async () => {
    global.fetch = createFetchMock({ charactersDelay: 500 })

    render(<CharacterApplyDialog {...defaultProps} />)

    // 等待项目列表加载
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 点击选择项目
    fireEvent.click(screen.getByText('短剧项目A'))

    // 选择项目后应显示"选择角色"标签
    await waitFor(() => {
      expect(screen.getByText('选择角色')).toBeTruthy()
    })
  })

  // 测试4: 角色加载完成后显示角色名称
  it('角色加载完成后显示角色名称', async () => {
    render(<CharacterApplyDialog {...defaultProps} />)

    // 等待项目列表
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 选择项目
    fireEvent.click(screen.getByText('短剧项目A'))

    // 等待角色列表加载完成
    await waitFor(() => {
      expect(screen.getByText('主角小明')).toBeTruthy()
    })

    // 验证角色信息
    expect(screen.getByText('主角小明')).toBeTruthy()
    expect(screen.getByText('已有参考图')).toBeTruthy()
    expect(screen.getByText('配角小红')).toBeTruthy()
    expect(screen.getByText('无参考图')).toBeTruthy()
  })

  // 测试5: 选择已有 imageUrl 的角色显示覆盖警告
  it('选择已有参考图的角色显示覆盖警告', async () => {
    render(<CharacterApplyDialog {...defaultProps} />)

    // 等待项目列表
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 选择项目
    fireEvent.click(screen.getByText('短剧项目A'))

    // 等待角色列表
    await waitFor(() => {
      expect(screen.getByText('主角小明')).toBeTruthy()
    })

    // 选择已有参考图的角色
    fireEvent.click(screen.getByText('主角小明'))

    // 应显示覆盖警告
    await waitFor(() => {
      expect(screen.getByText(/已有参考图，确认覆盖/)).toBeTruthy()
    })

    // 确认按钮应显示"确认覆盖"
    expect(screen.getByText('确认覆盖')).toBeTruthy()
  })

  // 测试6: 选择无 imageUrl 的角色不显示覆盖警告
  it('选择无参考图的角色不显示覆盖警告', async () => {
    render(<CharacterApplyDialog {...defaultProps} />)

    // 等待项目列表
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 选择项目
    fireEvent.click(screen.getByText('短剧项目A'))

    // 等待角色列表
    await waitFor(() => {
      expect(screen.getByText('配角小红')).toBeTruthy()
    })

    // 选择无参考图的角色
    fireEvent.click(screen.getByText('配角小红'))

    // 不应有覆盖警告
    await waitFor(() => {
      expect(screen.getByText('确认应用')).toBeTruthy()
    })
    expect(screen.queryByText(/确认覆盖/)).toBeNull()
  })

  // 测试7: 确认按钮调用 apply API 并显示成功 toast
  it('确认应用后调用 API 并触发成功回调', async () => {
    const { toast } = await import('sonner')
    const onSuccess = vi.fn()

    render(<CharacterApplyDialog {...defaultProps} onSuccess={onSuccess} />)

    // 等待项目列表
    await waitFor(() => {
      expect(screen.getByText('短剧项目A')).toBeTruthy()
    })

    // 选择项目
    fireEvent.click(screen.getByText('短剧项目A'))

    // 等待角色列表
    await waitFor(() => {
      expect(screen.getByText('配角小红')).toBeTruthy()
    })

    // 选择角色（无参考图，无需覆盖确认）
    fireEvent.click(screen.getByText('配角小红'))

    // 等待确认按钮出现
    await waitFor(() => {
      expect(screen.getByText('确认应用')).toBeTruthy()
    })

    // 点击确认
    await act(async () => {
      fireEvent.click(screen.getByText('确认应用'))
    })

    // 验证 API 被调用
    await waitFor(() => {
      const applyCalls = fetchMock.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/apply-to-character')
      )
      expect(applyCalls.length).toBe(1)
    })

    // 验证请求体
    const applyCall = fetchMock.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('/apply-to-character')
    )
    expect(applyCall).toBeTruthy()
    const body = JSON.parse(applyCall![1]?.body as string)
    expect(body.targetProjectId).toBe('proj-1')
    expect(body.targetCharacterId).toBe('char-2')

    // 验证 toast 成功调用
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('已应用到 短剧项目A - 配角小红')
    })

    // 验证 onSuccess 回调
    expect(onSuccess).toHaveBeenCalledWith('短剧项目A', '配角小红')
  })
})
