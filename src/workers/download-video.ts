/**
 * 视频下载 Worker
 * 处理 'video-download' 队列任务
 * 流程：解析短链接 → 跟随重定向获取真实视频地址 → 代理下载 → 上传 OSS → 更新状态 → 触发解析
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { videoParseQueue } from '@/lib/queue'
import { estimateParseCreditCost, getBalance } from '@/lib/credit-service'
import path from 'path'
import { mkdir } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ========================
// 类型定义
// ========================

export interface DownloadVideoJobData {
  taskId: string
  projectId: string
  sourceUrl: string
  platform: string // douyin | kuaishou | weixin
}

// ========================
// yt-dlp 一体化下载（解析 + 下载 + 无水印）
// ========================

/**
 * 使用 yt-dlp 下载视频（支持抖音/快手/微信视频号/B站等 1000+ 平台）
 * yt-dlp 内部自动处理短链接重定向、反爬、无水印提取等
 * @returns 下载后的本地文件路径
 */
async function downloadWithYtDlp(sourceUrl: string, projectId: string): Promise<{ localPath: string; title: string }> {
  const outputDir = path.join(process.cwd(), 'public', 'uploads', 'downloads', projectId)
  await mkdir(outputDir, { recursive: true })

  const outputTemplate = path.join(outputDir, `source_${Date.now()}.%(ext)s`)

  try {
    // 使用 yt-dlp 下载，输出 JSON 元数据用于获取标题
    const { stdout } = await execFileAsync('yt-dlp', [
      '--no-warnings',
      '--no-playlist',           // 不下载播放列表
      '-f', 'best[ext=mp4]/best', // 优先 mp4 格式
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,      // 输出路径模板
      '--print', 'after_move:filepath', // 打印最终文件路径
      '--print', 'title',        // 打印视频标题
      '--max-filesize', '300m',  // 最大 300MB（与上传限制一致）
      '--socket-timeout', '30',  // 网络超时 30s
      sourceUrl,
    ], { timeout: 180000 }) // 总超时 3 分钟

    const lines = stdout.trim().split('\n')
    // yt-dlp --print 按顺序输出：filepath, title
    const title = lines[0] || '导入视频'
    const localPath = lines[1] || ''

    if (!localPath || !localPath.includes(outputDir)) {
      // 如果 --print filepath 没有输出，尝试查找目录里的文件
      const { readdir } = await import('fs/promises')
      const files = await readdir(outputDir)
      const downloaded = files.find(f => f.startsWith('source_') && f.endsWith('.mp4'))
      if (downloaded) {
        return { localPath: path.join(outputDir, downloaded), title }
      }
      throw new Error('yt-dlp 下载完成但未找到输出文件')
    }

    return { localPath, title }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    // yt-dlp 常见错误翻译
    if (msg.includes('Unsupported URL')) {
      throw new Error('不支持的链接格式，请检查链接是否正确')
    }
    if (msg.includes('Video unavailable') || msg.includes('removed')) {
      throw new Error('视频已被删除或不可用')
    }
    if (msg.includes('Private video')) {
      throw new Error('该视频为私密视频，无法下载')
    }
    if (msg.includes('max-filesize')) {
      throw new Error('视频文件过大，当前支持 300MB 以内')
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      throw new Error('下载超时，请稍后重试')
    }
    throw new Error(`视频下载失败: ${msg.slice(0, 200)}`)
  }
}

// ========================
// OSS 上传
// ========================

/**
 * 上传视频到 OSS
 * @returns OSS 公开访问 URL
 */
async function uploadToOSS(localPath: string, projectId: string): Promise<string> {
  const { uploadFile } = await import('@/lib/storage')
  const { unlink } = await import('fs/promises')
  const ossKey = `downloads/${projectId}/${path.basename(localPath)}`
  const ossUrl = await uploadFile(ossKey, localPath)

  // 缺陷 10：上传 OSS 成功后删除本地公开副本，避免 public/uploads 无鉴权暴露下载的私有视频。
  // 开发模式（无 OSS）回退本地路径时本地为唯一副本，保留。
  if (ossUrl.startsWith('http')) {
    await unlink(localPath).catch(() => {})
  }

  return ossUrl
}

// ========================
// Worker 主逻辑
// ========================

async function processDownloadVideo(job: Job<DownloadVideoJobData>): Promise<void> {
  const { taskId, projectId, sourceUrl, platform } = job.data
  console.log(`[download-video] 开始处理任务 ${taskId}, 项目 ${projectId}`)
  console.log(`[download-video] 平台: ${platform}, 链接: ${sourceUrl}`)

  try {
    // 1. 更新任务状态为 DOWNLOADING
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { status: 'DOWNLOADING', progress: 0 },
    })

    // 2. 使用 yt-dlp 解析并下载视频（一步完成：短链接解析 + 反爬 + 无水印下载）
    await job.updateProgress(10)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 10 },
    })
    console.log(`[download-video] 开始使用 yt-dlp 下载视频...`)

    const { localPath, title } = await downloadWithYtDlp(sourceUrl, projectId)
    console.log(`[download-video] yt-dlp 下载完成: ${localPath} (标题: ${title})`)

    await job.updateProgress(80)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 80 },
    })

    // 3. 上传到 OSS
    console.log(`[download-video] 开始上传到 OSS...`)
    const ossUrl = await uploadToOSS(localPath, projectId)
    console.log(`[download-video] OSS 上传完成: ${ossUrl}`)

    await job.updateProgress(90)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 90 },
    })

    // 4. 更新 Project 状态为 PARSING，写入 videoUrl
    await prisma.project.update({
      where: { id: projectId },
      data: {
        videoUrl: ossUrl,
        status: 'PARSING',
      },
    })

    // 5. 更新下载任务为 COMPLETED
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        progress: 100,
      },
    })

    // 6. 触发 video-parse 队列前校验余额（解析消耗 AI 分析 + 首帧图等真实资源）
    const projectForCost = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { userId: true, duration: true },
    })
    const estimatedParseCost = estimateParseCreditCost(projectForCost.duration ?? 0)
    const userBalance = await getBalance(projectForCost.userId)
    if (userBalance < estimatedParseCost) {
      // 余额不足：不触发解析，标记项目 FAILED（不静默）
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'FAILED',
          errorMsg: `积分余额不足，无法开始解析（需 ${estimatedParseCost}，余 ${userBalance}）`,
        },
      })
      console.warn(`[download-video] 项目 ${projectId} 积分不足，跳过解析`)
      await job.updateProgress(100)
      return
    }

    // 触发 video-parse 队列开始 AI 解析
    await videoParseQueue.add('parse-video', {
      projectId,
      videoUrl: ossUrl,
    })
    console.log(`[download-video] 已触发视频解析任务, 项目 ${projectId}`)

    await job.updateProgress(100)
    console.log(`[download-video] 任务 ${taskId} 全部完成`)
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '视频下载失败'
    console.error(`[download-video] 任务 ${taskId} 失败:`, errorMsg)

    // 更新任务状态为 FAILED
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        errorMsg,
      },
    })

    // 更新项目状态为 FAILED
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'FAILED',
        errorMsg: `视频下载失败: ${errorMsg}`,
      },
    })

    throw error // 让 BullMQ 处理重试逻辑
  }
}

// ========================
// 创建 Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

const worker = new Worker<DownloadVideoJobData>(
  'video-download',
  processDownloadVideo,
  {
    connection,
    concurrency: 3, // 允许同时下载 3 个视频
    limiter: {
      max: 5,
      duration: 60000, // 每分钟最多处理 5 个下载任务
    },
  }
)

worker.on('completed', (job) => {
  console.log(`[download-video] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  console.error(`[download-video] 任务 ${job?.id} 失败:`, err.message)
})

export default worker
export { processDownloadVideo, downloadWithYtDlp, uploadToOSS }
