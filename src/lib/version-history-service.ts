/**
 * 版本历史管理服务
 *
 * 为每个分镜组（ShotGroup）提供视频生成结果的版本管理能力：
 * - 生成成功后自动创建版本记录
 * - 版本数量上限控制（超限自动淘汰最旧非当前版本）
 * - 版本切换（零消耗，仅更新引用）
 * - 版本删除（当前版本禁止删除）
 *
 * 所有涉及 isCurrent 变更的操作在单一 Prisma 事务内完成，确保一致性。
 * OSS 文件删除采用 best-effort：数据库记录优先处理，文件删除失败仅记录日志不回滚。
 */

import { prisma } from './db'
import { deleteObject, extractKeyFromUrl } from './storage'
import { logger } from './logger'
import { ApiError } from './api-error'
import type { GenerationVersion } from '@/generated/prisma'

/** 版本数量上限，可通过环境变量配置 */
export const VERSION_LIMIT = parseInt(process.env.VERSION_LIMIT ?? '10', 10)

// ========================
// 类型定义
// ========================

export interface CreateVersionInput {
  shotGroupId: string
  videoUrl: string       // OSS 上的视频 URL
  coverUrl?: string      // 封面 URL
  lastFrameUrl?: string  // 尾帧 URL
  promptSnapshot: string // 本次生成使用的 prompt
  costEstimate: number   // 本次生成消耗的积分
  generationJobId: string // 关联的 GenerationJob ID
}

// ========================
// 工具函数
// ========================

/**
 * 获取 prompt 前 30 个字符作为摘要
 * - 如果原文超过 30 字符，截断并追加 "..."
 * - 如果原文为空/null，返回 "(无提示词)"
 */
export function getPromptExcerpt(prompt: string | null): string {
  if (!prompt || prompt.length === 0) {
    return '(无提示词)'
  }
  if (prompt.length > 30) {
    return prompt.slice(0, 30) + '...'
  }
  return prompt
}

// ========================
// 核心服务方法
// ========================

/**
 * 创建新版本（生成成功后调用）
 *
 * 在 Prisma 事务内完成以下操作：
 * 1. 查询当前版本数
 * 2. 超限时淘汰最旧非当前版本（删除 DB 记录 + best-effort 删除 OSS 文件）
 * 3. 计算 nextVersionNumber = max(versionNumber) + 1
 * 4. 创建 GenerationVersion 记录（isCurrent=true）
 * 5. 旧的当前版本 isCurrent=false
 * 6. 更新 ShotGroup.genVideoUrl/genCoverUrl/lastFrameUrl
 *
 * @param input - 版本创建输入参数
 * @returns 新创建的版本记录
 */
export async function createVersion(input: CreateVersionInput): Promise<GenerationVersion> {
  const {
    shotGroupId,
    videoUrl,
    coverUrl,
    lastFrameUrl,
    promptSnapshot,
    costEstimate,
    generationJobId,
  } = input

  // 收集需要在事务外 best-effort 删除的 OSS 文件 URL
  let filesToDelete: string[] = []

  const newVersion = await prisma.$transaction(async (tx) => {
    // 1. 查询当前版本数
    const count = await tx.generationVersion.count({
      where: { shotGroupId },
    })

    // 2. 超限淘汰：删除最旧的非当前版本
    if (count >= VERSION_LIMIT) {
      const oldestNonCurrent = await tx.generationVersion.findFirst({
        where: {
          shotGroupId,
          isCurrent: false,
        },
        orderBy: { versionNumber: 'asc' },
      })

      if (oldestNonCurrent) {
        // 收集待删除的 OSS 文件 URL
        filesToDelete = [
          oldestNonCurrent.videoUrl,
          oldestNonCurrent.coverUrl,
          oldestNonCurrent.lastFrameUrl,
        ].filter((url): url is string => !!url)

        // 删除数据库记录
        await tx.generationVersion.delete({
          where: { id: oldestNonCurrent.id },
        })

        logger.info('版本淘汰：已删除最旧非当前版本', {
          shotGroupId,
          deletedVersionId: oldestNonCurrent.id,
          deletedVersionNumber: oldestNonCurrent.versionNumber,
        })
      }
    }

    // 3. 计算 nextVersionNumber = max(versionNumber) + 1
    const maxVersion = await tx.generationVersion.findFirst({
      where: { shotGroupId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    const nextVersionNumber = (maxVersion?.versionNumber ?? 0) + 1

    // 4. 旧的当前版本 isCurrent=false
    await tx.generationVersion.updateMany({
      where: { shotGroupId, isCurrent: true },
      data: { isCurrent: false },
    })

    // 5. 创建新版本记录（isCurrent=true）
    const version = await tx.generationVersion.create({
      data: {
        shotGroupId,
        generationJobId,
        versionNumber: nextVersionNumber,
        videoUrl,
        coverUrl: coverUrl ?? null,
        lastFrameUrl: lastFrameUrl ?? null,
        promptSnapshot,
        costEstimate,
        isCurrent: true,
      },
    })

    // 6. 更新 ShotGroup 字段，指向新的当前版本
    await tx.shotGroup.update({
      where: { id: shotGroupId },
      data: {
        genVideoUrl: videoUrl,
        genCoverUrl: coverUrl ?? null,
        lastFrameUrl: lastFrameUrl ?? null,
      },
    })

    return version
  })

  // 事务外 best-effort 删除 OSS 文件（淘汰的旧版本）
  if (filesToDelete.length > 0) {
    for (const url of filesToDelete) {
      const ossKey = extractKeyFromUrl(url)
      if (ossKey) {
        try {
          await deleteObject(ossKey)
          logger.info('版本淘汰：OSS 文件已删除', { ossKey })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          logger.error('版本淘汰：OSS 文件删除失败（best-effort，不影响主流程）', {
            ossKey,
            error: errorMsg,
          })
        }
      }
    }
  }

  logger.info('新版本创建成功', {
    shotGroupId,
    versionId: newVersion.id,
    versionNumber: newVersion.versionNumber,
  })

  return newVersion
}

/**
 * 切换当前版本（用户手动操作）
 *
 * 在 Prisma 事务内完成以下操作：
 * 1. 验证目标版本存在且属于指定 ShotGroup
 * 2. 旧的当前版本 isCurrent=false
 * 3. 目标版本 isCurrent=true
 * 4. 更新 ShotGroup.genVideoUrl/genCoverUrl/lastFrameUrl 为目标版本对应值
 *
 * 不消耗积分，不创建 CreditLedger 记录。
 * 并发冲突时重试一次，仍失败则抛出 409 错误。
 *
 * @param shotGroupId - 分镜组 ID
 * @param versionId - 目标版本 ID
 * @returns 切换后的目标版本记录
 */
export async function switchVersion(
  shotGroupId: string,
  versionId: string
): Promise<GenerationVersion> {
  // 1. 验证目标版本存在
  const targetVersion = await prisma.generationVersion.findUnique({
    where: { id: versionId },
  })

  if (!targetVersion) {
    throw new ApiError('NOT_FOUND', '版本不存在', 404)
  }

  // 2. 验证版本属于该 ShotGroup
  if (targetVersion.shotGroupId !== shotGroupId) {
    throw new ApiError('VALIDATION_ERROR', '版本不属于该分镜组', 400)
  }

  // 如果目标版本已经是当前版本，直接返回
  if (targetVersion.isCurrent) {
    return targetVersion
  }

  // 3. 在 Prisma 事务内执行切换，并发冲突时重试一次
  const executeSwitch = async (): Promise<GenerationVersion> => {
    return prisma.$transaction(async (tx) => {
      // 旧当前版本 isCurrent=false
      await tx.generationVersion.updateMany({
        where: { shotGroupId, isCurrent: true },
        data: { isCurrent: false },
      })

      // 目标版本 isCurrent=true
      const updatedVersion = await tx.generationVersion.update({
        where: { id: versionId },
        data: { isCurrent: true },
      })

      // 更新 ShotGroup 字段指向目标版本
      await tx.shotGroup.update({
        where: { id: shotGroupId },
        data: {
          genVideoUrl: targetVersion.videoUrl,
          genCoverUrl: targetVersion.coverUrl,
          lastFrameUrl: targetVersion.lastFrameUrl,
        },
      })

      return updatedVersion
    })
  }

  try {
    const result = await executeSwitch()

    logger.info('版本切换成功', {
      shotGroupId,
      versionId,
      versionNumber: result.versionNumber,
    })

    return result
  } catch (error: unknown) {
    // 并发冲突处理：重试一次
    if (isTransactionConflict(error)) {
      logger.warn('版本切换事务冲突，正在重试', { shotGroupId, versionId })

      try {
        const retryResult = await executeSwitch()

        logger.info('版本切换重试成功', {
          shotGroupId,
          versionId,
          versionNumber: retryResult.versionNumber,
        })

        return retryResult
      } catch (retryError: unknown) {
        logger.error('版本切换重试失败', {
          shotGroupId,
          versionId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        throw new ApiError('INTERNAL_ERROR', '并发操作冲突，请稍后重试', 409)
      }
    }

    throw error
  }
}

/**
 * 判断 Prisma 错误是否为事务写冲突
 * Prisma 事务冲突错误码：P2034
 */
function isTransactionConflict(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'P2034'
  ) {
    return true
  }
  return false
}

/**
 * 获取版本列表（按版本号降序排列，最新版本在前）
 *
 * @param shotGroupId - 分镜组 ID
 * @returns 该分镜组的所有版本记录，按 versionNumber 降序
 */
export async function listVersions(shotGroupId: string): Promise<GenerationVersion[]> {
  const versions = await prisma.generationVersion.findMany({
    where: { shotGroupId },
    orderBy: { versionNumber: 'desc' },
  })

  return versions
}

/**
 * 获取版本统计信息
 *
 * 返回当前版本数量和版本上限，用于前端展示 "n/10" 格式的容量指示器。
 *
 * @param shotGroupId - 分镜组 ID
 * @returns 版本计数和上限
 */
export async function getVersionStats(shotGroupId: string): Promise<{ count: number; limit: number }> {
  const count = await prisma.generationVersion.count({
    where: { shotGroupId },
  })

  return { count, limit: VERSION_LIMIT }
}

/**
 * 删除指定版本
 *
 * 规则：
 * - 当前版本（isCurrent=true）禁止删除，抛出 400 错误
 * - 非当前版本：删除数据库记录 + best-effort 删除 OSS 文件
 * - OSS 文件删除失败仅记录日志，不回滚数据库操作
 *
 * @param shotGroupId - 分镜组 ID
 * @param versionId - 要删除的版本 ID
 * @throws 400 - 当前版本不可删除
 * @throws 404 - 版本不存在或不属于该分镜组
 */
export async function deleteVersion(shotGroupId: string, versionId: string): Promise<void> {
  // 1. 查找版本记录
  const version = await prisma.generationVersion.findUnique({
    where: { id: versionId },
  })

  // 2. 验证版本存在且属于该分镜组
  if (!version || version.shotGroupId !== shotGroupId) {
    const error = new Error('版本不存在') as Error & { status?: number }
    error.status = 404
    throw error
  }

  // 3. 当前版本禁止删除
  if (version.isCurrent) {
    const error = new Error('当前版本不可删除，请先切换到其他版本') as Error & { status?: number }
    error.status = 400
    throw error
  }

  // 4. 删除数据库记录
  await prisma.generationVersion.delete({
    where: { id: versionId },
  })

  logger.info('版本已删除', {
    shotGroupId,
    versionId,
    versionNumber: version.versionNumber,
  })

  // 5. Best-effort 删除 OSS 文件（videoUrl、coverUrl、lastFrameUrl）
  const urlsToDelete = [
    version.videoUrl,
    version.coverUrl,
    version.lastFrameUrl,
  ].filter((url): url is string => !!url)

  for (const url of urlsToDelete) {
    const ossKey = extractKeyFromUrl(url)
    if (ossKey) {
      try {
        await deleteObject(ossKey)
        logger.info('版本删除：OSS 文件已清理', { ossKey })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.error('版本删除：OSS 文件删除失败（best-effort，不影响主流程）', {
          ossKey,
          error: errorMsg,
        })
      }
    }
  }
}
