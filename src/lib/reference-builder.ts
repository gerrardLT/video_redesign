/**
 * 统一参考数据构建模块
 * 单分镜和批量生成均通过此模块构建 Seedance 参考数据，确保一致性
 *
 * 修复 Bug 1.4 (单/批量不一致)、1.5 (短视频 prompt 合并有损)
 *
 * 参考模型：全面放弃 first_frame / reference_video（含真人帧/视频会被 Seedance
 * 人脸审核拦截），统一走「文本 + 多模态参考(reference_image/reference_audio)」。
 *
 * v2: 新增虚拟角色模式 (buildAvatarReferenceData)
 * 使用 asset:// 虚拟人像素材 + 无人脸场景帧组合，绕过 Seedance 真人人脸检测
 */

import { resolveReferences } from './prompt-parser'

// ========================
// 接口定义
// ========================

/**
 * 带素材信息的分镜数据
 */
export interface ShotWithAssets {
  id: string
  orderIndex: number
  coverUrl: string | null
  prompt: string | null
  shotAssets: Array<{ displayNum: number; asset: { url: string; isCharImage?: boolean } }>
}

/**
 * Seedance 参考数据（构建结果）
 * 仅多模态参考：reference_image + reference_audio（无 first_frame / reference_video）
 */
export interface ReferenceData {
  cleanPrompt: string
  referenceImages: string[]
  referenceAudioUrl?: string
}

/**
 * buildReferenceData 的输入参数
 */
export interface BuildReferenceParams {
  shot: ShotWithAssets
  projectId: string
  /** 不含人脸的场景帧 URL 列表（hasFace=false 的分镜 coverUrl），作为 reference_image */
  sceneFrameUrls?: string[]
  /** 该分镜所属 ShotGroup 的音频 URL（来自 ShotGroup.audioKey 转换后的公网 URL） */
  groupAudioUrl?: string
}

// ========================
// 辅助函数
// ========================

/**
 * 判断 URL 是否为可用的公网地址
 * - 必须以 https:// 开头
 * - 不能包含 localhost（排除本地开发环境 URL）
 */
function isPublicUrl(url: string | null | undefined): url is string {
  if (!url) return false
  return url.startsWith('https://') && !url.includes('localhost')
}

// ========================
// 核心函数
// ========================

/**
 * 统一构建 Seedance 参考数据
 * 单分镜和批量生成均调用此函数，确保一致性
 *
 * 构建逻辑：
 * 1. 解析 [图N] 引用 → cleanPrompt
 * 2. reference_image: 不含人脸的场景帧(hasFace=false 的分镜 coverUrl) + 分镜关联的素材图(排除人物)
 * 3. reference_audio: 该分镜所属 ShotGroup 的组音频（仅在有参考图时才传，否则会被拒绝）
 *
 * 注意：不传 reference_video（含真人会被 Seedance 拦截）
 * 含人脸的帧不传（会被人脸检测拦截），人物完全由 prompt 文本描述生成
 */
export function buildReferenceData(params: BuildReferenceParams): ReferenceData {
  const { shot, sceneFrameUrls = [], groupAudioUrl } = params

  // 1. 解析 [图N] 引用 → cleanPrompt（移除 prompt 中的 [图N] 标记）
  const { cleanPrompt } = resolveReferences(
    shot.prompt || '',
    shot.shotAssets
  )

  // 2. reference_image: 无人脸场景帧 + 分镜关联的素材图（排除人物角色图）
  const sceneImages = sceneFrameUrls.filter(isPublicUrl)
  const assetImages = shot.shotAssets
    .filter(sa => !sa.asset.isCharImage)
    .map(sa => sa.asset.url)
    .filter(isPublicUrl)

  // 去重 + 限制 9 张
  const referenceImages = Array.from(new Set([...sceneImages, ...assetImages])).slice(0, 9)

  // 3. reference_audio: 使用该分镜所属 ShotGroup 的组音频（parse 阶段按组切片并上传 OSS）
  //    reference_audio 不能单独使用，必须配合至少 1 张参考图
  const referenceAudioUrl =
    referenceImages.length > 0 && isPublicUrl(groupAudioUrl) ? groupAudioUrl : undefined

  return {
    cleanPrompt,
    referenceImages,
    referenceAudioUrl,
  }
}


// ========================
// 按组参考数据构建（asset:// 人物锚定模式 / 多模态参考，放弃 first_frame）
// ========================

/**
 * 判断 URL 是否可作为 reference_image：方舟 asset:// 素材 或 公网 https 图
 */
function isReferenceUsableUrl(url: string | null | undefined): url is string {
  if (!url) return false
  return url.startsWith('asset://') || isPublicUrl(url)
}

/** 全片人物锚定资产引用（Character.imageUrl，Seedream 受信产物 https URL；或 asset:// 预置/授权素材） */
export interface GroupAvatarRef {
  /** 角色名（用于 prompt「图片N中的{角色名}」引用） */
  name: string
  /** 人物锚定图 URL：https 公网图（Seedream 受信产物）或 asset:// 素材 */
  assetUrl: string
}

/**
 * 按组生成的参考数据输入（asset:// 人物锚定模式）
 */
export interface GroupReferenceParams {
  /** 组内分镜（按 orderIndex 升序），需含 hasFace / coverUrl / shotAssets */
  shots: Array<{
    orderIndex: number
    hasFace: boolean
    coverUrl: string | null
    shotAssets: Array<{ asset: { url: string; isCharImage?: boolean } }>
  }>
  /**
   * 全片人物锚定资产（asset://，已入库且 ACTIVE）。按固定顺序排列，
   * 排在 reference_image 最前，对应 prompt 中的「图片1、图片2...」。
   */
  characterAvatars: GroupAvatarRef[]
  /** 本组无脸场景帧 URL（组内 hasFace=false 分镜的 coverUrl），作为本组场景背景参考 */
  sceneFrameUrls: string[]
  /** 组音频 OSS 公网 URL（来自 ShotGroup.audioKey），无则 undefined */
  groupAudioUrl?: string
  /** 组的原始时长（endTime - startTime，秒）。用于校验音频是否满足 Seedance 最低时长要求 */
  groupDuration?: number
}

/**
 * 按组参考数据输出（多模态参考模式，无 first_frame）
 */
export interface GroupReferenceData {
  /** reference_image：人物锚定图 + 本组场景帧 + 非角色素材，去重、≤9 张，人物图在前 */
  referenceImages: string[]
  /** reference_audio：仅当 referenceImages 非空且 groupAudioUrl 有效时传（Seedance 硬约束） */
  referenceAudioUrl?: string
  /** 人物锚定资产在 referenceImages 中的 1 基序号（供 prompt「@图片N中的{角色}」引用） */
  avatarRefs: Array<{ name: string; imageIndex: number }>
  /** 场景帧在 referenceImages 中的 1 基序号（供 prompt「@图片N作为场景参考」引用） */
  sceneRefIndices: number[]
}

/** reference_image 数量上限（Seedance 限制 0~9 张） */
const MAX_GROUP_REFERENCE_IMAGES = 9

/** 本组场景帧上限：官方建议场景图 1 张即可，过多会稀释主体权重、引发风格冲突 */
const MAX_SCENE_FRAMES = 1

/**
 * 构建按组生成的 Seedance 参考数据（asset:// 人物锚定模式）。
 *
 * 设计原则（遵守官方受信规则 + 全片人物一致性）：
 * - 全面放弃 first_frame，统一走「多模态参考生视频」：人物身份由 asset:// 锚定资产承载，
 *   场景由无脸帧承载，每组独立引用同一批 asset://，逐组单独生成也保持人物一致；
 * - reference_image 顺序：人物锚定 asset:// 在前（对应 prompt「图片1、图片2...」），
 *   其后是无脸场景帧与非角色素材图；
 * - 绝不把原视频真人帧塞进 reference_image（未受信会被人脸审核拦截）；
 * - reference_audio 必须配合至少 1 张参考图，否则 Seedance 拒绝。
 *
 * 纯函数，无 I/O。
 */
export function buildGroupReferenceData(params: GroupReferenceParams): GroupReferenceData {
  const { shots, characterAvatars, sceneFrameUrls, groupAudioUrl, groupDuration } = params

  /** Seedance reference_audio 最低时长要求（秒） */
  const MIN_AUDIO_DURATION = 1.8

  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

  // 1. 人物锚定图（Seedream 受信产物 https 或 asset:// 素材）排最前，记录 1 基序号供 prompt 引用
  const avatarUrls = characterAvatars
    .map((a) => a.assetUrl)
    .filter((u): u is string => isReferenceUsableUrl(u))

  // 2. 本组场景帧（上限 1 张）+ 组内非角色素材图
  const sceneImages = sceneFrameUrls.filter(isPublicUrl).slice(0, MAX_SCENE_FRAMES)
  const assetImages = sorted
    .flatMap((s) => s.shotAssets)
    .filter((sa) => !sa.asset.isCharImage)
    .map((sa) => sa.asset.url)
    .filter(isReferenceUsableUrl)

  // 合并去重，人物锚定在前、场景帧居中、素材在后，限制 ≤9 张
  const referenceImages = Array.from(
    new Set([...avatarUrls, ...sceneImages, ...assetImages])
  ).slice(0, MAX_GROUP_REFERENCE_IMAGES)

  // 人物锚定图在最终 referenceImages 中的 1 基序号（去重/截断后重新定位）
  const avatarRefs = characterAvatars
    .filter((a) => isReferenceUsableUrl(a.assetUrl))
    .map((a) => ({ name: a.name, imageIndex: referenceImages.indexOf(a.assetUrl) + 1 }))
    .filter((r) => r.imageIndex > 0)

  // 场景帧在最终 referenceImages 中的 1 基序号（供 prompt 引用为「场景参考」）
  const sceneRefIndices = sceneImages
    .map((u) => referenceImages.indexOf(u) + 1)
    .filter((idx) => idx > 0)

  // 3. reference_audio：仅在有参考图且组时长满足最低要求时才传（Seedance 不接受单独音频）
  const audioMeetsDuration = groupDuration === undefined || groupDuration >= MIN_AUDIO_DURATION
  const referenceAudioUrl =
    referenceImages.length > 0 && isPublicUrl(groupAudioUrl) && audioMeetsDuration
      ? groupAudioUrl
      : undefined

  return {
    referenceImages,
    referenceAudioUrl,
    avatarRefs,
    sceneRefIndices,
  }
}

/**
 * 构建人物/场景引用前缀，拼到 Seedance prompt 最前。
 *
 * 官方规范：提示词必须用「图片N」指代参考图（不能用 asset ID），并推荐用「@图片N」强绑定主体。
 * - 有锚定图时：「@图片1中的{角色A}、@图片2中的{角色B}作为主角[，@图片K作为场景参考]，」
 * - 无锚定图时：回退用外貌文字描述兜底（避免人物裸奔漂移）[+ 场景参考]，都没有则空串。
 */
export function buildCharacterRefPrefix(
  avatarRefs: Array<{ name: string; imageIndex: number }>,
  sceneRefIndices: number[] = [],
  appearanceFallback?: string
): string {
  const parts: string[] = []

  if (avatarRefs.length > 0) {
    const charPart = [...avatarRefs]
      .sort((a, b) => a.imageIndex - b.imageIndex)
      .map((r) => `@图片${r.imageIndex}中的${r.name}`)
      .join('、')
    parts.push(`${charPart}作为主角`)
  } else {
    const fallback = appearanceFallback?.trim()
    if (fallback) parts.push(fallback)
  }

  if (sceneRefIndices.length > 0) {
    const scenePart = sceneRefIndices.map((i) => `@图片${i}`).join('、')
    parts.push(`${scenePart}作为场景参考`)
  }

  return parts.length > 0 ? `${parts.join('，')}，` : ''
}


// ========================
// V2: 虚拟角色模式接口与函数
// ========================

/**
 * 虚拟角色参考数据
 */
export interface AvatarReferenceData {
  avatarAssetUrl: string     // asset://asset-xxxxx
  characterName: string
}

/**
 * buildAvatarReferenceData 的输入参数
 */
export interface BuildReferenceParamsV2 {
  shot: ShotWithAssets       // 复用现有类型
  projectId: string
  avatarReferences: AvatarReferenceData[]   // 虚拟角色 asset:// URLs
  sceneFrameUrls: string[]                  // 无人脸的场景帧 URL（调用方已筛选 hasFace=false）
}

/**
 * 虚拟角色模式的参考数据输出
 */
export interface ReferenceDataV2 {
  cleanPrompt: string              // 包含素材引用描述的 prompt
  referenceImages: string[]        // asset:// URLs + scene frame URLs（已排序）
}

/** reference_image 数量上限（Seedance 限制） */
const MAX_REFERENCE_IMAGES = 9

/**
 * 构建虚拟角色模式的参考数据
 * 仅使用 text + reference_image 组合，不传 reference_video/reference_audio
 *
 * 核心逻辑：
 * 1. content 排序：虚拟角色 asset:// URL 在前，场景帧 https:// URL 在后
 * 2. 总 reference_image 数量不超过 9 张，超过时截断（优先保留虚拟角色图）
 * 3. Prompt 生成：使用"图片N"格式引用素材
 *    - 虚拟角色标注为"角色外观参考"
 *    - 场景帧标注为"场景背景参考"
 * 4. 无可用场景帧时仅使用虚拟角色图
 */
export function buildAvatarReferenceData(params: BuildReferenceParamsV2): ReferenceDataV2 {
  const { shot, avatarReferences, sceneFrameUrls } = params

  // 1. 收集虚拟角色 asset:// URLs（排在前面）
  const avatarUrls = avatarReferences
    .map(ref => ref.avatarAssetUrl)
    .filter(url => url && url.startsWith('asset://'))

  // 2. 收集场景帧 URLs（排在后面）
  const validSceneUrls = sceneFrameUrls.filter(url => url && url.startsWith('https://'))

  // 3. 合并并截断至 MAX_REFERENCE_IMAGES
  //    优先保留虚拟角色图：先截取角色图（最多 MAX_REFERENCE_IMAGES 张），剩余空间给场景帧
  const avatarSlice = avatarUrls.slice(0, MAX_REFERENCE_IMAGES)
  const remainingSlots = MAX_REFERENCE_IMAGES - avatarSlice.length
  const sceneSlice = validSceneUrls.slice(0, Math.max(0, remainingSlots))

  // 4. 最终排序：asset:// 在前，https:// 在后
  const referenceImages = [...avatarSlice, ...sceneSlice]

  // 5. 生成带素材引用的 prompt
  const cleanPrompt = buildAvatarPrompt(
    shot.prompt || '',
    avatarReferences.slice(0, avatarSlice.length),
    sceneSlice.length
  )

  return {
    cleanPrompt,
    referenceImages,
  }
}

/**
 * 生成虚拟角色模式的 prompt 文本
 * 格式示例：
 * - 1角色+1场景帧: "图片1中的{角色名}（角色外观参考）在图片2的场景中（场景背景参考），{原始prompt}"
 * - 2角色+2场景帧: "图片1中的{角色A}和图片2中的{角色B}（角色外观参考）在图片3和图片4的场景中（场景背景参考），{prompt}"
 * - 仅角色无场景帧: "图片1中的{角色名}（角色外观参考），{原始prompt}"
 */
function buildAvatarPrompt(
  originalPrompt: string,
  avatarRefs: AvatarReferenceData[],
  sceneCount: number
): string {
  if (avatarRefs.length === 0) {
    return originalPrompt
  }

  // 构建角色引用部分
  // "图片1中的{角色A}" / "图片1中的{角色A}和图片2中的{角色B}"
  const avatarParts = avatarRefs.map((ref, idx) => {
    const imgNum = idx + 1
    return `图片${imgNum}中的${ref.characterName}`
  })

  const avatarDesc = avatarParts.length === 1
    ? avatarParts[0]
    : avatarParts.join('和')

  // 构建场景帧引用部分
  // 场景帧的图片编号从 avatarRefs.length + 1 开始
  let sceneDesc = ''
  if (sceneCount > 0) {
    const sceneStartIdx = avatarRefs.length + 1
    if (sceneCount === 1) {
      sceneDesc = `在图片${sceneStartIdx}的场景中（场景背景参考）`
    } else {
      const sceneNums = Array.from({ length: sceneCount }, (_, i) => `图片${sceneStartIdx + i}`)
      sceneDesc = `在${sceneNums.join('和')}的场景中（场景背景参考）`
    }
  }

  // 组装最终 prompt
  const trimmedOriginal = originalPrompt.replace(/\[图\d+\]/g, '').replace(/\s{2,}/g, ' ').trim()

  if (sceneCount > 0) {
    return `${avatarDesc}（角色外观参考）${sceneDesc}，${trimmedOriginal}`
  } else {
    return `${avatarDesc}（角色外观参考），${trimmedOriginal}`
  }
}
