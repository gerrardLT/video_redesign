/**
 * 资产生命周期服务
 * 负责资产过期检测、批量标记、文件清理和统计查询
 *
 * 核心规则：
 * - 永久资产保护：category 有值的资产视为永久资产，不设置过期时间、不续期
 * - 只有 type='AI_GENERATED' 且 category 为空的资产才设置过期时间
 * - 过期判断：expiresAt IS NOT NULL AND expiresAt <= now() AND status != 'EXPIRED'
 * - 文件清理先标记状态再删除文件（确保即使删除失败也不会重复处理）
 * - 批量处理避免一次性加载过多数据
 */
import { z } from 'zod'
import { prisma } from './db'
import { deleteObject } from './storage'
import { logger } from './logger'

// ========================
// Zod 参数校验
// ========================

const setExpirySchema = z.object({
  assetId: z.string().min(1, '资产ID不能为空'),
  days: z.number().int().positive().default(14),
})

const getExpiredAssetsSchema = z.object({
  batchSize: z.number().int().positive().max(1000).default(100),
})

const markExpiredSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1, '资产ID列表不能为空'),
})

const getExpiringAssetsSchema = z.object({
  daysBeforeExpiry: z.number().int().positive().default(3),
})

const getUserAssetStatsSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
})

// ========================
// 类型定义
// ========================

export interface AssetStats {
  total: number
  expiringSoon: number
  expired: number
}

export interface CleanupResult {
  success: boolean
  assetId: string
  error?: string
}

// ========================
// 服务实现
// ========================

/**
 * 为资产设置过期时间
 * - 永久资产保护：category 有值的资产跳过过期设置
 * - 仅对 type='AI_GENERATED' 的资产生效
 * - expiresAt = createdAt + days 天
 */
export async function setExpiry(
  assetId: string,
  days: number = 14
): Promise<void> {
  const params = setExpirySchema.parse({ assetId, days })

  const asset = await prisma.asset.findUnique({
    where: { id: params.assetId },
  })

  if (!asset) {
    throw new Error(`资产不存在: ${params.assetId}`)
  }

  // 永久资产保护：category 有值则跳过过期设置
  if (asset.category) {
    logger.info('永久资产，跳过过期设置', { assetId: params.assetId, category: asset.category })
    return
  }

  if (asset.type !== 'AI_GENERATED') {
    logger.info('非 AI 生成资产，跳过过期设置', { assetId: params.assetId, type: asset.type })
    return
  }

  const expiresAt = new Date(asset.createdAt.getTime() + params.days * 24 * 60 * 60 * 1000)

  await prisma.asset.update({
    where: { id: params.assetId },
    data: { expiresAt },
  })

  logger.info('资产过期时间已设置', {
    assetId: params.assetId,
    expiresAt: expiresAt.toISOString(),
  })
}

/**
 * 查询已过期但未标记删除的资产列表（排除永久资产）
 * - 排除永久资产：expiresAt 为 null 的记录不会被扫描
 * - 过期判断：expiresAt IS NOT NULL AND expiresAt <= now() AND status != 'EXPIRED'
 */
export async function getExpiredAssets(batchSize: number = 100) {
  const params = getExpiredAssetsSchema.parse({ batchSize })

  const now = new Date()

  const assets = await prisma.asset.findMany({
    where: {
      expiresAt: {
        not: null,   // 排除永久资产（expiresAt 为 null 的记录）
        lte: now,    // 已过期
      },
      status: { not: 'EXPIRED' },
    },
    take: params.batchSize,
    orderBy: { expiresAt: 'asc' },
  })

  return assets
}

/**
 * 批量标记资产为 EXPIRED 状态
 * 使用事务确保数据一致性
 */
export async function markExpired(assetIds: string[]): Promise<void> {
  const params = markExpiredSchema.parse({ assetIds })

  await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: {
        id: { in: params.assetIds },
        status: { not: 'EXPIRED' },
      },
      data: { status: 'EXPIRED' },
    })
  })

  logger.info('资产已批量标记为过期', { count: params.assetIds.length })
}

/**
 * 删除 OSS/本地文件
 * 策略：先标记状态再删除文件
 * - 确保即使删除失败也不会重复处理
 * - 通过 storage.ts 的 deleteObject 抽象接口操作
 */
export async function cleanupExpiredFiles(
  assets: Array<{ id: string; url: string }>
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = []

  for (const asset of assets) {
    try {
      // 先标记为 EXPIRED 状态（即使后续文件删除失败，也不会被重复扫描）
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'EXPIRED' },
      })

      // 删除 OSS/本地文件
      await deleteObject(asset.url)

      results.push({ success: true, assetId: asset.id })
      logger.info('资产文件已清理', { assetId: asset.id, url: asset.url })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      results.push({ success: false, assetId: asset.id, error: errorMsg })
      logger.error('资产文件清理失败', { assetId: asset.id, url: asset.url, error: errorMsg })
    }
  }

  return results
}

/**
 * 查询 N 天内即将过期的资产（用于通知）
 * 范围：now < expiresAt <= now + daysBeforeExpiry 天
 * 排除已过期（status = 'EXPIRED'）的资产
 */
export async function getExpiringAssets(daysBeforeExpiry: number = 3) {
  const params = getExpiringAssetsSchema.parse({ daysBeforeExpiry })

  const now = new Date()
  const futureDate = new Date(now.getTime() + params.daysBeforeExpiry * 24 * 60 * 60 * 1000)

  const assets = await prisma.asset.findMany({
    where: {
      expiresAt: {
        gt: now,
        lte: futureDate,
      },
      status: { not: 'EXPIRED' },
    },
    include: {
      project: {
        select: { id: true, name: true, userId: true },
      },
    },
    orderBy: { expiresAt: 'asc' },
  })

  return assets
}

/**
 * 获取用户资产统计
 * - total: 用户资产总数
 * - expiringSoon: 3 天内即将过期的资产数
 * - expired: 已过期的资产数
 */
export async function getUserAssetStats(userId: string): Promise<AssetStats> {
  const params = getUserAssetStatsSchema.parse({ userId })

  const now = new Date()
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const [total, expiringSoon, expired] = await Promise.all([
    // 用户资产总数
    prisma.asset.count({
      where: { userId: params.userId },
    }),
    // 3 天内即将过期的资产数
    prisma.asset.count({
      where: {
        userId: params.userId,
        expiresAt: {
          gt: now,
          lte: threeDaysLater,
        },
        status: { not: 'EXPIRED' },
      },
    }),
    // 已过期的资产数
    prisma.asset.count({
      where: {
        userId: params.userId,
        status: 'EXPIRED',
      },
    }),
  ])

  return { total, expiringSoon, expired }
}

/**
 * 计算资产剩余有效天数
 * 结果范围在 0 到 14 之间
 */
export function getRemainingDays(expiresAt: Date): number {
  const now = new Date()
  const diff = expiresAt.getTime() - now.getTime()
  if (diff <= 0) return 0
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  return Math.min(days, 14)
}

/**
 * 检查资产是否已过期
 */
export function isAssetExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false
  return new Date() >= expiresAt
}

/**
 * 续期资产：从当前时间起重新延长有效期
 * - 永久资产无需续期：category 有值的资产跳过续期
 * - 仅对 status != 'EXPIRED' 的资产生效（已清理的无法续期）
 *
 * @param assetId 资产 ID
 * @param days 续期天数（默认 14 天）
 * @throws 资产不存在或已过期清理时抛错
 */
export async function renewExpiry(assetId: string, days: number = 14): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } })

  if (!asset) {
    throw new Error(`资产不存在: ${assetId}`)
  }

  if (asset.status === 'EXPIRED') {
    throw new Error(`资产已过期清理，无法续期: ${assetId}`)
  }

  // 永久资产无需续期
  if (asset.category) {
    logger.info('永久资产，跳过续期', { assetId, category: asset.category })
    return
  }

  if (asset.type !== 'AI_GENERATED') {
    logger.info('非 AI 生成资产，跳过续期', { assetId, type: asset.type })
    return
  }

  const newExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  await prisma.asset.update({
    where: { id: assetId },
    data: { expiresAt: newExpiresAt },
  })

  logger.info('资产已续期', {
    assetId,
    newExpiresAt: newExpiresAt.toISOString(),
    days,
  })
}
