/**
 * POST /api/upload-image
 * 通用图片上传接口（返回鉴权代理 URL）
 * 用于 HappyHorse 参考图等场景
 *
 * Request: multipart/form-data, field: file (JPEG/PNG/WEBP, ≤20MB)
 * Response: { url: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadBuffer, getPublicUrl, toMediaProxyUrl } from '@/lib/shared/storage'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '未认证' } }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '未提供文件' } }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: `不支持的格式: ${file.type}，仅支持 JPEG/PNG/WEBP` } },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: '文件超过 20MB 限制' } },
      { status: 400 }
    )
  }

  const ext = file.name.split('.').pop() || 'jpg'
  const ossKey = `uploads/images/${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadBuffer(ossKey, buffer)

  // P1 修复：返回鉴权代理 URL 而非公开直链，与私有产物访问策略一致
  // 同时返回 publicUrl 供需要外部服务直接抓取的场景（如 Seedance reference_image）
  const proxyUrl = toMediaProxyUrl(getPublicUrl(ossKey))
  const publicUrl = getPublicUrl(ossKey)

  return NextResponse.json({ url: publicUrl, proxyUrl })
}
