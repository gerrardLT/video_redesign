/**
 * 资产自动入库服务 (AssetIngestionService)
 *
 * 负责将 Worker 生成的角色图自动入库到用户资产库。
 * 核心语义：upsert —— 同一用户 + 同一角色（characterId）下只保留一条 CHARACTER 资产，
 * 再生成时更新 URL 而非新增记录，保证幂等和无重复。
 */

import { prisma } from './db'
import type { Asset } from '@/generated/prisma'

// ========================
// 类型定义
// ========================

export interface IngestCharacterImageParams {
  /** 用户 ID */
  userId: string
  /** 项目 ID */
  projectId: string
  /** 角色 ID（用于 upsert 唯一性判断） */
  characterId: string
  /** 角色名称（作为资产 displayName） */
  characterName: string
  /** 生成的图片 URL */
  imageUrl: string
  /** 缩略图 URL（可选） */
  thumbUrl?: string
}

// ========================
// 核心方法
// ========================

/**
 * 自动入库角色图（upsert 语义）
 *
 * 查找条件：同一 userId + 同一 characterId 关联的 CHARACTER 类型资产。
 * 由于 Asset 模型无 characterId 字段，使用 fileName 存储 characterId 标识
 * （格式：`char:{characterId}`），结合 userId + category='CHARACTER' + isCharImage=true 进行唯一匹配。
 *
 * - 若已存在：更新 url、thumbUrl、displayName（角色可能改名）
 * - 若不存在：创建新的 Asset 记录
 *
 * @param params 入库参数
 * @returns 入库后的 Asset 记录
 */
export async function ingestCharacterImage(params: IngestCharacterImageParams): Promise<Asset> {
  const { userId, projectId, characterId, characterName, imageUrl, thumbUrl } = params

  // 用于标识角色唯一性的 fileName 格式
  const characterTag = `char:${characterId}`

  // 查找是否已存在该角色的入库记录
  const existing = await prisma.asset.findFirst({
    where: {
      userId,
      category: 'CHARACTER',
      isCharImage: true,
      fileName: characterTag,
    },
  })

  if (existing) {
    // 更新已有记录（再生成场景：URL 更新为最新生成结果）
    const updated = await prisma.asset.update({
      where: { id: existing.id },
      data: {
        url: imageUrl,
        thumbUrl: thumbUrl ?? existing.thumbUrl,
        displayName: characterName,
        status: 'UPLOADED',
      },
    })
    return updated
  }

  // 创建新的资产记录
  const created = await prisma.asset.create({
    data: {
      userId,
      projectId,
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: characterName,
      url: imageUrl,
      thumbUrl: thumbUrl ?? null,
      fileName: characterTag,
      isCharImage: true,
      status: 'UPLOADED',
      sortOrder: 0,
    },
  })

  return created
}
