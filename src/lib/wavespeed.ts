/**
 * WaveSpeed AI Video Upscaler API 客户端
 *
 * 接口：
 * - 提交超分任务: POST {base}/wavespeed-ai/video-upscaler
 * - 查询任务结果: GET {base}/predictions/{requestId}/result
 *
 * 环境变量：
 * - WAVESPEED_API_KEY: API 密钥
 * - WAVESPEED_API_BASE_URL: API 基础地址（默认 https://api.wavespeed.ai/api/v3）
 */

const API_BASE_URL = process.env.WAVESPEED_API_BASE_URL || 'https://api.wavespeed.ai/api/v3'
const API_KEY = process.env.WAVESPEED_API_KEY || ''

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT = 30_000

// ========================
// 类型定义
// ========================

export interface WaveSpeedSubmitParams {
  /** 视频公开 URL（OSS 地址） */
  video: string
  /** 目标分辨率 */
  targetResolution: '720p' | '1080p'
}

export interface WaveSpeedSubmitResponse {
  code: number
  message: string
  data: {
    id: string
    status: string
    model: string
    outputs: string[]
  }
}

export interface WaveSpeedResultData {
  id: string
  status: 'created' | 'processing' | 'completed' | 'failed'
  outputs: string[]
  error?: string
}

export interface WaveSpeedResultResponse {
  code: number
  message: string
  data: WaveSpeedResultData
}

// ========================
// 错误定义
// ========================

export class WaveSpeedApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message)
    this.name = 'WaveSpeedApiError'
  }

  /** 是否为服务端错误（可重试） */
  get isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600
  }

  /** 是否为限流错误 */
  get isRateLimited(): boolean {
    return this.statusCode === 429
  }
}

// ========================
// API 函数
// ========================

/**
 * 提交超分任务到 WaveSpeed
 *
 * @param params 视频 URL 和目标分辨率
 * @returns requestId 用于后续轮询结果
 * @throws WaveSpeedApiError 请求失败时抛出（含 HTTP 状态码）
 */
export async function submitUpscaleTask(
  params: WaveSpeedSubmitParams
): Promise<{ requestId: string }> {
  validateApiKey()

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/wavespeed-ai/video-upscaler`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video: params.video,
        target_resolution: params.targetResolution,
      }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new WaveSpeedApiError(
      `WaveSpeed 提交超分任务失败 (${response.status}): ${errorText}`,
      response.status,
      errorText
    )
  }

  const data = (await response.json()) as WaveSpeedSubmitResponse

  if (!data.data?.id) {
    throw new WaveSpeedApiError(
      `WaveSpeed 响应中缺少 requestId: ${JSON.stringify(data)}`,
      200,
      JSON.stringify(data)
    )
  }

  console.log(`[wavespeed] 超分任务已提交 - requestId: ${data.data.id}, target: ${params.targetResolution}`)

  return { requestId: data.data.id }
}

/**
 * 查询超分任务结果
 *
 * @param requestId 任务 ID（由 submitUpscaleTask 返回）
 * @returns 任务状态和输出
 * @throws WaveSpeedApiError 请求失败时抛出
 */
export async function getUpscaleResult(
  requestId: string
): Promise<WaveSpeedResultData> {
  validateApiKey()

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/predictions/${requestId}/result`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new WaveSpeedApiError(
      `WaveSpeed 查询结果失败 (${response.status}): ${errorText}`,
      response.status,
      errorText
    )
  }

  const result = (await response.json()) as WaveSpeedResultResponse

  return result.data
}

// ========================
// 内部工具函数
// ========================

/**
 * 校验 API Key 是否已配置
 */
function validateApiKey(): void {
  if (!API_KEY) {
    throw new Error('WAVESPEED_API_KEY 未配置，无法调用 WaveSpeed 超分服务')
  }
}

/**
 * 带超时的 fetch 封装
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WaveSpeedApiError('WaveSpeed API 请求超时', 408)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
