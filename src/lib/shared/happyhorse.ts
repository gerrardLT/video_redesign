/**
 * HappyHorse V-Edit 视频生成 API 客户端
 * 对接阿里云百炼 DashScope 平台 HappyHorse 1.0 视频编辑模型
 *
 * 接口：
 * - 创建任务 POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
 * - 查询任务 GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
 *
 * V-Edit 模式请求体格式：
 * {
 *   model: "happyhorse-1.0-video-edit",
 *   input: {
 *     prompt: "...",
 *     media: [
 *       { type: "video", url: "..." },
 *       { type: "reference_image", url: "..." }
 *     ]
 *   },
 *   parameters: {
 *     resolution: "720P",
 *     watermark: false,
 *     audio_setting: "origin"
 *   }
 * }
 */

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1'
const HAPPYHORSE_MODEL_ID = 'happyhorse-1.0-video-edit'

/** 参考图最大数量限制（V-Edit 模式） */
const MAX_REFERENCE_IMAGES = 5

/**
 * 获取 DashScope API Key，缺失时直接抛错
 */
function getDashScopeApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) {
    throw new Error('DASHSCOPE_API_KEY 未配置，无法调用 HappyHorse API')
  }
  return key
}

/** HappyHorse V-Edit 任务创建参数 */
export interface HappyHorseCreateParams {
  /** 原视频 URL（公网可访问的 OSS 签名 URL） */
  videoUrl: string
  /** 编辑指令 prompt（支持 [Image N] 语法引用参考图） */
  prompt: string
  /** 参考图 URL 列表（0-5 张，超出截断） */
  referenceImages?: string[]
  /** 分辨率，固定 720P */
  resolution?: '720P'
  /** 音频处理：origin=保留原声，auto=模型控制 */
  audioSetting?: 'origin' | 'auto'
}

/** HappyHorse 任务状态返回 */
export interface HappyHorseTaskStatus {
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  /** 生成结果视频 URL（24 小时过期，需立即下载转存） */
  videoUrl?: string
  /** 实际输出视频时长（秒） */
  outputDuration?: number
  /** 输入视频时长（秒） */
  inputDuration?: number
  /** 失败时的错误信息 */
  error?: { code: string; message: string }
}

/**
 * 构建 HappyHorse V-Edit 请求体（纯函数，方便测试）
 */
export function buildHappyHorseRequestBody(params: HappyHorseCreateParams) {
  // 构建 media 数组：1 个 video + 0-5 个 reference_image
  const media: Array<{ type: string; url: string }> = [
    { type: 'video', url: params.videoUrl },
  ]

  // 截断参考图到最大 5 张
  if (params.referenceImages && params.referenceImages.length > 0) {
    const images = params.referenceImages.slice(0, MAX_REFERENCE_IMAGES)
    for (const url of images) {
      media.push({ type: 'reference_image', url })
    }
  }

  return {
    model: HAPPYHORSE_MODEL_ID,
    input: {
      prompt: params.prompt,
      media,
    },
    parameters: {
      resolution: params.resolution || '720P',
      watermark: false,
      audio_setting: params.audioSetting || 'origin',
    },
  }
}

/**
 * 创建 HappyHorse V-Edit 视频编辑任务（异步）
 *
 * 向 DashScope 发送异步任务创建请求，返回 taskId 用于后续轮询。
 * 环境变量 DASHSCOPE_API_KEY 缺失时直接抛错。
 */
export async function createHappyHorseTask(
  params: HappyHorseCreateParams
): Promise<{ taskId: string }> {
  const apiKey = getDashScopeApiKey()
  const requestBody = buildHappyHorseRequestBody(params)

  console.log(`[happyhorse] 创建 V-Edit 任务 - prompt: ${params.prompt?.substring(0, 50)}...`)
  console.log(`[happyhorse] media: 1 video + ${(requestBody.input.media.length - 1)} reference_images`)
  console.log(`[happyhorse] videoUrl: ${params.videoUrl.substring(0, 80)}...`)
  if (params.referenceImages && params.referenceImages.length > 0) {
    params.referenceImages.slice(0, 5).forEach((url, i) => {
      console.log(`[happyhorse]   参考图 ${i + 1}: ${url.substring(0, 80)}...`)
    })
  }
  console.log(`[happyhorse] 完整请求体:`, JSON.stringify(requestBody, null, 2))

  const response = await fetch(
    `${DASHSCOPE_API_BASE}/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(requestBody),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HappyHorse API 创建任务失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    output?: { task_id?: string; task_status?: string }
    request_id?: string
  }

  const taskId = data.output?.task_id
  if (!taskId) {
    throw new Error(`HappyHorse API 响应中缺少 task_id: ${JSON.stringify(data)}`)
  }

  console.log(`[happyhorse] 任务已创建 - taskId: ${taskId}`)
  return { taskId }
}

/**
 * 查询 HappyHorse 任务状态
 *
 * 轮询任务直到 SUCCEEDED 或 FAILED。
 * 成功时提取 video_url（24 小时过期，需立即下载转存到 OSS）。
 * 失败时提取 code 和 message 作为错误信息返回。
 */
export async function getHappyHorseTaskStatus(
  taskId: string
): Promise<HappyHorseTaskStatus> {
  const apiKey = getDashScopeApiKey()

  const response = await fetch(
    `${DASHSCOPE_API_BASE}/tasks/${taskId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HappyHorse API 查询状态失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    output?: {
      task_id?: string
      task_status?: string
      video_url?: string
      code?: string
      message?: string
    }
    usage?: {
      duration?: number
      input_video_duration?: number
      output_video_duration?: number
    }
    request_id?: string
  }

  const taskStatus = data.output?.task_status

  switch (taskStatus) {
    case 'PENDING':
      return { status: 'PENDING' }

    case 'RUNNING':
      return { status: 'RUNNING' }

    case 'SUCCEEDED':
      console.log(`[happyhorse] 任务 ${taskId} 完成 - videoUrl: ${data.output?.video_url?.substring(0, 60)}...`)
      return {
        status: 'SUCCEEDED',
        videoUrl: data.output?.video_url,
        outputDuration: data.usage?.output_video_duration,
        inputDuration: data.usage?.input_video_duration,
      }

    case 'FAILED':
      console.error(`[happyhorse] 任务 ${taskId} 失败 - code: ${data.output?.code}, message: ${data.output?.message}`)
      return {
        status: 'FAILED',
        error: {
          code: data.output?.code || 'UNKNOWN_ERROR',
          message: data.output?.message || '视频编辑任务失败',
        },
      }

    default:
      // 未知状态当作 PENDING 处理
      return { status: 'PENDING' }
  }
}
