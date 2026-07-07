/**
 * POST /api/video-variants/[variantId]/export — 导出视频
 *
 * 流程：
 * 1. 验证归属关系（userId → Merchant → Store → ContentBrief → VideoVariant）
 * 2. 检查 ComplianceCheck 存在且 riskLevel ≠ BLOCKED (Req 10.2)
 *    - 无 ComplianceCheck 时先执行合规检查 (Req 9.10)
 *    - riskLevel=HIGH 需 acknowledgedAt 不为空 (Req 10.2)
 * 3. 确定输出分辨率（由统一权益 getMerchantPrivileges().exportResolution 决定：
 *    1080p → 1080x1920, 720p → 720x1280）
 * 4. FFmpeg 烧录字幕 + 重编码
 * 5. 上传到 OSS (key: merchant/{storeId}/exports/{jobId}.mp4)
 * 6. 创建 PublishJob(status=EXPORTED)
 * 6.1 加入待发布清单 enqueueForPublish（需求 8.1，幂等）
 * 7. 返回签名下载 URL (24h 有效)
 *
 * 计费说明（merchant-billing-unification Req 3.5）：
 * 本路由仅做转码 + 字幕烧录，不包含超分（upscale）处理，与视频重塑
 * 「合并导出不扣、仅超分扣」一致，因此导出本身不扣减积分。
 *
 * 超时 180s (Req 10.1)
 * 失败时 PublishJob.status=FAILED (Req 10.6)
 *
 * Requirements: 10.1-10.7, 2.3, 3.5, 5.3, 5.4, 8.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, getMerchantByUserId } from '@/lib/merchant/merchant-auth'
import { getMerchantPrivileges } from '@/lib/shared/privilege-engine'
import { runComplianceCheck } from '@/lib/merchant/compliance-service'
import { enqueueForPublish } from '@/lib/merchant/publish-queue-service'
import { getSignedObjectUrl, uploadFile } from '@/lib/shared/storage'
import { ApiError } from '@/lib/shared/api-error'
import { EXPORT_URL_EXPIRY_SECONDS } from '@/constants/merchant'
import { getPlatformPreset, buildCropScaleFilter, type PlatformId } from '@/lib/merchant/platform-presets'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

/** 导出超时时间 180 秒 (Req 10.1) */
const EXPORT_TIMEOUT_MS = 180_000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const { variantId } = await params
  let publishJobId: string | null = null

  // 解析请求体：可选的 platform 参数
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const platformId = (body.platform as PlatformId) || null
  const platformPreset = platformId ? getPlatformPreset(platformId) : null

  try {
    // ─── Step 1: 鉴权 + 归属验证 ───
    const userId = getUserIdFromRequest(request)

    const videoVariant = await prisma.videoVariant.findUnique({
      where: { id: variantId },
      include: {
        contentBrief: {
          include: {
            store: {
              include: { merchant: true },
            },
          },
        },
        complianceChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    if (!videoVariant) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '视频版本不存在' } },
        { status: 404 }
      )
    }

    // 验证归属关系：userId → Merchant → Store → ContentBrief → VideoVariant
    const merchant = videoVariant.contentBrief.store.merchant
    if (merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权导出该视频' } },
        { status: 403 }
      )
    }

    // 检查是否有 ossKey（视频已生成）(Req 10.7)
    if (!videoVariant.ossKey) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '该视频版本尚未生成完成，无法导出' } },
        { status: 400 }
      )
    }

    const storeId = videoVariant.contentBrief.storeId
    const contentBriefId = videoVariant.contentBriefId

    // ─── Step 2: 合规检查验证 (Req 10.2, 9.10) ───
    let complianceCheck = videoVariant.complianceChecks[0] as
      | (typeof videoVariant.complianceChecks)[0]
      | undefined

    // 无 ComplianceCheck 时先执行合规检查 (Req 9.10)
    if (!complianceCheck) {
      const newCheck = await runComplianceCheck({
        contentBriefId,
        videoVariantId: variantId,
      })
      const freshCheck = await prisma.complianceCheck.findUnique({
        where: { id: newCheck.id },
      })
      if (!freshCheck) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '合规检查执行异常' } },
          { status: 500 }
        )
      }
      complianceCheck = freshCheck
    }

    // riskLevel = BLOCKED → 拒绝导出
    if (complianceCheck.riskLevel === 'BLOCKED') {
      const blockedReasons = (complianceCheck.blockedReasons as string[]) ?? ['内容不合规']
      return NextResponse.json(
        {
          error: {
            code: 'COMPLIANCE_BLOCKED',
            message: '合规检查未通过，禁止导出',
            blockedReasons,
          },
        },
        { status: 403 }
      )
    }

    // riskLevel = HIGH → 需要 acknowledgedAt 不为空
    if (complianceCheck.riskLevel === 'HIGH' && !complianceCheck.acknowledgedAt) {
      return NextResponse.json(
        {
          error: {
            code: 'COMPLIANCE_ACKNOWLEDGMENT_REQUIRED',
            message: '合规检查发现高风险问题，请先确认风险后再导出',
            complianceCheckId: complianceCheck.id,
          },
        },
        { status: 400 }
      )
    }

    // ─── Step 3: 确定输出分辨率（统一权益 + 平台适配）───
    const privileges = await getMerchantPrivileges(userId)
    const exportResolution = privileges.exportResolution // '1080p' | '720p'
    const tier = privileges.tier
    
    // 平台适配：如果指定了 platform，使用平台预设的分辨率
    let outputWidth: number
    let outputHeight: number
    if (platformPreset) {
      outputWidth = platformPreset.width
      outputHeight = platformPreset.height
    } else {
      outputWidth = exportResolution === '1080p' ? 1080 : 720
      outputHeight = exportResolution === '1080p' ? 1920 : 1280
    }

    // ─── Step 4: FFmpeg 烧录字幕 + 重编码 ───
    const jobId = randomUUID()
    const workDir = path.join(tmpdir(), `export-${jobId}`)
    await mkdir(workDir, { recursive: true })

    const inputPath = path.join(workDir, 'input.mp4')
    const outputPath = path.join(workDir, 'output.mp4')
    let assPath: string | null = null

    // 从 OSS 下载源视频
    const { downloadToTemp } = await import('@/lib/shared/storage')
    const sourceUrl = getSignedObjectUrl(videoVariant.ossKey, 600)
    await downloadToTemp(sourceUrl, inputPath)

    // 生成字幕文件（ASS 格式）
    const subtitles = videoVariant.subtitles as Array<{
      text: string
      startSec: number
      endSec: number
    }> | null

    if (subtitles && subtitles.length > 0) {
      assPath = path.join(workDir, 'subtitles.ass')
      const assContent = generateASSContent(subtitles, outputWidth, outputHeight)
      await writeFile(assPath, assContent, 'utf-8')
    }

    // 构建 FFmpeg 命令参数
    const ffmpegArgs = buildFFmpegExportArgs({
      inputPath,
      outputPath,
      assPath,
      outputWidth,
      outputHeight,
      useCrop: !!platformPreset, // 平台适配时使用裁切而非补边
    })

    // 执行 FFmpeg（180s 超时）
    await execFileAsync('ffmpeg', ffmpegArgs, {
      timeout: EXPORT_TIMEOUT_MS,
    })

    // ─── Step 5: 上传到 OSS ───
    const platformSuffix = platformPreset ? `_${platformPreset.id}` : ''
    const ossKey = `merchant/${storeId}/exports/${jobId}${platformSuffix}.mp4`
    await uploadFile(ossKey, outputPath)

    // ─── Step 6: 创建 PublishJob (status=EXPORTED) ───
    const publishJob = await prisma.publishJob.create({
      data: {
        contentBriefId,
        videoVariantId: variantId,
        platform: 'MANUAL_EXPORT',
        status: 'EXPORTED',
        exportedOssKey: ossKey,
      },
    })
    publishJobId = publishJob.id

    // ─── Step 6.1: 导出成功后加入待发布清单（需求 8.1）───
    // 导出落库（PublishJob=EXPORTED）后，将该 variant 纳入待发布清单，记录目标平台维度发布状态。
    // enqueueForPublish 幂等：重复导出同一 variant 不产生重复清单项（每个已导出 variant 恰一个 PublishQueueItem）。
    // 入列是发布闭环（清单 + 超时提醒）的起点，失败不静默——直接抛出让本次导出显式失败并可重试，
    // 而非吞掉错误导致内容游离于清单之外、提醒永不触发。
    await enqueueForPublish({
      videoVariantId: variantId,
      contentBriefId,
    })

    // ─── Step 7: 返回签名下载 URL (24h 有效) ───
    const downloadUrl = getSignedObjectUrl(ossKey, EXPORT_URL_EXPIRY_SECONDS)

    // 清理临时文件
    await cleanupTempFiles(workDir, inputPath, outputPath, assPath)

    return NextResponse.json({
      publishJobId: publishJob.id,
      downloadUrl,
      expiresIn: EXPORT_URL_EXPIRY_SECONDS,
      resolution: `${outputWidth}x${outputHeight}`,
      tier,
      platform: platformPreset?.id ?? null,
      platformLabel: platformPreset?.label ?? null,
      platformTips: platformPreset?.tips ?? null,
    })
  } catch (error) {
    // 失败时标记 PublishJob.status=FAILED (Req 10.6)
    if (publishJobId) {
      try {
        await prisma.publishJob.update({
          where: { id: publishJobId },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : '导出失败',
          },
        })
      } catch {
        // 更新失败不阻塞错误返回
      }
    }

    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }

    // FFmpeg 超时处理（execFileAsync 超时时 error 带有 killed 和 signal 属性）
    if (error instanceof Error && ('killed' in error || error.message.includes('SIGTERM') || error.message.includes('killed'))) {
      return NextResponse.json(
        { error: { code: 'EXPORT_TIMEOUT', message: '导出超时，请重试' } },
        { status: 504 }
      )
    }

    console.error(`[POST /api/video-variants/${variantId}/export] 导出失败:`, error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '导出失败，请重试' } },
      { status: 500 }
    )
  }
}

// ========================
// 内部工具函数
// ========================

/**
 * 生成 ASS 字幕文件内容
 *
 * 使用简洁的白色字幕样式，居底显示，字体大小根据分辨率自适应。
 */
function generateASSContent(
  subtitles: Array<{ text: string; startSec: number; endSec: number }>,
  videoWidth: number,
  videoHeight: number
): string {
  const fontSize = videoWidth >= 1080 ? 48 : 36
  const marginV = videoHeight >= 1920 ? 120 : 80

  const header = `[Script Info]
Title: Export Subtitles
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const events = subtitles.map((sub) => {
    const start = formatASSTime(sub.startSec)
    const end = formatASSTime(sub.endSec)
    // 转义换行符
    const text = sub.text.replace(/\n/g, '\\N')
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`
  })

  return header + events.join('\n') + '\n'
}

/**
 * 将秒数转为 ASS 时间格式 (H:MM:SS.CC)
 */
function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * 构建 FFmpeg 导出命令参数
 *
 * - 统一编码为 H.264 / AAC / 9:16
 * - 烧录字幕（如有）
 * - 分辨率缩放到目标尺寸
 */
function buildFFmpegExportArgs(options: {
  inputPath: string
  outputPath: string
  assPath: string | null
  outputWidth: number
  outputHeight: number
  useCrop?: boolean
}): string[] {
  const { inputPath, outputPath, assPath, outputWidth, outputHeight, useCrop } = options

  const args: string[] = [
    '-y',
    '-i', inputPath,
  ]

  // 视频滤镜链：缩放 + 字幕
  let vfChain: string
  if (useCrop) {
    // 平台适配模式：裁切到目标比例后缩放（无黑边）
    vfChain = `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight}`
  } else {
    // 默认模式：缩放 + 补边
    vfChain = `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2`
  }

  if (assPath) {
    // 注意：Windows 路径中的反斜杠和冒号需要转义
    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    vfChain += `,ass='${escapedAssPath}'`
  }

  args.push('-vf', vfChain)

  // 编码参数
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-r', '30',
    outputPath
  )

  return args
}

/**
 * 清理临时文件（不抛错）
 */
async function cleanupTempFiles(
  workDir: string,
  ...files: (string | null)[]
): Promise<void> {
  for (const f of files) {
    if (f) {
      try {
        await unlink(f)
      } catch {
        // 忽略清理失败
      }
    }
  }
  try {
    const { rmdir } = await import('fs/promises')
    await rmdir(workDir)
  } catch {
    // 忽略目录清理失败
  }
}
