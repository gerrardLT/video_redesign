/**
 * HappyHorse 工作台模式客户端
 *
 * 工作台模式使用 T2V（文生视频）或 R2V（参考图生视频），
 * 与现有 V-Edit（视频编辑）模式不同。
 *
 * T2V: 纯文本 prompt → 视频（happyhorse-1.0-t2v）
 * R2V: 参考图 + prompt → 视频（happyhorse-1.0-r2v），prompt 中使用 [Image N] 引用
 *
 * API 端点与 V-Edit 相同：
 * POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
 *
 * 查询接口复用现有 getHappyHorseTaskStatus。
 */

export { getHappyHorseTaskStatus } from './happyhorse'

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1'
const HAPPYHORSE_T2V_MODEL = 'happyhorse-1.0-t2v'
const HAPPYHORSE_R2V_MODEL = 'happyhorse-1.0-r2v'

/** R2V 模式最大参考图数量 */
const MAX_R2V_REFERENCE_IMAGES = 9

/**
 * 获取 DashScope API Key，缺失时直接抛错
 */
function getDashScopeApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) {
    throw new Error('DASHSCOPE_API_KEY 未配置，无法调用 HappyHorse 工作台 API')
  }
  return key
}

/** HappyHorse 工作台生成参数 */
export interface HappyHorseWorkspaceParams {
  /** 生成描述 prompt */
  prompt: string
  /** 生成时长（3-15 秒） */
  duration: number
  /** 画面比例 */
  aspectRatio: string
  /** 分辨率（固定 720P） */
  resolution: '720P'
  /** R2V 模式参考图 URL（1-9 张，为空则使用 T2V） */
  referenceImages?: string[]
}

/** T2V 请求体结构 */
export interface HappyHorseT2VRequestBody {
  model: typeof HAPPYHORSE_T2V_MODEL
  input: {
    prompt: string
  }
  parameters: {
    resolution: '720P'
    ratio: string
    duration: number
    watermark: false
  }
}

/** R2V 请求体结构 */
export interface HappyHorseR2VRequestBody {
  model: typeof HAPPYHORSE_R2V_MODEL
  input: {
    prompt: string
    media: Array<{ type: 'reference_image'; url: string }>
  }
  parameters: {
    resolution: '720P'
    ratio: string
    duration: number
    watermark: false
  }
}

/**
 * 构建 T2V 请求体（纯函数，可测）
 *
 * T2V 模式仅需 prompt，无参考图。
 */
export function buildT2VRequestBody(params: HappyHorseWorkspaceParams): HappyHorseT2VRequestBody {
  return {
    model: HAPPYHORSE_T2V_MODEL,
    input: {
      prompt: params.prompt,
    },
    parameters: {
      resolution: '720P',
      ratio: params.aspectRatio,
      duration: params.duration,
      watermark: false,
    },
  }
}

/**
 * 构建 R2V 请求体（纯函数，可测）
 *
 * R2V 模式将参考图作为 media 传入，prompt 中使用 [Image N] 引用。
 * 最多支持 9 张参考图，超出截断。
 */
export function buildR2VRequestBody(params: HappyHorseWorkspaceParams): HappyHorseR2VRequestBody {
  const images = (params.referenceImages || []).slice(0, MAX_R2V_REFERENCE_IMAGES)
  const media = images.map((url) => ({
    type: 'reference_image' as const,
    url,
  }))

  return {
    model: HAPPYHORSE_R2V_MODEL,
    input: {
      prompt: params.prompt,
      media,
    },
    parameters: {
      resolution: '720P',
      ratio: params.aspectRatio,
      duration: params.duration,
      watermark: false,
    },
  }
}

/**
 * 创建工作台 HappyHorse 任务（自动判断 T2V 或 R2V）
 *
 * 判断逻辑：
 * - 无参考图 → T2V 模式
 * - 有参考图 → R2V 模式
 *
 * @returns taskId 用于后续 getHappyHorseTaskStatus 轮询
 */
export async function createHappyHorseWorkspaceTask(
  params: HappyHorseWorkspaceParams
): Promise<{ taskId: string }> {
  const apiKey = getDashScopeApiKey()

  const hasReferenceImages = params.referenceImages && params.referenceImages.length > 0
  const mode = hasReferenceImages ? 'R2V' : 'T2V'

  const requestBody = hasReferenceImages
    ? buildR2VRequestBody(params)
    : buildT2VRequestBody(params)

  console.log(`[happyhorse-workspace] 创建 ${mode} 任务 - prompt: ${params.prompt.substring(0, 50)}...`)
  console.log(`[happyhorse-workspace] 参数: duration=${params.duration}s, ratio=${params.aspectRatio}`)
  if (hasReferenceImages) {
    console.log(`[happyhorse-workspace] 参考图数量: ${params.referenceImages!.length}`)
  }

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
    throw new Error(`HappyHorse ${mode} 任务创建失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    output?: { task_id?: string; task_status?: string }
    request_id?: string
  }

  const taskId = data.output?.task_id
  if (!taskId) {
    throw new Error(`HappyHorse ${mode} 响应中缺少 task_id: ${JSON.stringify(data)}`)
  }

  console.log(`[happyhorse-workspace] ${mode} 任务已创建 - taskId: ${taskId}`)
  return { taskId }
}
