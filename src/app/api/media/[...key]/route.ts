import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/shared/db'
import {
  isOSSConfigured,
  getSignedObjectUrl,
} from '@/lib/shared/storage'

export const dynamic = 'force-dynamic'

/**
 * GET /api/media/[...key] — 私有媒体鉴权代理（缺陷 10）
 *
 * 取代「public/uploads 无鉴权静态公开」与「OSS 公共读直链」对私有产物的暴露：
 * 1) 鉴权：本路由位于 /api/ 下，middleware 已校验登录 Cookie 并注入 x-user-id；此处再防御性读取，缺失即 401。
 * 2) 归属校验：从对象 key 推导归属（userId 段或 projectId 段），查 Project 确认归属调用者（ADMIN 放行），否则 403。
 * 3) 访问：OSS 已配置时签发短时效签名 URL 并 302 重定向（大文件/视频 Range 交由 OSS 处理）；
 *    未配置 OSS（开发模式）时在鉴权通过后从 public/uploads 本地文件流式返回。
 *
 * 无任何「未鉴权直接返回文件」的 fallback；未知 key 前缀一律 403（不静默放行）。
 *
 * 注意：完整防护还要求把 OSS Bucket ACL 设为私有读（运维跟进项），否则 OSS 直链仍可被猜测访问。
 */

// key 前缀 → 归属字段映射
// projectId 段（segments[1]）关联 Project.userId
const PROJECT_SCOPED_PREFIXES = new Set([
  'generated',  // generated/{projectId}/...
  'audio',      // audio/{projectId}/...
  'cover',      // cover/{projectId}/...
  'normalized', // normalized/{projectId}/...
  'downloads',  // downloads/{projectId}/...
  'frames',     // frames/{projectId}/...
  'characters', // characters/{projectId}/...（人物头像）
])
// userId 段（segments[1]）直接为归属用户
const USER_SCOPED_PREFIXES = new Set([
  'videos',   // videos/{userId}/{projectId}/...
  'exported', // exported/{userId}/{projectId}/...
])

/**
 * 校验调用者是否拥有该对象。
 * @returns true 放行；false 拒绝（归属不符 / 未知前缀 / key 结构非法）
 */
async function isOwner(key: string, callerId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true

  const segments = key.split('/').filter(Boolean)
  if (segments.length < 2) return false
  const prefix = segments[0]

  if (USER_SCOPED_PREFIXES.has(prefix)) {
    // segments[1] 即归属 userId
    return segments[1] === callerId
  }

  if (PROJECT_SCOPED_PREFIXES.has(prefix)) {
    // segments[1] 为 projectId，查 Project.userId 确认归属
    const projectId = segments[1]
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    })
    return !!project && project.userId === callerId
  }

  // 未知前缀（含已废弃的 first-frames 等无法推导归属者）：不静默放行
  return false
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    // 1. 鉴权（防御性：middleware 已强制，此处再校验，缺失即拒绝）
    const callerId = request.headers.get('x-user-id')
    if (!callerId) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '未登录' } }, { status: 401 })
    }
    const isAdmin = request.headers.get('x-user-role') === 'ADMIN'

    // 2. 还原对象 key（各段在 storage.getMediaProxyUrl 中被 encodeURIComponent，这里逐段解码）
    const { key: keySegments } = await params
    if (!keySegments || keySegments.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, { status: 404 })
    }
    const key = keySegments.map((seg) => decodeURIComponent(seg)).join('/')

    // 防止路径穿越（仅允许形如 prefix/.../file 的相对 key）
    if (key.includes('..') || key.startsWith('/')) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: '非法资源路径' } }, { status: 403 })
    }

    // 3. 归属校验
    const owned = await isOwner(key, callerId, isAdmin)
    if (!owned) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: '无权访问该资源' } }, { status: 403 })
    }

    // 4. 访问
    if (isOSSConfigured()) {
      // 优先 302 重定向到短时效签名 URL（视频 Range 由 OSS 处理，避免占用 Node 流）
      const signedUrl = getSignedObjectUrl(key, 300)
      return NextResponse.redirect(signedUrl, 302)
    }

    // 开发模式（未配置 OSS）：鉴权通过后从本地 public/uploads 流式返回
    const localPath = path.join(process.cwd(), 'public', 'uploads', ...key.split('/'))
    try {
      const fileStat = await stat(localPath)
      if (!fileStat.isFile()) {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, { status: 404 })
      }
      const nodeStream = createReadStream(localPath)
      const webStream = Readable.toWeb(nodeStream) as ReadableStream
      return new NextResponse(webStream, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFromKey(key),
          'Content-Length': String(fileStat.size),
          'Cache-Control': 'private, no-store',
        },
      })
    } catch {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, { status: 404 })
    }
  } catch (error) {
    console.error('[GET /api/media/[...key]]', error)
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '媒体访问失败' } }, { status: 500 })
  }
}

/** 根据 key 扩展名推断 Content-Type（本地流式返回用） */
function contentTypeFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase()
  switch (ext) {
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}
