/**
 * 按组生成上下文装配
 *
 * 为单组路由、链式首发、链式续接三处入队点统一装配 Seedance 生成所需的参考数据：
 * - reference_image：全片人物锚定图（Character.imageUrl，Seedream 受信产物 https URL）+ 本组无脸场景帧 + 非角色素材
 * - reference_audio：组音频（满足 Seedance 约束时）
 * - characterPrefix：拼到 prompt 最前的「图片N中的{角色}」引用（或外貌文字兜底）
 *
 * 全面放弃 first_frame：人物一致性由全片唯一人物锚定图承载，逐组独立引用，
 * 不依赖链式尾帧传递，逐组单独生成也保持一致。
 */
import { prisma } from './db'
import { getPublicUrl } from './storage'
import {
  buildGroupReferenceData,
  buildCharacterRefPrefix,
  type GroupAvatarRef,
} from './reference-builder'

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
  // 用其锚定图（Character.imageUrl，Seedream 受信产物）作 reference_image；外貌文字作无锚定图兜底
  const groupCharLinks = await prisma.shotGroupCharacter.findMany({
    where: { shotGroupId },
    include: {
      character: {
        select: { name: true, appearance: true, imageUrl: true, enabled: true, createdAt: true },
      },
    },
  })
  const characters = groupCharLinks
    .map((l) => l.character)
    .filter((c) => c.enabled)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const characterAvatars: GroupAvatarRef[] = characters
    .filter((c) => c.imageUrl && c.imageUrl.startsWith('https://') && !c.imageUrl.includes('localhost'))
    .map((c) => ({ name: c.name, assetUrl: c.imageUrl as string }))
  const appearanceFallback = characters
    .filter((c) => c.appearance && c.appearance.trim().length > 0)
    .map((c) => `${c.name}：${(c.appearance as string).trim()}`)
    .join('；')

  // 本组无脸场景帧：仅取当前组内 hasFace=false 分镜的 coverUrl（不再混入全项目其它组的帧）
  const sceneFrameUrls = group.shots
    .filter((s) => !s.hasFace && s.coverUrl)
    .map((s) => s.coverUrl as string)
    .filter((u) => u.startsWith('https://') && !u.includes('localhost'))

  const groupAudioUrl = group.audioKey ? getPublicUrl(group.audioKey) : undefined

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

  const characterPrefix = buildCharacterRefPrefix(ref.avatarRefs, ref.sceneRefIndices, appearanceFallback)

  return {
    referenceImages: ref.referenceImages,
    referenceAudioUrl: ref.referenceAudioUrl,
    characterPrefix,
  }
}
