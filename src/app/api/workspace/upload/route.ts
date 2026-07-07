/**
 * POST /api/workspace/upload
 * 工作台参考素材上传接口
 *
 * 支持图片（jpg/png/webp ≤10MB）、视频（mp4/mov/webm ≤100MB）、音频（mp3/wav/aac ≤20MB）
 * 上传到 OSS 并返回公网 URL + 缩略图 URL（图片/视频有，音频无）
 *
 * Request: multipart/form-data, field: file
 * Response: { url, thumbUrl?, type, fileSize }
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadBuffer, getPublicUrl } from '@/lib/shared/storage'
import { validateFile } from '@/lib/video/workspace-validators'
import type { WorkspaceUploadResponse } from '@/types/workspace'

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: '无法解析表单数据' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: '未提供文件' }, { status: 400 })
  }

  // 校验文件类型和大小
  const validation = validateFile(file.name, file.type, file.size)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 })
  }

  const assetType = validation.type
  const ext = file.name.split('.').pop() || 'bin'
  const ossKey = `workspace/${userId}/${assetType}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  // 上传到 OSS
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadBuffer(ossKey, buffer)
  const url = getPublicUrl(ossKey)

  // 生成缩略图 URL（图片和视频有，音频无）
  let thumbUrl: string | undefined
  if (assetType === 'image') {
    // 图片直接用 OSS 图片处理参数生成缩略图
    thumbUrl = `${url}?x-oss-process=image/resize,w_200,h_200,m_fill`
  } else if (assetType === 'video') {
    // 视频使用 OSS 视频截帧生成缩略图
    thumbUrl = `${url}?x-oss-process=video/snapshot,t_1000,w_200,h_200,m_fast`
  }

  const response: WorkspaceUploadResponse = {
    url,
    thumbUrl,
    type: assetType,
    fileSize: file.size,
  }

  return NextResponse.json(response)
}
