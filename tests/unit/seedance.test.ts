import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 单元测试: seedance.ts
 *
 * 新契约（任务 10.2）：
 * - 无 SEEDANCE_API_KEY 时所有函数必须抛真实错误，绝不返回 mock taskId 或占位视频
 * - 真实响应使用 `id` 字段（非旧的 task_id）
 * - 请求体使用 content 数组（type=image_url/audio_url + role）
 *   referenceImages 最多 9 张（role=reference_image）
 */

type SeedanceModule = typeof import('@/lib/video/seedance')

// 读取 fetch 请求体中的 content 数组
function getContentFromFetch(
  mockFetch: ReturnType<typeof vi.fn>
): Array<{ type: string; role?: string; image_url?: { url: string }; audio_url?: { url: string } }> {
  const call = mockFetch.mock.calls[0]
  const body = JSON.parse(call[1].body)
  return body.content || []
}

describe('seedance 无 API Key 时抛错（不返回 mock/占位结果）', () => {
  let mod: SeedanceModule

  beforeEach(async () => {
    // 确保无 Key
    delete process.env.SEEDANCE_API_KEY
    process.env.SEEDANCE_API_URL = 'https://api.test.com'

    // 无 Key 时不应发起任何网络请求；若发起则让测试失败
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('不应调用 fetch')))

    vi.resetModules()
    mod = await import('@/lib/video/seedance')
  })

  afterEach(() => {
    delete process.env.SEEDANCE_API_URL
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('createSeedanceTask 无 Key 时抛错', async () => {
    await expect(
      mod.createSeedanceTask({
        prompt: 'test prompt',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      })
    ).rejects.toThrow('SEEDANCE_API_KEY 未配置')
  })

  it('getSeedanceTaskStatus 无 Key 时抛错（不返回占位视频）', async () => {
    await expect(mod.getSeedanceTaskStatus('any-task-id')).rejects.toThrow(
      'SEEDANCE_API_KEY 未配置'
    )
  })

  it('cancelSeedanceTask 无 Key 时抛错（不再静默跳过）', async () => {
    await expect(mod.cancelSeedanceTask('any-task-id')).rejects.toThrow(
      'SEEDANCE_API_KEY 未配置'
    )
  })

  it('createAvatarVideoTask 无 Key 时抛错', async () => {
    await expect(
      mod.createAvatarVideoTask({
        prompt: 'test prompt',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: [],
      })
    ).rejects.toThrow('SEEDANCE_API_KEY 未配置')
  })
})

describe('createSeedanceTask content 约束（有 Key）', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let createSeedanceTask: SeedanceModule['createSeedanceTask']

  beforeEach(async () => {
    process.env.SEEDANCE_API_KEY = 'test-api-key'
    process.env.SEEDANCE_API_URL = 'https://api.test.com'

    // 真实响应使用 id 字段
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'test-task-id', status: 'queued' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    vi.resetModules()
    const mod = await import('@/lib/video/seedance')
    createSeedanceTask = mod.createSeedanceTask
  })

  afterEach(() => {
    delete process.env.SEEDANCE_API_KEY
    delete process.env.SEEDANCE_API_URL
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('返回的 taskId 取自响应的 id 字段', async () => {
    const result = await createSeedanceTask({
      prompt: 'test prompt',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
    })
    expect(result.taskId).toBe('test-task-id')
  })

  it('响应缺少 id 字段时抛错', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'queued' }),
    })
    await expect(
      createSeedanceTask({
        prompt: 'test prompt',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      })
    ).rejects.toThrow('缺少 id')
  })

  it('referenceImages 超过 9 张时只取前 9 张', async () => {
    await createSeedanceTask({
      prompt: 'test prompt',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      referenceImages: Array.from({ length: 12 }, (_, i) => `https://oss.example.com/i${i + 1}.jpg`),
    })

    const content = getContentFromFetch(mockFetch)
    const refImages = content.filter(c => c.role === 'reference_image')
    expect(refImages.length).toBe(9)
  })

  it('提供 referenceAudioUrl 时生成 reference_audio content', async () => {
    await createSeedanceTask({
      prompt: 'test prompt',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      referenceAudioUrl: 'https://oss.example.com/audio.mp3',
    })

    const content = getContentFromFetch(mockFetch)
    const refAudio = content.filter(c => c.role === 'reference_audio')
    expect(refAudio.length).toBe(1)
    expect(refAudio[0].audio_url?.url).toBe('https://oss.example.com/audio.mp3')
  })

  it('prompt 作为 text content 传入', async () => {
    await createSeedanceTask({
      prompt: 'hello world',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
    })

    const content = getContentFromFetch(mockFetch)
    const textItems = content.filter(c => c.type === 'text')
    expect(textItems.length).toBe(1)
  })
})
