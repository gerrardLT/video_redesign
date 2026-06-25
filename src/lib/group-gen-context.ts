/**
 * 按组生成上下文装配
 *
 * 为单组路由、链式首发、链式续接三处入队点统一装配 Seedance 生成所需的参考数据：
 * - reference_image：全片人物锚定图（Character.imageUrl）+ 本组无脸场景帧 + 非角色素材
 * - reference_audio：组音频（已配 OSS 时用签名 URL 确保私有 Bucket 可被抓取；
 *   未配 OSS 时本地 /uploads 路径可被 merge 阶段 resolveMediaUrlToLocal 消费；
 *   音频不可用时非静默暴露原因，调用方可见提示）
 * - characterPrefix：拼到 prompt 最前的「图片N中的{角色}」引用（或外貌文字兜底）
 *   当组内角色外观与全局 Character.appearance 存在差异时，追加外观描述文案到 characterPrefix
 *
 * 全面放弃 first_frame：人物一致性由全片唯一人物锚定图承载，逐组独立引用，
 * 不依赖链式尾帧传递，逐组单独生成也保持一致。
 */
import { prisma } from './db'
import { getPublicUrl, isOSSConfigured, getSignedObjectUrl } from './storage'
import {
  buildGroupReferenceData,
  buildCharacterRefPrefix,
  type GroupAvatarRef,
} from './reference-builder'
import {
  aggregateGroupAppearances,
  normalizeAppearanceText,
  formatAppearancePrompt,
} from './appearance-comparator'
import type { CharacterAppearanceRecord } from '@/types/appearance'

export interface GroupGenReference {
  /** reference_image 列表（asset:// 人物锚定在前，≤9 张） */
  referenceImages: string[]
  /** reference_audio URL（不满足约束时为 undefined） */
  referenceAudioUrl?: string
  /** 角色引用前缀，拼到 Seedance prompt 最前（含「图片N中的{角色}」或外貌兜底） */
  characterPrefix: string
}

/**
 * 按 shotGroupId 装配该组的 Seedance 参考数据与角色引用前缀。
 * 纯读 DB + 调用纯函数构建，无副作用。
 */
export async function buildGroupGenReference(shotGroupId: string): Promise<GroupGenReference> {
  const group = await prisma.shotGroup.findUniqueOrThrow({
    where: { id: shotGroupId },
    include: {
      shots: {
        orderBy: { orderIndex: 'asc' },
        include: {
          shotAssets: { select: { asset: { select: { url: true, isCharImage: true } } } },
        },
      },
    },
  })

  // 本组选中的人物（来自「分镜组↔人物」关联表，默认=该组镜头出现的人物，用户可增删）
  const groupCharLinks = await prisma.shotGroupCharacter.findMany({
    where: { shotGroupId },
    include: {
      character: {
        select: { name: true, appearance: true, imageUrl: true, enabled: true, createdAt: true },
      },
    },
  })
  const characters = groupCharLinks
    .filter((l) => l.character.enabled)
    .sort((a, b) => a.character.createdAt.getTime() - b.character.createdAt.getTime())

  const characterAvatars: GroupAvatarRef[] = characters
    .map((l) => ({ name: l.character.name, assetUrl: l.character.imageUrl }))
    .filter((c): c is GroupAvatarRef => !!c.assetUrl && c.assetUrl.startsWith('https://') && !c.assetUrl.includes('localhost'))

  const appearanceFallback = characters
    .filter((l) => l.character.appearance && l.character.appearance.trim().length > 0)
    .map((l) => `${l.character.name}：${(l.character.appearance as string).trim()}`)
    .join('；')

  // 本组无脸场景帧：优先取当前组内 hasFace=false 分镜的 coverUrl；
  // 若本组内无可用场景帧（如全部分镜都含人脸），则跨组查找项目内同场景的 hasFace=false 帧作为场景参考。
  // 真人帧（hasFace=true）不可作为 reference_image（Seedance 人脸输入审核会拦截非受信真人脸）。
  let sceneFrameUrls = group.shots
    .filter((s) => !s.hasFace && s.coverUrl)
    .map((s) => s.coverUrl as string)
    .filter((u) => u.startsWith('https://') && !u.includes('localhost'))

  // 跨组同场景帧补充：当本组无可用场景帧时，从项目其它组中查找场景描述匹配的 hasFace=false 帧
  if (sceneFrameUrls.length === 0) {
    // 取当前组首镜的 scene 描述作为匹配基准
    const firstShot = group.shots[0]
    const currentScene = firstShot?.scene?.trim().replace(/\s+/g, '').toLowerCase()

    if (currentScene) {
      // 查找项目内其它组中场景匹配且含 hasFace=false 帧的分镜
      const candidateShots = await prisma.shot.findMany({
        where: {
          projectId: group.projectId,
          shotGroupId: { not: shotGroupId },
          hasFace: false,
          coverUrl: { not: null },
        },
        select: { scene: true, coverUrl: true },
      })

      // 用 normScene 比对找同场景帧
      const crossGroupFrames = candidateShots
        .filter((s) => {
          const normalized = (s.scene ?? '').trim().replace(/\s+/g, '').toLowerCase()
          return normalized === currentScene
        })
        .map((s) => s.coverUrl as string)
        .filter((u) => u.startsWith('https://') && !u.includes('localhost'))

      if (crossGroupFrames.length > 0) {
        // 去重后取第一张（避免传入过多场景帧稀释人物权重）
        sceneFrameUrls = [crossGroupFrames[0]]
      }
    }
  }

  // 组音频 URL：已配 OSS 时生成短时效签名 URL（Bucket 私有读也可被 Seedance 抓取，
  // 且以 https:// 开头通过 isAudioRefUsable 检查）；未配 OSS 时走本地 /uploads 路径
  // （merge-video.ts resolveMediaUrlToLocal 可映射到 public 目录真实音频文件）
  let groupAudioUrl: string | undefined
  if (group.audioKey) {
    if (isOSSConfigured()) {
      groupAudioUrl = getSignedObjectUrl(group.audioKey, 600) // 10 分钟有效期，覆盖 Seedance 生成耗时
    } else {
      groupAudioUrl = getPublicUrl(group.audioKey) // 返回 /uploads/{key}，开发环境本地路径
    }
  }

  const ref = buildGroupReferenceData({
    shots: group.shots.map((s) => ({
      orderIndex: s.orderIndex,
      hasFace: s.hasFace,
      coverUrl: s.coverUrl,
      shotAssets: s.shotAssets.map((sa) => ({
        asset: { url: sa.asset.url, isCharImage: sa.asset.isCharImage },
      })),
    })),
    characterAvatars,
    sceneFrameUrls,
    groupAudioUrl,
    groupDuration: group.endTime - group.startTime,
  })

  // 音频参考不可用时非静默暴露（遵守用户铁律：禁止静默处理）
  if (ref.audioUnavailableReason) {
    console.error(
      `[group-gen-context] 组 ${shotGroupId} 音频参考不可用: ${ref.audioUnavailableReason}`
    )
  }

  let characterPrefix = buildCharacterRefPrefix(ref.avatarRefs, ref.sceneRefIndices, appearanceFallback)

  // === 外观感知增强：读取组内 Shots 外观数据，比对全局角色外观，差异时追加到 prompt ===

  // 1. 读取组内所有 Shots 的 characterAppearances（JSON 解析，失败时视为空数组）
  const shotAppearancesRaw: CharacterAppearanceRecord[] = []
  for (const shot of group.shots) {
    if (!shot.characterAppearances) {
      continue
    }
    try {
      const parsed = JSON.parse(shot.characterAppearances) as CharacterAppearanceRecord
      if (Array.isArray(parsed)) {
        shotAppearancesRaw.push(parsed)
      }
    } catch (e) {
      // JSON 解析失败时记录警告，视为空数组继续
      console.warn(
        `[group-gen-context] 组 ${shotGroupId} 分镜外观数据 JSON 解析失败:`,
        e instanceof Error ? e.message : e
      )
    }
  }

  // 2. 有外观数据时进行聚合与比对
  if (shotAppearancesRaw.length > 0) {
    // 调用 aggregateGroupAppearances 获取组级代表外观 Map
    const groupAppearanceMap = aggregateGroupAppearances(
      shotAppearancesRaw.map((record) =>
        record.map((item) => ({ name: item.name, appearance: item.appearance }))
      )
    )

    // 3. 遍历组外观 Map 中每个角色，与全局 Character.appearance 比对
    for (const [charName, groupAppearance] of groupAppearanceMap) {
      // 查找对应全局角色的 appearance 文本
      const globalChar = characters.find((l) => l.character.name === charName)
      const globalAppearanceText = globalChar?.character.appearance?.trim() ?? ''

      // 将组级聚合外观四个维度非空值拼接，作为组外观文本
      const groupDimensions = [
        groupAppearance.hair,
        groupAppearance.clothing,
        groupAppearance.accessories,
        groupAppearance.makeup,
      ].filter((v) => v.trim() !== '')

      // 所有维度均为空时跳过该角色
      if (groupDimensions.length === 0) {
        continue
      }

      const groupAppearanceText = groupDimensions.join('、')

      // 规范化后比较：全局 appearance 与组级聚合外观文本
      const normalizedGlobal = normalizeAppearanceText(globalAppearanceText)
      const normalizedGroup = normalizeAppearanceText(groupAppearanceText)

      // 一致时跳过追加（规范化后文本相同视为一致）
      if (normalizedGlobal === normalizedGroup) {
        continue
      }

      // 差异时调用 formatAppearancePrompt 生成文案拼接到 characterPrefix
      const appearancePrompt = formatAppearancePrompt(charName, groupAppearance)
      if (appearancePrompt) {
        characterPrefix += appearancePrompt
      }
    }
  }

  // 背景图注入：若分镜组设置了 backgroundImageUrl，将其追加到 referenceImages
  // （Seedance 模式下作为 reference_image 影响画面风格）
  const finalReferenceImages = [...ref.referenceImages]
  if (group.backgroundImageUrl) {
    finalReferenceImages.push(group.backgroundImageUrl)
  }

  return {
    referenceImages: finalReferenceImages,
    referenceAudioUrl: ref.referenceAudioUrl,
    characterPrefix,
  }
}
