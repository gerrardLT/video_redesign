/**
 * 多段视频拼合模块
 *
 * 当项目的所有 GenerationJob 分段生成完成后，
 * 通过 FFmpeg concat demuxer 将多段视频拼合为单个 MP4 文件，
 * 上传到 OSS 并创建 Asset 记录。
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { writeFile, mkdir, stat, rm } from 'fs/promises'
import { prisma } from '@/lib/shared/db'
import { uploadFile } from '@/lib/shared/storage'
import { setExpiry } from '@/lib/shared/asset-lifecycle-service'
import { logger } from '@/lib/shared/logger'

const execFileAsync = promisify(execFile)

/** FFmpeg concat 超时时间：300 秒 */
const CONCAT_TIMEOUT = 300_000

/** OSS 上传重试次数（最多重试 2 次，共 3 次尝试） */
const OSS_UPLOAD_MAX_RETRIES = 2

/** OSS 上传重试间隔：3 秒 */
const OSS_UPLOAD_RETRY_INTERVAL = 3000

/**
 * 检查项目所有分段生成任务状态，并在全部 SUCCEEDED 时触发拼合。
 *
 * 调用时机：generate-video Worker 中单段生成成功后。
 *
 * @param projectId 项目 ID
 */
export async function checkAndConcatProjectSegments(projectId: string): Promise<void> {
  // 查询该项目的所有 GenerationJob（项目级生成：shotGroupId = null, shotId = null）
  const jobs = await prisma.generationJob.findMany({
    where: {
      projectId,
      shotGroupId: null,
      shotId: null,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (jobs.length === 0) {
    return
  }

  // 检查是否有失败的段
  const failedJob = jobs.find(j => j.status === 'FAILED')
  if (failedJob) {
    // 有失败段 → 标记项目 FAILED
    const orderIndex = jobs.indexOf(failedJob)
    const errorMsg = `分段 ${orderIndex} 生成失败: ${failedJob.errorMessage || '未知错误'}`.substring(0, 500)

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'FAILED', errorMsg },
    })
    logger.error('项目多段生成存在失败段', { projectId, orderIndex, error: failedJob.errorMessage })
    return
  }

  // 检查是否全部 SUCCEEDED
  const allSucceeded = jobs.every(j => j.status === 'SUCCEEDED')
  if (!allSucceeded) {
    // 还有未完成的段，不触发拼合
    return
  }

  // 全部 SUCCEEDED → 触发拼合
  logger.info('项目所有分段生成完成，开始拼合', { projectId, segmentCount: jobs.length })

  const tempDir = path.join(process.cwd(), 'public', 'uploads', 'temp', `concat_${projectId}_${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  try {
    // 1. 收集所有段视频 URL（按创建顺序，即段序号）
    const videoUrls = jobs.map(j => j.resultVideoUrl).filter((url): url is string => !!url)

    if (videoUrls.length === 0) {
      throw new Error('所有分段已成功但无视频 URL')
    }

    if (videoUrls.length !== jobs.length) {
      throw new Error(`视频 URL 数量(${videoUrls.length})与分段数(${jobs.length})不一致`)
    }

    // 2. 下载所有段视频到临时目录
    const localPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const localPath = path.join(tempDir, `segment_${i}.mp4`)
      await downloadSegmentVideo(videoUrls[i], localPath)
      localPaths.push(localPath)
    }

    // 3. 创建 FFmpeg concat demuxer 文件列表
    const concatListPath = path.join(tempDir, 'concat_list.txt')
    const concatListContent = localPaths
      .map(p => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n')
    await writeFile(concatListPath, concatListContent, 'utf-8')

    // 4. 执行 FFmpeg concat
    const outputPath = path.join(tempDir, 'output.mp4')
    await ffmpegConcatDemuxer(concatListPath, outputPath)

    // 5. 获取输出文件大小
    const outputStat = await stat(outputPath)
    const fileSize = outputStat.size

    // 6. 上传最终视频到 OSS（失败重试 2 次，间隔 3s）
    const ossUrl = await uploadConcatVideoToOSS(outputPath, projectId)

    // 7. 查询项目 userId
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { userId: true },
    })

    // 8. 创建 Asset 记录（type=AI_GENERATED, 14 天过期）
    const asset = await prisma.asset.create({
      data: {
        projectId,
        userId: project.userId,
        type: 'AI_GENERATED',
        url: ossUrl,
        fileName: `project-${projectId}-concat.mp4`,
        fileSize,
        status: 'UPLOADED',
        sortOrder: 0,
      },
    })
    await setExpiry(asset.id, 14)

    // 9. 更新项目状态为 EXPORTED（与 video-merge Worker 终态统一，前端 stepper 判断用 EXPORTED）
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'EXPORTED' },
    })

    logger.info('项目多段拼合完成', { projectId, assetId: asset.id, fileSize, ossUrl })
  } catch (error) {
    // FFmpeg concat 失败/超时 或其他错误 → 项目 FAILED
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorMsg = errorMessage.substring(0, 500)

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'FAILED', errorMsg },
    }).catch(updateErr => {
      logger.error('拼合失败后更新项目状态也失败', {
        projectId,
        error: updateErr instanceof Error ? updateErr.message : String(updateErr),
      })
    })

    logger.error('项目多段拼合失败', { projectId, error: errorMsg })
  } finally {
    // 清理临时文件
    await cleanupTempDir(tempDir)
  }
}

/**
 * 下载分段视频到本地
 */
async function downloadSegmentVideo(url: string, outputPath: string): Promise<void> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // 本地路径（开发模式），直接复制
    const { copyFile } = await import('fs/promises')
    const localPath = path.join(process.cwd(), 'public', url)
    await copyFile(localPath, outputPath)
    return
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 VideoRedesign/1.0' },
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`下载分段视频失败: HTTP ${response.status} - ${url.substring(0, 80)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(outputPath, buffer)
}

/**
 * 使用 FFmpeg concat demuxer 拼合视频
 * 命令: ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
 * 超时: 300 秒
 */
async function ffmpegConcatDemuxer(concatListPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: CONCAT_TIMEOUT, maxBuffer: 10 * 1024 * 1024 })
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string; killed?: boolean }
    if (err.killed) {
      throw new Error(`FFmpeg concat 超时（${CONCAT_TIMEOUT / 1000}s）: ${(err.stderr || '').substring(0, 500)}`)
    }
    throw new Error(`FFmpeg concat 失败: ${(err.stderr || err.message || '未知错误').substring(0, 500)}`)
  }
}

/**
 * 上传拼合视频到 OSS（失败重试 2 次，间隔 3s）
 */
async function uploadConcatVideoToOSS(filePath: string, projectId: string): Promise<string> {
  const ossKey = `generated/${projectId}/concat_${Date.now()}.mp4`

  for (let attempt = 1; attempt <= OSS_UPLOAD_MAX_RETRIES + 1; attempt++) {
    try {
      const ossUrl = await uploadFile(ossKey, filePath)
      return ossUrl
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (attempt <= OSS_UPLOAD_MAX_RETRIES) {
        logger.warn(`拼合视频上传 OSS 第 ${attempt} 次失败，${OSS_UPLOAD_RETRY_INTERVAL / 1000}s 后重试`, {
          projectId,
          reason,
        })
        await new Promise(resolve => setTimeout(resolve, OSS_UPLOAD_RETRY_INTERVAL))
      } else {
        throw new Error(`拼合视频上传 OSS 全部 ${OSS_UPLOAD_MAX_RETRIES + 1} 次尝试失败: ${reason}`)
      }
    }
  }

  throw new Error('上传拼合视频到 OSS 失败（不应到达此处）')
}

/**
 * 清理临时目录
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true })
  } catch (err) {
    logger.warn('清理拼合临时目录失败', {
      tempDir,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
