/**
 * Seedance 2.0 视频生成 API 客户端
 * 对接火山引擎方舟平台官方 API
 *
 * 接口：
 * - 创建任务 POST {base}/contents/generations/tasks
 * - 查询任务 GET {base}/contents/generations/tasks/{id}
 * - 取消/删除 DELETE {base}/contents/generations/tasks/{id}
 *
 * 请求体格式（content 数组）：
 * {
 *   model: "doubao-seedance-2-0-260128",
 *   content: [
 *     { type: "text", text: "..." },
 *     { type: "image_url", image_url: { url: "..." }, role: "reference_image" },
 *     { type: "audio_url", audio_url: { url: "..." }, role: "reference_audio" }
 *   ],
 *   resolution: "720p",
 *   ratio: "16:9",
 *   duration: 10,
 *   generate_audio: true
 * }
 */

const API_BASE_URL = process.env.SEEDANCE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const API_KEY = process.env.SEEDANCE_API_KEY || ''
const MODEL_ID = 'doubao-seedance-2-0-260128'

/** Seedance 接受的标准画幅值 */
const VALID_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'adaptive']

/**
 * 将前端/项目传入的 aspectRatio 规范化为 Seedance 接受的标准画幅值。
 * 非标值（如原始像素分辨率 "720:1280"、"1920:1080"）统一转为 adaptive。
 */
function normalizeRatio(aspectRatio: string | undefined | null): string {
  if (!aspectRatio) return 'adaptive'
  const trimmed = aspectRatio.trim()
  if (VALID_RATIOS.includes(trimmed)) return trimmed
  // 尝试从像素分辨率推断标准画幅（如 720:1280 → 9:16，1920:1080 → 16:9）
  const parts = trimmed.split(':').map(Number)
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const ratio = parts[0] / parts[1]
    if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9'
    if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16'
    if (Math.abs(ratio - 1) < 0.1) return '1:1'
  }
  return 'adaptive'
}

export interface SeedanceCreateParams {
  prompt: string
  duration: number
  aspectRatio: string
  resolution: string
  referenceImages?: string[]  // 参考图 URL（role=reference_image，最多9张）
  lastFrameUrl?: string       // 尾帧图 URL（role=last_frame）
  referenceAudioUrl?: string  // 参考音频 URL（role=reference_audio）
  returnLastFrame?: boolean   // 是否返回尾帧图片（用于链式生成）
}

export interface SeedanceTaskStatus {
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  videoUrl?: string
  lastFrameUrl?: string  // 尾帧图片 URL（仅 returnLastFrame=true 且 succeeded 时有值）
  seconds?: number
  error?: { code: string; message: string }
  /** 本次任务消耗的 token 数量（仅 succeeded 时有值） */
  tokenUsage?: {
    completionTokens: number
    totalTokens: number
  }
}

/**
 * 创建视频生成任务
 */
export async function createSeedanceTask(
  params: SeedanceCreateParams
): Promise<{ taskId: string }> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY 未配置，无法创建视频生成任务')
  }

  // 判断模式（first_frame / reference_video 已废弃：统一走文本 + 多模态参考，不再有互斥分支）
  const hasReferenceAudio = !!params.referenceAudioUrl
  const hasReferenceImages = params.referenceImages && params.referenceImages.length > 0

  // 构建 content 数组
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []

  // 文本 prompt
  if (params.prompt) {
    content.push({ type: 'text', text: params.prompt })
  }

  // 参考图片（人物锚定 asset:// + 场景/物品/环境素材，role=reference_image）
  if (hasReferenceImages) {
    for (const url of params.referenceImages!.slice(0, 9)) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
  }

  // 参考音频（role=reference_audio）
  if (hasReferenceAudio) {
    content.push({ type: 'audio_url', audio_url: { url: params.referenceAudioUrl! }, role: 'reference_audio' })
  }

  // 构建请求体
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = {
    model: MODEL_ID,
    content,
    resolution: params.resolution || '720p',
    ratio: normalizeRatio(params.aspectRatio), // Seedance 仅接受标准画幅值
    duration: params.duration,
    generate_audio: true,
    watermark: false,
    ...(params.returnLastFrame ? { return_last_frame: true } : {}),
  }

  console.log(`[seedance] 创建任务 - content: ${content.length} 项, prompt: ${params.prompt?.substring(0, 50)}...`)
  console.log(`[seedance] 完整请求体:`, JSON.stringify(requestBody, null, 2))
  content.forEach((c, i) => {
    if (c.type === 'image_url') console.log(`[seedance]   content[${i}]: image role=${c.role}, url=${c.image_url.url.substring(0, 60)}...`)
    if (c.type === 'audio_url') console.log(`[seedance]   content[${i}]: audio role=${c.role}, url=${c.audio_url.url.substring(0, 60)}...`)
  })

  const response = await fetch(`${API_BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Seedance API 创建任务失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as { id: string }

  if (!data.id) {
    throw new Error(`Seedance API 响应中缺少 id: ${JSON.stringify(data)}`)
  }

  return { taskId: data.id }
}

/**
 * 查询视频生成任务状态
 */
export async function getSeedanceTaskStatus(
  taskId: string
): Promise<SeedanceTaskStatus> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY 未配置，无法查询视频生成任务状态')
  }

  const response = await fetch(`${API_BASE_URL}/contents/generations/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Seedance API 查询状态失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    id: string
    status: string
    content?: { video_url?: string; last_frame_url?: string }
    duration?: number
    error?: { code: string; message: string } | null
    usage?: { completion_tokens?: number; total_tokens?: number }
  }

  switch (data.status) {
    case 'queued':
    case 'running':
      return { status: 'processing' }
    case 'succeeded': {
      const tokenUsage = data.usage ? {
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined
      if (tokenUsage) {
        console.log(`[seedance] 任务 ${taskId} 完成 - Token 消耗: ${tokenUsage.completionTokens} completion, ${tokenUsage.totalTokens} total`)
      }
      return {
        status: 'succeeded',
        videoUrl: data.content?.video_url,
        lastFrameUrl: data.content?.last_frame_url,
        seconds: data.duration,
        tokenUsage,
      }
    }
    case 'failed':
      console.error(`[seedance] 任务 ${taskId} 失败:`, JSON.stringify(data.error))
      return {
        status: 'failed',
        error: {
          code: data.error?.code || 'GENERATION_FAILED',
          message: data.error?.message || '视频生成失败',
        },
      }
    case 'expired':
      return {
        status: 'failed',
        error: { code: 'EXPIRED', message: '任务超时' },
      }
    case 'cancelled':
      return {
        status: 'failed',
        error: { code: 'CANCELLED', message: '任务已取消' },
      }
    default:
      return { status: 'processing' }
  }
}

// ========================
// 虚拟角色模式
// ========================

export interface SeedanceAvatarParams {
  prompt: string                   // 包含"图片N"引用的 prompt
  duration: number
  aspectRatio: string
  resolution: string
  referenceImages: string[]        // asset:// URLs + scene frame URLs (max 9)
}

/**
 * 创建虚拟角色视频生成任务
 * 仅使用 text + reference_image 组合，不传 reference_video/audio
 * 含人脸的参考视频会被 Seedance 拦截，因此虚拟角色模式只使用 asset:// + 场景帧
 */
export async function createAvatarVideoTask(
  params: SeedanceAvatarParams
): Promise<{ taskId: string }> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY 未配置，无法创建虚拟角色视频生成任务')
  }

  // 校验 referenceImages 数量限制（最多 9 张）
  const images = params.referenceImages.slice(0, 9)

  // 构建 content 数组：仅 text + image_url（role=reference_image）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []

  // 文本 prompt（包含"图片N"引用）
  if (params.prompt) {
    content.push({ type: 'text', text: params.prompt })
  }

  // 参考图片：asset:// URL（虚拟角色）和 https:// URL（场景帧）均使用 role="reference_image"
  for (const url of images) {
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    })
  }

  // 构建请求体 — 不传 reference_video 和 reference_audio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = {
    model: MODEL_ID,
    content,
    resolution: params.resolution || '720p',
    ratio: normalizeRatio(params.aspectRatio),
    duration: params.duration,
    generate_audio: true,
    watermark: false,
  }

  console.log(`[seedance-avatar] 创建虚拟角色视频任务 - content: ${content.length} 项, 图片: ${images.length} 张`)
  console.log(`[seedance-avatar] prompt: ${params.prompt?.substring(0, 80)}...`)
  console.log(`[seedance-avatar] 完整请求体:`, JSON.stringify(requestBody, null, 2))
  content.forEach((c, i) => {
    if (c.type === 'image_url') {
      const urlPreview = c.image_url.url.substring(0, 60)
      const isAsset = c.image_url.url.startsWith('asset://')
      console.log(`[seedance-avatar]   content[${i}]: image role=${c.role}, type=${isAsset ? 'avatar' : 'scene'}, url=${urlPreview}...`)
    }
  })

  const response = await fetch(`${API_BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Seedance Avatar API 创建任务失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as { id: string }

  if (!data.id) {
    throw new Error(`Seedance Avatar API 响应中缺少 id: ${JSON.stringify(data)}`)
  }

  return { taskId: data.id }
}

/**
 * 取消排队中的任务或删除已完成的任务记录
 */
export async function cancelSeedanceTask(taskId: string): Promise<void> {
  if (!API_KEY) {
    throw new Error('SEEDANCE_API_KEY 未配置，无法取消视频生成任务')
  }

  const response = await fetch(`${API_BASE_URL}/contents/generations/tasks/${taskId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.warn(`[seedance] 取消/删除任务失败 (${response.status}): ${errorText}`)
  }
}
