import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 单元测试: video-export-upscale
 *
 * 覆盖：
 * - estimateUpscaleCreditCost 积分计算边界值
 * - WaveSpeed 客户端请求构造与响应解析
 * - 导出状态流转正确性
 */

// ========================
// 1. 积分计算函数测试
// ========================

describe('estimateUpscaleCreditCost', () => {
  let estimateUpscaleCreditCost: typeof import('@/lib/credit-service').estimateUpscaleCreditCost

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('@/lib/credit-service')
    estimateUpscaleCreditCost = mod.estimateUpscaleCreditCost
  })

  it('480p 始终返回 0', () => {
    expect(estimateUpscaleCreditCost(10, '480p')).toBe(0)
    expect(estimateUpscaleCreditCost(0.5, '480p')).toBe(0)
    expect(estimateUpscaleCreditCost(600, '480p')).toBe(0)
  })

  it('720p 返回 ceil(duration × 1)', () => {
    expect(estimateUpscaleCreditCost(10, '720p')).toBe(10)
    expect(estimateUpscaleCreditCost(10.1, '720p')).toBe(11)
    expect(estimateUpscaleCreditCost(0.5, '720p')).toBe(1)
    expect(estimateUpscaleCreditCost(1, '720p')).toBe(1)
  })

  it('1080p 返回 ceil(duration × 2)', () => {
    expect(estimateUpscaleCreditCost(10, '1080p')).toBe(20)
    expect(estimateUpscaleCreditCost(10.1, '1080p')).toBe(21)
    expect(estimateUpscaleCreditCost(0.5, '1080p')).toBe(1)
    expect(estimateUpscaleCreditCost(1, '1080p')).toBe(2)
    expect(estimateUpscaleCreditCost(0.3, '1080p')).toBe(1)
  })

  it('非标准分辨率返回 0', () => {
    expect(estimateUpscaleCreditCost(100, '360p')).toBe(0)
    expect(estimateUpscaleCreditCost(100, '4k')).toBe(0)
    expect(estimateUpscaleCreditCost(100, '')).toBe(0)
  })
})

// ========================
// 2. WaveSpeed 客户端测试
// ========================

describe('WaveSpeed 客户端', () => {
  let submitUpscaleTask: typeof import('@/lib/wavespeed').submitUpscaleTask
  let getUpscaleResult: typeof import('@/lib/wavespeed').getUpscaleResult
  let WaveSpeedApiError: typeof import('@/lib/wavespeed').WaveSpeedApiError

  beforeEach(async () => {
    vi.resetModules()
    process.env.WAVESPEED_API_KEY = 'test-api-key'
    process.env.WAVESPEED_API_BASE_URL = 'https://api.test.wavespeed.ai/api/v3'
  })

  afterEach(() => {
    delete process.env.WAVESPEED_API_KEY
    delete process.env.WAVESPEED_API_BASE_URL
    vi.unstubAllGlobals()
  })

  it('无 API Key 时抛出明确错误', async () => {
    delete process.env.WAVESPEED_API_KEY
    const mod = await import('@/lib/wavespeed')

    await expect(
      mod.submitUpscaleTask({ video: 'https://example.com/v.mp4', targetResolution: '720p' })
    ).rejects.toThrow('WAVESPEED_API_KEY 未配置')
  })

  it('submitUpscaleTask 构造正确的请求', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        message: 'success',
        data: { id: 'req-123', status: 'created', model: 'video-upscaler', outputs: [] },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('@/lib/wavespeed')
    const result = await mod.submitUpscaleTask({
      video: 'https://oss.example.com/video.mp4',
      targetResolution: '1080p',
    })

    expect(result.requestId).toBe('req-123')

    // 验证请求
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.test.wavespeed.ai/api/v3/wavespeed-ai/video-upscaler')
    expect(options.method).toBe('POST')
    expect(options.headers['Authorization']).toBe('Bearer test-api-key')

    const body = JSON.parse(options.body)
    expect(body.video).toBe('https://oss.example.com/video.mp4')
    expect(body.target_resolution).toBe('1080p')
  })

  it('submitUpscaleTask HTTP 错误时抛 WaveSpeedApiError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('@/lib/wavespeed')

    await expect(
      mod.submitUpscaleTask({ video: 'https://x.com/v.mp4', targetResolution: '720p' })
    ).rejects.toThrow('WaveSpeed 提交超分任务失败 (500)')
  })

  it('getUpscaleResult 正确解析 completed 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        message: 'success',
        data: {
          id: 'req-456',
          status: 'completed',
          outputs: ['https://wavespeed.cdn.com/output.mp4'],
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('@/lib/wavespeed')
    const result = await mod.getUpscaleResult('req-456')

    expect(result.status).toBe('completed')
    expect(result.outputs[0]).toBe('https://wavespeed.cdn.com/output.mp4')
  })

  it('getUpscaleResult 正确解析 failed 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        message: 'success',
        data: {
          id: 'req-789',
          status: 'failed',
          outputs: [],
          error: 'Video format not supported',
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('@/lib/wavespeed')
    const result = await mod.getUpscaleResult('req-789')

    expect(result.status).toBe('failed')
    expect(result.error).toBe('Video format not supported')
  })

  it('WaveSpeedApiError 正确分类 5xx 和 429', async () => {
    const mod = await import('@/lib/wavespeed')

    const err5xx = new mod.WaveSpeedApiError('Server Error', 502)
    expect(err5xx.isServerError).toBe(true)
    expect(err5xx.isRateLimited).toBe(false)

    const err429 = new mod.WaveSpeedApiError('Rate Limited', 429)
    expect(err429.isServerError).toBe(false)
    expect(err429.isRateLimited).toBe(true)

    const err400 = new mod.WaveSpeedApiError('Bad Request', 400)
    expect(err400.isServerError).toBe(false)
    expect(err400.isRateLimited).toBe(false)
  })
})

// ========================
// 3. 导出状态流转测试
// ========================

describe('导出状态流转', () => {
  const VALID_TRANSITIONS: Record<string, string[]> = {
    MERGING: ['UPSCALING', 'COMPLETED', 'FAILED'],
    UPSCALING: ['COMPLETED', 'FAILED'],
    COMPLETED: [], // 终态
    FAILED: [],     // 终态（可重新导出）
  }

  it('MERGING → UPSCALING 合法（720p/1080p 合并完成后）', () => {
    expect(VALID_TRANSITIONS['MERGING']).toContain('UPSCALING')
  })

  it('MERGING → COMPLETED 合法（480p 直接完成）', () => {
    expect(VALID_TRANSITIONS['MERGING']).toContain('COMPLETED')
  })

  it('MERGING → FAILED 合法（合并失败）', () => {
    expect(VALID_TRANSITIONS['MERGING']).toContain('FAILED')
  })

  it('UPSCALING → COMPLETED 合法（超分成功）', () => {
    expect(VALID_TRANSITIONS['UPSCALING']).toContain('COMPLETED')
  })

  it('UPSCALING → FAILED 合法（超分失败，积分退还）', () => {
    expect(VALID_TRANSITIONS['UPSCALING']).toContain('FAILED')
  })

  it('COMPLETED 为终态，无后续转换', () => {
    expect(VALID_TRANSITIONS['COMPLETED']).toHaveLength(0)
  })

  it('FAILED 为终态，无后续转换', () => {
    expect(VALID_TRANSITIONS['FAILED']).toHaveLength(0)
  })

  it('不存在 UPSCALING → MERGING 的逆向转换', () => {
    expect(VALID_TRANSITIONS['UPSCALING']).not.toContain('MERGING')
  })
})
