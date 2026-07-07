/**
 * 资产库核心查询服务
 * 提供资产列表查询（分类筛选、关键字搜索、分页）、分类统计、删除、角色图获取、
 * 资产下载签名 URL 生成、跨项目角色图应用、项目与角色列表查询
 *
 * 核心规则：
 * - 所有查询均基于 userId 隔离，确保用户只能访问自己的资产
 * - 删除操作验证所有权，跨用户删除返回 403
 * - 删除时检查 Character.imageUrl 引用，有引用则不删除 OSS 文件
 * - 搜索基于 displayName 模糊匹配（大小写不敏感）
 * - 分页按 createdAt DESC 排序
 * - 下载通过 OSS 签名 URL 实现（10 分钟有效期）
 * - 跨项目应用直接引用同一 OSS URL，不复制文件
 */
import { prisma } from './db'
import { ApiError } from './api-error'
import { deleteObject, extractKeyFromUrl, isOSSConfigured, getSignedObjectUrl } from './storage'
import { logger } from './logger'
import { computeExpiryStatus, type ExpiryStatus } from './expiry-status'

// ========================
// 类型定义
// ========================

/** 资产分类枚举 */
export type AssetCategory = 'CHARACTER' | 'MATERIAL' | 'AUDIO'

/** 合法分类值集合 */
const VALID_CATEGORIES: AssetCategory[] = ['CHARACTER', 'MATERIAL', 'AUDIO']

/** 查询参数 */
export interface AssetLibraryQuery {
  userId: string
  category?: AssetCategory
  keyword?: string
  page?: number       // 默认 1
  pageSize?: number   // 默认 20，最大 100
}

/** 分页响应 */
export interface PaginatedAssets {
  items: AssetLibraryItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** 单条资产展示数据（含过期状态） */
export interface AssetLibraryItem {
  id: string
  displayName: string
  category: AssetCategory
  type: string
  url: string
  thumbUrl: string | null
  projectName: string | null
  fileSize: number | null
  createdAt: string
  expiryStatus: ExpiryStatus
  remainingDays: number | null
}

/** 分类统计 */
export interface CategoryCounts {
  CHARACTER: number
  MATERIAL: number
  AUDIO: number
  total: number
}

// ========================
// 核心方法
// ========================

/**
 * 查询资产列表（支持分类筛选、关键字搜索、分页）
 *
 * - userId 过滤（必选）
 * - category 筛选（可选）
 * - keyword 模糊搜索 displayName（可选，大小写不敏感）
 * - 分页：page 默认 1，pageSize 默认 20（最大 100）
 * - 按 createdAt DESC 排序
 */
export async function listAssets(query: AssetLibraryQuery): Promise<PaginatedAssets> {
  const { userId, category, keyword } = query

  // 参数规范化
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))

  // 构建查询条件
  const where: Record<string, unknown> = {
    userId,
    category: { not: null }, // 只查有分类的资产（资产库资产）
  }

  if (category) {
    where.category = category
  }

  if (keyword && keyword.trim()) {
    where.displayName = {
      contains: keyword.trim(),
      mode: 'insensitive',
    }
  }

  // 并行查询：总数 + 分页数据
  const [total, assets] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.asset.count({ where: where as any }),
    prisma.asset.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      include: {
        project: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const totalPages = Math.ceil(total / pageSize)

  const items: AssetLibraryItem[] = assets.map((asset: typeof assets[number]) => {
    const expiry = computeExpiryStatus(asset.expiresAt ?? null)
    return {
      id: asset.id,
      displayName: asset.displayName ?? asset.fileName ?? '未命名资产',
      category: asset.category as AssetCategory,
      type: asset.type,
      url: asset.url,
      thumbUrl: asset.thumbUrl ?? null,
      projectName: asset.project?.name ?? null,
      fileSize: asset.fileSize ?? null,
      createdAt: asset.createdAt.toISOString(),
      expiryStatus: expiry.status,
      remainingDays: expiry.remainingDays,
    }
  })

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  }
}

/**
 * 获取各分类资产数量和总计
 * 返回 CHARACTER / MATERIAL / AUDIO 各分类计数及总数
 */
export async function getCategoryCounts(userId: string): Promise<CategoryCounts> {
  const [characterCount, materialCount, audioCount] = await Promise.all([
    prisma.asset.count({
      where: { userId, category: 'CHARACTER' },
    }),
    prisma.asset.count({
      where: { userId, category: 'MATERIAL' },
    }),
    prisma.asset.count({
      where: { userId, category: 'AUDIO' },
    }),
  ])

  return {
    CHARACTER: characterCount,
    MATERIAL: materialCount,
    AUDIO: audioCount,
    total: characterCount + materialCount + audioCount,
  }
}

/**
 * 删除资产
 *
 * 流程：
 * 1. 查找资产记录
 * 2. 验证所有权（asset.userId === userId，否则 403）
 * 3. 检查是否有 Character.imageUrl 引用同一 URL（有则保留 OSS 文件）
 * 4. 无引用时删除 OSS 文件
 * 5. 删除数据库记录
 *
 * @throws ApiError NOT_FOUND - 资产不存在
 * @throws ApiError FORBIDDEN - 无权删除他人资产
 */
export async function deleteAsset(assetId: string, userId: string): Promise<void> {
  // 查找资产
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
  })

  if (!asset) {
    throw new ApiError('NOT_FOUND', '资产不存在', 404)
  }

  // 验证所有权
  if (asset.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权删除他人资产', 403)
  }

  // 检查 Character.imageUrl 是否引用同一 URL
  const referencingCharacter = await prisma.character.findFirst({
    where: { imageUrl: asset.url },
    select: { id: true },
  })

  const hasReference = !!referencingCharacter

  // 删除数据库记录
  await prisma.asset.delete({
    where: { id: assetId },
  })

  // 无引用时尝试删除 OSS 文件
  if (!hasReference && isOSSConfigured()) {
    const ossKey = extractKeyFromUrl(asset.url)
    if (ossKey) {
      try {
        await deleteObject(ossKey)
        logger.info('资产 OSS 文件已删除', { assetId, ossKey })
      } catch (error) {
        // OSS 删除失败不阻断主流程，记录日志（文件孤立由定期清理任务兜底）
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.error('资产 OSS 文件删除失败', { assetId, ossKey, error: errorMsg })
      }
    }
  } else if (hasReference) {
    logger.info('资产被 Character 引用，保留 OSS 文件', { assetId, url: asset.url })
  }
}

/**
 * 获取用户所有 CHARACTER 类型资产
 * 用于角色选择器展示可复用的角色图列表
 */
export async function getCharacterAssets(userId: string): Promise<AssetLibraryItem[]> {
  const assets = await prisma.asset.findMany({
    where: {
      userId,
      category: 'CHARACTER',
    },
    include: {
      project: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return assets.map((asset: typeof assets[number]) => {
    const expiry = computeExpiryStatus(asset.expiresAt ?? null)
    return {
      id: asset.id,
      displayName: asset.displayName ?? asset.fileName ?? '未命名角色',
      category: 'CHARACTER' as AssetCategory,
      type: asset.type,
      url: asset.url,
      thumbUrl: asset.thumbUrl ?? null,
      projectName: asset.project?.name ?? null,
      fileSize: asset.fileSize ?? null,
      createdAt: asset.createdAt.toISOString(),
      expiryStatus: expiry.status,
      remainingDays: expiry.remainingDays,
    }
  })
}

/**
 * 校验分类值是否合法
 * @returns 合法的分类值或 undefined（传入 null/undefined/无效值时）
 */
export function validateCategory(value: string | null | undefined): AssetCategory | undefined {
  if (!value) return undefined
  if (VALID_CATEGORIES.includes(value as AssetCategory)) {
    return value as AssetCategory
  }
  return undefined
}

// ========================
// 下载与跨项目应用相关类型
// ========================

/** 项目列表（含角色计数） */
export interface ProjectWithCharacters {
  id: string
  name: string
  characterCount: number
  updatedAt: string
}

/** 角色选项（用于角色选择器） */
export interface CharacterOption {
  id: string
  name: string
  imageUrl: string | null
}

// ========================
// 下载签名 URL
// ========================

/**
 * 生成资产下载签名 URL
 *
 * 流程：
 * 1. 查找资产记录
 * 2. 验证所有权（asset.userId === userId，否则 403）
 * 3. 从 asset.url 提取 OSS key
 * 4. 调用 getSignedObjectUrl 生成 10 分钟有效期签名 URL
 * 5. 返回 downloadUrl + 原始文件名
 *
 * @throws ApiError NOT_FOUND - 资产不存在
 * @throws ApiError FORBIDDEN - 无权访问该资产
 */
export async function generateDownloadUrl(
  assetId: string,
  userId: string
): Promise<{ downloadUrl: string; fileName: string }> {
  // 查找资产
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
  })

  if (!asset) {
    throw new ApiError('NOT_FOUND', '资产不存在', 404)
  }

  // 验证所有权
  if (asset.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权访问该资产', 403)
  }

  // 提取 OSS key
  const ossKey = extractKeyFromUrl(asset.url)
  if (!ossKey) {
    throw new ApiError('INTERNAL_ERROR', '无法解析资产存储路径', 500)
  }

  // 生成 10 分钟有效期签名 URL
  const downloadUrl = getSignedObjectUrl(ossKey, 600)

  // 使用原始文件名，无 fileName 时从 URL 提取或用 displayName
  const fileName = asset.fileName ?? asset.displayName ?? '未命名资产'

  return { downloadUrl, fileName }
}

// ========================
// 跨项目角色图应用
// ========================

/**
 * 将资产库角色图应用到目标项目的目标角色
 *
 * 流程：
 * 1. 验证资产所有权（asset.userId === userId → 403）
 * 2. 验证目标项目所有权（project.userId === userId → 403）
 * 3. 验证角色存在且属于目标项目（→ 404）
 * 4. 在 Prisma 事务中更新 character.imageUrl = asset.url
 * 5. 返回更新后的 Character
 *
 * 设计决策：直接引用同一 OSS URL，不复制文件（节省存储、保持一致性）
 *
 * @throws ApiError FORBIDDEN - 无权访问该资产 / 无权操作该项目
 * @throws ApiError NOT_FOUND - 目标角色不存在
 */
export async function applyToCharacter(
  assetId: string,
  targetProjectId: string,
  targetCharacterId: string,
  userId: string
) {
  // 验证资产存在并检查所有权
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
  })

  if (!asset) {
    throw new ApiError('NOT_FOUND', '资产不存在', 404)
  }

  if (asset.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权访问该资产', 403)
  }

  // 验证目标项目存在并检查所有权
  const targetProject = await prisma.project.findUnique({
    where: { id: targetProjectId },
  })

  if (!targetProject) {
    throw new ApiError('NOT_FOUND', '目标项目不存在', 404)
  }

  if (targetProject.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权操作该项目', 403)
  }

  // 验证目标角色存在且属于目标项目
  const character = await prisma.character.findFirst({
    where: {
      id: targetCharacterId,
      projectId: targetProjectId,
    },
  })

  if (!character) {
    throw new ApiError('NOT_FOUND', '目标角色不存在', 404)
  }

  // 在事务中更新 character.imageUrl（直接引用同一 OSS URL，不复制文件）
  const updatedCharacter = await prisma.$transaction(async (tx) => {
    return tx.character.update({
      where: { id: targetCharacterId },
      data: { imageUrl: asset.url },
    })
  })

  logger.info('角色图跨项目应用成功', {
    assetId,
    targetProjectId,
    targetCharacterId,
    userId,
    newImageUrl: asset.url,
  })

  return updatedCharacter
}

// ========================
// 项目与角色列表查询
// ========================

/**
 * 查询用户所有项目及各项目角色计数
 * 按 updatedAt DESC 排序（最近更新的排在前面）
 */
export async function listProjectsWithCharacterCount(
  userId: string
): Promise<ProjectWithCharacters[]> {
  const projects = await prisma.project.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: {
        select: { characters: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    characterCount: project._count.characters,
    updatedAt: project.updatedAt.toISOString(),
  }))
}

/**
 * 查询指定项目的角色列表
 * 验证项目所有权后返回角色 id、name、imageUrl
 *
 * @throws ApiError FORBIDDEN - 无权操作该项目
 * @throws ApiError NOT_FOUND - 项目不存在
 */
export async function listCharactersByProject(
  projectId: string,
  userId: string
): Promise<CharacterOption[]> {
  // 验证项目存在并检查所有权
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND', '项目不存在', 404)
  }

  if (project.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权操作该项目', 403)
  }

  const characters = await prisma.character.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      imageUrl: true,
    },
  })

  return characters.map((char) => ({
    id: char.id,
    name: char.name,
    imageUrl: char.imageUrl ?? null,
  }))
}
