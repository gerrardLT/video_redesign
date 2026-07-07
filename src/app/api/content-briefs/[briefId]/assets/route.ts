/**
 * POST /api/content-briefs/[briefId]/assets — 上传素材
 *
 * 接收 multipart/form-data 文件上传，执行：
 * 1. 文件接收并写入临时路径
 * 2. 上传到 OSS (merchant/{storeId}/assets/{assetId}.ext)
 * 3. inspectRawAsset 质量检测
 * 4. ffmpeg 生成缩略图
 * 5. 创建 RawAsset 记录
 * 6. 更新 ShotTask 状态为 CAPTURED（质量通过时）
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 请求：multipart/form-data
 * - file: 视频文件
 * - shotTaskId: 关联的 ShotTask ID
 *
 * 响应：
 * - 201: { asset: RawAsset, inspection: QualityInspectionResult }
 * - 400: 参数缺失或文件无效
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 或 ShotTask 不存在
 * - 422: 素材质量检测致命失败（被拒绝）
 * - 500: 服务器内部错误
 *
 * Requirements: 6.1-6.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { inspectRawAsset } from '@/lib/merchant/capture-director'
import { uploadBuffer } from '@/lib/shared/storage'

const execFileAsync = promisify(execFile)

interface RouteContext {
  params: Promise<{ briefId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const tempFiles: string[] = []

  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 解析 multipart/form-data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const shotTaskId = formData.get('shotTaskId') as string | null

    if (!file) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少文件（file 字段）' } },
        { status: 400 }
      )
    }

    if (!shotTaskId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少 shotTaskId 字段' } },
        { status: 400 }
      )
    }

    // 查询 ContentBrief 并验证归属
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: {
            merchant: { select: { userId: true, id: true } },
          },
        },
      },
    })

    if (!brief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 验证 ShotTask 归属
    const shotTask = await prisma.shotTask.findUnique({
      where: { id: shotTaskId },
    })

    if (!shotTask || shotTask.contentBriefId !== briefId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ShotTask 不存在或不属于该 ContentBrief' } },
        { status: 404 }
      )
    }

    // 前置文件大小检查（在读取文件内容前拦截，避免大文件占满内存）
    const MAX_UPLOAD_SIZE = 300 * 1024 * 1024 // 300MB
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: { code: 'FILE_TOO_LARGE', message: '文件太大，最大支持 300MB' } },
        { status: 413 }
      )
    }

    // 写入临时文件
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileExt = path.extname(file.name) || '.mp4'
    const assetId = randomUUID()
    const tempDir = path.join(tmpdir(), 'merchant-assets')
    await mkdir(tempDir, { recursive: true })
    const tempFilePath = path.join(tempDir, `${assetId}${fileExt}`)
    await writeFile(tempFilePath, fileBuffer)
    tempFiles.push(tempFilePath)

    // 质量检测（Req 6.1: 10 秒内完成）
    const inspection = await inspectRawAsset({
      filePath: tempFilePath,
      mimeType: file.type || 'video/mp4',
      shotTask: {
        durationSec: shotTask.durationSec,
        type: shotTask.type as Parameters<typeof inspectRawAsset>[0]['shotTask']['type'],
        required: shotTask.required,
      },
    })

    // 致命质量问题 → 拒绝上传（Req 6.4）
    if (inspection.critical) {
      return NextResponse.json(
        {
          error: {
            code: 'QUALITY_REJECTED',
            message: '素材质量不合格，无法使用',
            details: {
              qualityScore: inspection.qualityScore,
              report: inspection.report,
              warnings: inspection.warnings,
            },
          },
        },
        { status: 422 }
      )
    }

    // 上传到 OSS
    const ossKey = `merchant/${brief.storeId}/assets/${assetId}${fileExt}`
    await uploadBuffer(ossKey, fileBuffer)

    // 生成缩略图
    let thumbnailKey: string | null = null
    try {
      const thumbPath = path.join(tempDir, `${assetId}_thumb.jpg`)
      tempFiles.push(thumbPath)
      await execFileAsync('ffmpeg', [
        '-i', tempFilePath,
        '-vf', 'select=eq(n\\,0)',
        '-vframes', '1',
        '-f', 'image2',
        '-y',
        thumbPath,
      ], { timeout: 10_000 })

      const { readFile } = await import('fs/promises')
      const thumbBuffer = await readFile(thumbPath)
      thumbnailKey = `merchant/${brief.storeId}/assets/${assetId}_thumb.jpg`
      await uploadBuffer(thumbnailKey, thumbBuffer)
    } catch (thumbErr) {
      // 缩略图生成失败不阻断主流程，仅记录
      console.warn('[assets/upload] 缩略图生成失败:', thumbErr)
    }

    // 设置 expiresAt = 14 天后
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 14)

    // 创建 RawAsset 记录
    const rawAsset = await prisma.rawAsset.create({
      data: {
        id: assetId,
        storeId: brief.storeId,
        shotTaskId,
        uploaderUserId: userId,
        type: 'VIDEO',
        ossKey,
        filename: file.name,
        mimeType: file.type || 'video/mp4',
        sizeBytes: fileBuffer.length,
        durationSec: typeof inspection.report.duration.value === 'number'
          ? inspection.report.duration.value
          : undefined,
        width: typeof inspection.report.resolution.value === 'string'
          ? parseInt(inspection.report.resolution.value) || undefined
          : undefined,
        thumbnailKey,
        qualityScore: inspection.qualityScore,
        qualityReport: JSON.parse(JSON.stringify(inspection.report)),
        expiresAt,
      },
    })

    // 质量通过时更新 ShotTask 状态为 CAPTURED（Req 6.5）
    if (inspection.passed) {
      await prisma.shotTask.update({
        where: { id: shotTaskId },
        data: { status: 'CAPTURED' },
      })
    }

    return NextResponse.json(
      { asset: rawAsset, inspection },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/assets] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  } finally {
    // 清理临时文件
    for (const tempFile of tempFiles) {
      try {
        await unlink(tempFile)
      } catch {
        // 清理失败不阻断
      }
    }
  }
}
