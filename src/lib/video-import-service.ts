import { PLATFORM_PATTERNS, type VideoPlatform } from '@/constants/platform-patterns'
import { prisma } from '@/lib/db'
import { videoDownloadQueue } from '@/lib/queue'
import { validateShareLink, type ExtendedPlatform } from '@/lib/validate-share-link'
export type { ValidateResult, ExtendedPlatform } from '@/lib/validate-share-link'

// 重新导出 validateShareLink，确保已有导入路径不破坏
export { validateShareLink }

// ========================
// 视频导入服务核心逻辑
// ========================

interface ImportResult {
  projectId: string
  taskId: string
  platform: ExtendedPlatform
}

/**
 * 验证链接并创建导入任务
 * 流程：验证链接 → 创建 Project（status=DOWNLOADING）→ 创建 VideoDownloadTask → 入队
 */
export async function validateAndImport(
  userId: string,
  url: string,
  projectName?: string
): Promise<ImportResult> {
  // 1. 验证链接格式（支持从分享文案中自动提取 URL）
  const validation = validateShareLink(url)
  if (!validation.valid || !validation.platform) {
    throw new Error(validation.error || '链接验证失败')
  }

  // 使用提取后的纯净 URL（而非用户原始输入的分享文案）
  const actualUrl = validation.extractedUrl || url.trim()

  // 2. 创建 Project，状态设为 DOWNLOADING
  const project = await prisma.project.create({
    data: {
      userId,
      name: projectName || `导入视频 - ${validation.platform}`,
      status: 'DOWNLOADING',
    },
  })

  // 3. 创建 VideoDownloadTask
  const task = await prisma.videoDownloadTask.create({
    data: {
      projectId: project.id,
      userId,
      sourceUrl: actualUrl,
      platform: validation.platform,
      status: 'PENDING',
      progress: 0,
    },
  })

  // 4. 添加到下载队列
  await videoDownloadQueue.add('download-video', {
    taskId: task.id,
    projectId: project.id,
    sourceUrl: actualUrl,
    platform: validation.platform,
  })

  return {
    projectId: project.id,
    taskId: task.id,
    platform: validation.platform,
  }
}

/**
 * 查询导入（下载）进度
 * @param projectId - 项目 ID
 * @param userId - 用户 ID（确保只能查询自己的任务）
 */
export async function getImportStatus(projectId: string, userId: string) {
  const task = await prisma.videoDownloadTask.findFirst({
    where: { projectId, userId },
    orderBy: { createdAt: 'desc' },
  })

  if (!task) return null

  return {
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    errorMsg: task.errorMsg,
    platform: task.platform,
  }
}
