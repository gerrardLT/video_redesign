/**
 * 图片生成 API 客户端
 * 对接火山引擎方舟平台 Seedream 5.0 lite（doubao-seedream-5.0-lite）文生图 / 图生图
 * 用于生成人物锚定图、分镜首帧等。
 *
 * 为何走方舟官方而非第三方中转：
 * - Seedance 2.0 仅信任「本账号、方舟平台、Seedream 5.0 lite 文生图」产物中的人脸，
 *   跨平台/跨账号产物不受信，作为参考素材会被人脸审核拦截。
 * - 因此生图必须与视频生成同账号（复用 SEEDANCE_API_KEY），走 ark.cn-beijing.volces.com。
 *
 * 转存说明：
 * - 方舟返回的图片 url 仅 24h 有效，且受信要求「原始产物不经压缩/转发」。
 * - 故统一用 response_format=b64_json 取回原始字节，直接转存到自有 OSS（官方推荐做法），
 *   返回 OSS 公网 URL 供后续入库 / 参考使用。
 *
 * API：POST {ARK}/images/generations（同步返回，无需轮询）
 * 文档：https://www.volcengine.com/docs/82379/1541523
 */
import { randomUUID } from 'crypto'
import { uploadBuffer } from './storage'

// 方舟基址与密钥：与 Seedance 视频生成同账号（受信前提）
const ARK_BASE_URL = process.env.SEEDANCE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const ARK_API_KEY = process.env.SEEDANCE_API_KEY || ''
// 文生图模型 ID：受信名单内的 Seedream 5.0 lite（方舟 Model ID 为短横线+日期版本格式）
// 可用 IMAGE_MODEL_ID 覆盖（以方舟控制台「模型列表」展示的实际 Model ID 为准）
const IMAGE_MODEL = process.env.IMAGE_MODEL_ID || 'doubao-seedream-5-0-260128'

export interface ImageGenerateResult {
  imageUrl: string
  taskId?: string
}

/**
 * 将画幅比例映射到 Seedream 5.0 lite 推荐的 2K 宽高像素值（官方推荐表）
 * 满足总像素 [3686400, 16777216] 与宽高比 [1/16, 16] 双重约束。
 */
function aspectRatioToSize(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map(Number)
  const ratio = w && h ? w / h : 1
  if (ratio > 1.9) return '3136x1344' // 21:9
  if (ratio > 1.5) return '2848x1600' // 16:9
  if (ratio > 1.2) return '2304x1728' // 4:3
  if (ratio > 0.9) return '2048x2048' // 1:1
  if (ratio > 0.7) return '1728x2304' // 3:4
  return '1600x2848' // 9:16
}

/**
 * 调用方舟文生图 / 图生图，返回图片原始字节 Buffer。
 * @param prompt 文本提示词
 * @param size   宽高像素值（如 2048x2048）
 * @param imageUrl 可选；传入则为图生图（参考图修改）
 */
async function generateImageBuffer(params: {
  prompt: string
  size: string
  imageUrl?: string
}): Promise<Buffer> {
  if (!ARK_API_KEY) {
    throw new Error('SEEDANCE_API_KEY 未配置，无法调用方舟文生图')
  }

  const body: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt: params.prompt,
    response_format: 'b64_json', // 取原始字节，避免 24h url 失效并满足受信「不转发」
    size: params.size,
    watermark: false,
  }
  // 图生图：附带参考图 URL（公网可访问）
  if (params.imageUrl) {
    body.image = params.imageUrl
  }

  const response = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ARK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`方舟文生图请求失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; error?: { code?: string; message?: string } }>
  }

  const first = data.data?.[0]
  if (!first) {
    throw new Error(`方舟文生图响应缺少图片数据: ${JSON.stringify(data).slice(0, 200)}`)
  }
  // 单图生成失败（含审核不通过）会在 data[].error 返回具体原因，不静默吞掉
  if (first.error?.message) {
    throw new Error(`方舟文生图失败: ${first.error.code || ''} ${first.error.message}`)
  }

  if (first.b64_json) {
    return Buffer.from(first.b64_json, 'base64')
  }
  // 兜底：极少数情况只返回 url（24h 失效），立即下载为字节再转存
  if (first.url) {
    const imgResp = await fetch(first.url)
    if (!imgResp.ok) {
      throw new Error(`下载方舟文生图产物失败 (${imgResp.status})`)
    }
    return Buffer.from(await imgResp.arrayBuffer())
  }

  throw new Error('方舟文生图响应既无 b64_json 也无 url')
}

/**
 * 生成人物参考图（文生图）并转存到自有 OSS
 * @param prompt 人物外貌描述文本
 * @param ossKeyPrefix OSS 键前缀（默认 characters）
 * @returns 转存后的 OSS 公网 URL
 */
export async function generateCharacterImage(
  prompt: string,
  ossKeyPrefix = 'characters'
): Promise<ImageGenerateResult> {
  const buffer = await generateImageBuffer({ prompt, size: '2048x2048' })
  const key = `${ossKeyPrefix}/${randomUUID()}.png`
  const imageUrl = await uploadBuffer(key, buffer)
  return { imageUrl }
}

/**
 * 图生图（基于参考图修改）并转存到自有 OSS
 * @param imageUrl 原始图片的公网 URL
 * @param prompt 修改指令
 * @param ossKeyPrefix OSS 键前缀（默认 characters）
 * @returns 转存后的 OSS 公网 URL
 */
export async function editImage(
  imageUrl: string,
  prompt: string,
  ossKeyPrefix = 'characters'
): Promise<ImageGenerateResult> {
  const buffer = await generateImageBuffer({ prompt, size: '2048x2048', imageUrl })
  const key = `${ossKeyPrefix}/${randomUUID()}.png`
  const newUrl = await uploadBuffer(key, buffer)
  return { imageUrl: newUrl }
}

/**
 * 为分镜组生成首帧图（文生图）并转存到自有 OSS
 * 比例匹配视频画幅。
 *
 * @param prompt 场景和人物的完整视觉描述
 * @param aspectRatio 画幅比例，如 "16:9" / "9:16"
 * @param ossKeyPrefix OSS 键前缀（默认 first-frames）
 * @returns 转存后的 OSS 公网 URL
 */
export async function generateFirstFrame(
  prompt: string,
  aspectRatio = '16:9',
  ossKeyPrefix = 'first-frames'
): Promise<ImageGenerateResult> {
  const buffer = await generateImageBuffer({ prompt, size: aspectRatioToSize(aspectRatio) })
  const key = `${ossKeyPrefix}/${randomUUID()}.png`
  const imageUrl = await uploadBuffer(key, buffer)
  return { imageUrl }
}
