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
import { mkdir, writeFile } from 'fs/promises'

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
// 链接解析 - 跟随重定向获取真实视频地址
// ========================

/**
 * 解析短链接，跟随重定向获取最终 URL
 * 适用于 v.douyin.com、v.kuaishou.com 等短链接
 */
async function resolveRedirectUrl(shortUrl: string): Promise<string> {
  try {
    const response = await fetch(shortUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    // 返回最终跳转后的 URL
    return response.url || shortUrl
  } catch {
    // 如果重定向解析失败，返回原始 URL
    return shortUrl
  }
}

/**
 * 根据平台解析真实视频下载地址
 * 注意：各平台的实际解析逻辑需要根据平台 API 变化维护
 */
async function resolveVideoUrl(sourceUrl: string, platform: string): Promise<string> {
  // 1. 先解析短链接重定向
  const resolvedUrl = await resolveRedirectUrl(sourceUrl)
  console.log(`[download-video] 短链接解析: ${sourceUrl} → ${resolvedUrl}`)

  // 2. 根据平台进行不同处理
  // 注意：真实环境中需要根据各平台页面结构提取视频直链
  // 这里实现基础框架，具体的平台解析逻辑需要后续根据实际情况完善
  switch (platform) {
    case 'douyin':
      return await resolveDouyinVideo(resolvedUrl)
    case 'kuaishou':
      return await resolveKuaishouVideo(resolvedUrl)
    case 'weixin':
      return await resolveWeixinVideo(resolvedUrl)
    default:
      throw new Error(`不支持的平台: ${platform}`)
  }
}

/**
 * 抖音视频解析
 * 从抖音页面提取真实视频播放地址
 */
async function resolveDouyinVideo(pageUrl: string): Promise<string> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.douyin.com/',
        Cookie: '', // 部分接口需要 cookie
      },
    })

    const html = await response.text()

    // 尝试从页面数据中提取视频 URL
    // 抖音通常在 SSR 数据中包含视频播放地址
    const videoUrlMatch = html.match(/"playAddr":\s*\[?\s*\{\s*"src":\s*"([^"]+)"/)
      || html.match(/"play_addr".*?"url_list":\s*\["([^"]+)"/)
      || html.match(/playAddr.*?src['":\s]+['"]([^'"]+)/)

    if (videoUrlMatch?.[1]) {
      // 解码 URL（抖音可能对 URL 进行编码）
      return videoUrlMatch[1].replace(/\\u002F/g, '/')
    }

    // 降级：返回页面 URL，后续可通过其他方式获取
    throw new Error('无法从页面提取视频地址，请确认链接有效')
  } catch (error) {
    if (error instanceof Error && error.message.includes('无法从页面')) {
      throw error
    }
    throw new Error(`抖音视频解析失败: ${error instanceof Error ? error.message : '网络请求失败'}`)
  }
}

/**
 * 快手视频解析
 */
async function resolveKuaishouVideo(pageUrl: string): Promise<string> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.kuaishou.com/',
      },
    })

    const html = await response.text()

    // 快手视频地址通常在 SSR 数据中
    const videoUrlMatch = html.match(/"photoUrl":\s*"([^"]+)"/)
      || html.match(/"srcNoMark":\s*"([^"]+)"/)
      || html.match(/"url":\s*"(https?:\/\/[^"]*\.mp4[^"]*)"/)

    if (videoUrlMatch?.[1]) {
      return videoUrlMatch[1]
    }

    throw new Error('无法从页面提取视频地址，请确认链接有效')
  } catch (error) {
    if (error instanceof Error && error.message.includes('无法从页面')) {
      throw error
    }
    throw new Error(`快手视频解析失败: ${error instanceof Error ? error.message : '网络请求失败'}`)
  }
}

/**
 * 微信视频号解析
 */
async function resolveWeixinVideo(pageUrl: string): Promise<string> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://channels.weixin.qq.com/',
      },
    })

    const html = await response.text()

    // 微信视频号地址提取
    const videoUrlMatch = html.match(/"url":\s*"(https?:\/\/[^"]*finder[^"]*\.mp4[^"]*)"/)
      || html.match(/src="(https?:\/\/[^"]*\.mp4[^"]*)"/)

    if (videoUrlMatch?.[1]) {
      return videoUrlMatch[1]
    }

    throw new Error('无法从页面提取视频地址，请确认链接有效')
  } catch (error) {
    if (error instanceof Error && error.message.includes('无法从页面')) {
      throw error
    }
    throw new Error(`微信视频号解析失败: ${error instanceof Error ? error.message : '网络请求失败'}`)
  }
}

// ========================
// 代理下载 - 服务端下载视频，绕过防盗链
// ========================

/**
 * 代理下载视频文件
 * 使用服务端发起请求绕过防盗链限制
 * @returns 下载后的本地文件路径
 */
async function downloadVideo(
  videoUrl: string,
  projectId: string,
  platform: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  // 构造输出目录和文件名
  const outputDir = path.join(process.cwd(), 'public', 'uploads', 'downloads', projectId)
  await mkdir(outputDir, { recursive: true })

  const fileName = `source_${Date.now()}.mp4`
  const outputPath = path.join(outputDir, fileName)

  // 构造带防盗链绕过的请求头
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'identity', // 不使用压缩，方便计算进度
  }

  // 根据平台设置 Referer（防盗链关键）
  switch (platform) {
    case 'douyin':
      headers['Referer'] = 'https://www.douyin.com/'
      break
    case 'kuaishou':
      headers['Referer'] = 'https://www.kuaishou.com/'
      break
    case 'weixin':
      headers['Referer'] = 'https://channels.weixin.qq.com/'
      break
  }

  const response = await fetch(videoUrl, { headers })

  if (!response.ok) {
    throw new Error(`视频下载失败: HTTP ${response.status} ${response.statusText}`)
  }

  // 检查文件大小（限制 500MB）
  const contentLength = Number(response.headers.get('content-length') || 0)
  const maxSize = 500 * 1024 * 1024 // 500MB
  if (contentLength > maxSize) {
    throw new Error('视频文件过大，当前支持 500MB 以内')
  }

  // 流式下载并写入本地文件
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 检查实际大小
  if (buffer.length > maxSize) {
    throw new Error('视频文件过大，当前支持 500MB 以内')
  }

  await writeFile(outputPath, buffer)

  // 报告进度
  onProgress?.(100)

  return outputPath
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

    // 2. 解析真实视频地址
    await job.updateProgress(10)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 10 },
    })
    console.log(`[download-video] 开始解析视频地址...`)

    const videoUrl = await resolveVideoUrl(sourceUrl, platform)
    console.log(`[download-video] 解析成功，视频地址: ${videoUrl.substring(0, 80)}...`)

    await job.updateProgress(30)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 30 },
    })

    // 3. 代理下载视频
    console.log(`[download-video] 开始下载视频...`)
    const localPath = await downloadVideo(videoUrl, projectId, platform, (progress) => {
      // 下载进度映射到 30-80%
      const mappedProgress = 30 + Math.floor(progress * 0.5)
      job.updateProgress(mappedProgress)
    })
    console.log(`[download-video] 视频下载完成: ${localPath}`)

    await job.updateProgress(80)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 80 },
    })

    // 4. 上传到 OSS
    console.log(`[download-video] 开始上传到 OSS...`)
    const ossUrl = await uploadToOSS(localPath, projectId)
    console.log(`[download-video] OSS 上传完成: ${ossUrl}`)

    await job.updateProgress(90)
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: { progress: 90 },
    })

    // 5. 更新 Project 状态为 PARSING，写入 videoUrl
    await prisma.project.update({
      where: { id: projectId },
      data: {
        videoUrl: ossUrl,
        status: 'PARSING',
      },
    })

    // 6. 更新下载任务为 COMPLETED
    await prisma.videoDownloadTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        progress: 100,
      },
    })

    // 7. 触发 video-parse 队列前校验余额（解析消耗 AI 分析 + 首帧图等真实资源）
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
export { processDownloadVideo, resolveRedirectUrl, resolveVideoUrl, downloadVideo, uploadToOSS }
