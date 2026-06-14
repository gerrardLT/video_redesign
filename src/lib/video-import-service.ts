import { PLATFORM_PATTERNS, type VideoPlatform } from '@/constants/platform-patterns'
import { prisma } from '@/lib/db'
import { videoDownloadQueue } from '@/lib/queue'

interface ValidateResult {
  valid: boolean
  platform?: VideoPlatform
  error?: string
}

/**
 * 验证分享链接格式，匹配支持的平台
 * @param url - 用户粘贴的链接
 * @returns { valid, platform, error }
 */
export function validateShareLink(url: string): ValidateResult {
  // 1. 基础验证 - 不为空
  if (!url || !url.trim()) {
    return { valid: false, error: '请输入视频链接' }
  }

  const trimmed = url.trim()

  // 2. 检查是否为有效 URL 格式
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { valid: false, error: '请输入有效的视频链接（以 http:// 或 https:// 开头）' }
  }

  // 3. 匹配平台正则规则
  for (const { platform, patterns } of PLATFORM_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { valid: true, platform }
      }
    }
  }

  // 4. 无匹配 - 不支持的平台
  return { valid: false, error: '暂不支持该平台，目前支持抖音、快手和微信视频号' }
}

// ========================
// 视频导入服务核心逻辑
// ========================

interface ImportResult {
  projectId: string
  taskId: string
  platform: VideoPlatform
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
  // 1. 验证链接格式
  const validation = validateShareLink(url)
  if (!validation.valid || !validation.platform) {
    throw new Error(validation.error || '链接验证失败')
  }

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
      sourceUrl: url.trim(),
      platform: validation.platform,
      status: 'PENDING',
      progress: 0,
    },
  })

  // 4. 添加到下载队列
  await videoDownloadQueue.add('download-video', {
    taskId: task.id,
    projectId: project.id,
    sourceUrl: url.trim(),
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
