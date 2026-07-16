/**
 * 商家素材库 API（store 级共享，持久不过期）
 *
 * GET  /api/merchant/stores/[storeId]/assets — 列出素材库条目
 *   - 仅返回素材库条目（shotTaskId = null、expiresAt = null），排除复刻临时下载的源视频
 *   - 支持 ?type=IMAGE|VIDEO & ?category=PRODUCT|CHARACTER|OTHER 过滤
 *   - 返回带短时效签名 URL（url / thumbUrl）
 *
 * POST /api/merchant/stores/[storeId]/assets — 上传素材到素材库
 *   - multipart/form-data：file（必填）、category（可选，默认 OTHER）
 *   - 图片走 IMAGE，视频走 VIDEO；写 RawAsset（uploaderUserId、shotTaskId=null、expiresAt=null）
 *
 * 鉴权：validateMerchantAccess(userId, storeId)
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { writeFile, unlink, mkdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { uploadBuffer, getSignedObjectUrl } from '@/lib/shared/storage'

const execFileAsync = promisify(execFile)

interface RouteContext {
  params: Promise<{ storeId: string }>
}

const VALID_CATEGORIES = ['PRODUCT', 'CHARACTER', 'OTHER'] as const
type AssetCategory = (typeof VALID_CATEGORIES)[number]

const MAX_UPLOAD_SIZE = 300 * 1024 * 1024 // 300MB

/** 短时效签名 URL 有效期（秒），素材库预览用 */
const SIGN_EXPIRES = 3600

function handleError(error: unknown, tag: string) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    )
  }
  console.error(`[${tag}] 未知错误:`, error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
    { status: 500 }
  )
}

// ========================
// GET — 素材库列表
// ========================

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)
    await validateMerchantAccess(userId, storeId)

    const { searchParams } = new URL(request.url)
    // 白名单校验：非法枚举值忽略（不加入 where），避免裸字符串直传 Prisma 枚举字段抛异常 → 500
    const VALID_TYPES = ['IMAGE', 'VIDEO'] as const
    const typeRaw = searchParams.get('type')
    const categoryRaw = searchParams.get('category')
    const typeFilter = VALID_TYPES.includes(typeRaw as (typeof VALID_TYPES)[number]) ? typeRaw : null
    const categoryFilter = VALID_CATEGORIES.includes(categoryRaw as AssetCategory)
      ? categoryRaw
      : null

    const assets = await prisma.rawAsset.findMany({
      where: {
        storeId,
        shotTaskId: null, // 仅素材库条目，排除镜头拍摄素材与复刻临时源视频
        expiresAt: null, // 素材库持久保留
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })

    const items = assets.map((a) => ({
      id: a.id,
      type: a.type,
      category: a.category,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      durationSec: a.durationSec,
      width: a.width,
      height: a.height,
      url: safeSign(a.ossKey),
      thumbUrl: a.thumbnailKey ? safeSign(a.thumbnailKey) : safeSign(a.ossKey),
      createdAt: a.createdAt.toISOString(),
    }))

    return NextResponse.json({ assets: items })
  } catch (error) {
    return handleError(error, 'GET /api/merchant/stores/[storeId]/assets')
  }
}

/** 签名失败（如未配置 OSS）时回退为原始 key，不阻断列表 */
function safeSign(key: string): string {
  try {
    return getSignedObjectUrl(key, SIGN_EXPIRES)
  } catch {
    return `/uploads/${key}`
  }
}

// ========================
// POST — 上传素材
// ========================

export async function POST(request: NextRequest, context: RouteContext) {
  const tempFiles: string[] = []

  try {
    const { storeId } = await context.params
    const userId = getUserIdFromRequest(request)
    await validateMerchantAccess(userId, storeId)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const categoryRaw = (formData.get('category') as string | null) ?? 'OTHER'
    const category: AssetCategory = VALID_CATEGORIES.includes(categoryRaw as AssetCategory)
      ? (categoryRaw as AssetCategory)
      : 'OTHER'

    if (!file) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少文件（file 字段）' } },
        { status: 400 }
      )
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: { code: 'FILE_TOO_LARGE', message: '文件太大，最大支持 300MB' } },
        { status: 413 }
      )
    }

    const mimeType = file.type || 'application/octet-stream'
    const isImage = mimeType.startsWith('image/')
    const isVideo = mimeType.startsWith('video/')
    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '仅支持图片或视频素材' } },
        { status: 400 }
      )
    }
    const assetType = isImage ? 'IMAGE' : 'VIDEO'

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileExt = path.extname(file.name) || (isImage ? '.jpg' : '.mp4')
    const assetId = randomUUID()

    // 上传原文件到 OSS
    const ossKey = `merchant/${storeId}/library/${assetId}${fileExt}`
    await uploadBuffer(ossKey, fileBuffer)

    // 缩略图：视频抽首帧；图片直接复用原图作为缩略图（前端可自行缩放）
    let thumbnailKey: string | null = null
    if (isVideo) {
      const tempDir = path.join(tmpdir(), 'merchant-library')
      await mkdir(tempDir, { recursive: true })
      const tempVideoPath = path.join(tempDir, `${assetId}${fileExt}`)
      await writeFile(tempVideoPath, fileBuffer)
      tempFiles.push(tempVideoPath)
      try {
        const thumbPath = path.join(tempDir, `${assetId}_thumb.jpg`)
        tempFiles.push(thumbPath)
        await execFileAsync('ffmpeg', [
          '-ss', '1',
          '-i', tempVideoPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-y', thumbPath,
        ], { timeout: 30_000 })
        const thumbBuffer = await readFile(thumbPath)
        thumbnailKey = `merchant/${storeId}/library/${assetId}_thumb.jpg`
        await uploadBuffer(thumbnailKey, thumbBuffer)
      } catch (thumbErr) {
        console.warn('[library/upload] 视频缩略图生成失败（不阻断）:', thumbErr)
      }
    }

    const rawAsset = await prisma.rawAsset.create({
      data: {
        id: assetId,
        storeId,
        shotTaskId: null,
        uploaderUserId: userId,
        type: assetType,
        category,
        ossKey,
        filename: file.name,
        mimeType,
        sizeBytes: fileBuffer.length,
        thumbnailKey,
        expiresAt: null, // 素材库持久保留，不参与 14 天清理
      },
    })

    return NextResponse.json(
      {
        asset: {
          id: rawAsset.id,
          type: rawAsset.type,
          category: rawAsset.category,
          filename: rawAsset.filename,
          mimeType: rawAsset.mimeType,
          sizeBytes: rawAsset.sizeBytes,
          url: safeSign(rawAsset.ossKey),
          thumbUrl: rawAsset.thumbnailKey ? safeSign(rawAsset.thumbnailKey) : safeSign(rawAsset.ossKey),
          createdAt: rawAsset.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    return handleError(error, 'POST /api/merchant/stores/[storeId]/assets')
  } finally {
    for (const f of tempFiles) {
      try {
        await unlink(f)
      } catch {
        // 清理失败不阻断
      }
    }
  }
}
