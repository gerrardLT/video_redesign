/**
 * 工作台生成请求体构建纯函数
 *
 * 将前端参数转换为 Seedance API 需要的请求体格式。
 * 纯函数，无副作用，可直接在测试中验证。
 */

/** Seedance 工作台请求体构建参数 */
export interface SeedanceWorkspaceParams {
  prompt: string
  duration: number
  aspectRatio: string
  resolution: string
  assetUrls: string[]
  assetTypes: Record<string, 'image' | 'video' | 'audio'>
}

/** Seedance content 数组项类型 */
export type SeedanceContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' }

/** Seedance 工作台请求体 */
export interface SeedanceWorkspaceRequestBody {
  model: string
  content: SeedanceContentItem[]
  resolution: string
  ratio: string
  duration: number
  generate_audio: boolean
  watermark: boolean
}

/**
 * 构建 Seedance 工作台请求体（纯函数）
 *
 * - prompt → content 中的 text 项
 * - 图片素材 → content 中的 image_url 项（role=reference_image）
 * - 音频素材 → content 中的 audio_url 项（role=reference_audio）
 * - 视频素材暂不支持 reference_video
 */
export function buildSeedanceWorkspaceRequest(
  params: SeedanceWorkspaceParams
): SeedanceWorkspaceRequestBody {
  const content: SeedanceContentItem[] = [
    { type: 'text', text: params.prompt },
  ]

  for (const url of params.assetUrls) {
    const assetType = params.assetTypes[url]
    if (assetType === 'image') {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    } else if (assetType === 'audio') {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
    }
  }

  return {
    model: 'doubao-seedance-2-0-260128',
    content,
    resolution: params.resolution,
    ratio: params.aspectRatio,
    duration: params.duration,
    generate_audio: true,
    watermark: false,
  }
}
