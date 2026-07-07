/**
 * POST /api/asset-library/upload
 * 资产库上传接口 — 上传文件到 OSS 并写入 Asset 表
 *
 * Request: multipart/form-data
 *   - file: 文件
 *   - category: 分类（CHARACTER | MATERIAL | AUDIO）
 *   - displayName: 可选自定义名称
 *
 * Response: { id, url, thumbUrl, category, displayName }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { uploadBuffer, getPublicUrl } from '@/lib/shared/storage'
import { validateFile } from '@/lib/video/workspace-validators'

const VALID_CATEGORIES = ['CHARACTER', 'MATERIAL', 'AUDIO'] as const

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
  const category = formData.get('category') as string | null
  const displayName = formData.get('displayName') as string | null

  if (!file) {
    return NextResponse.json({ error: '未提供文件' }, { status: 400 })
  }

  if (!category || !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    return NextResponse.json({ error: '请选择分类（CHARACTER / MATERIAL / AUDIO）' }, { status: 400 })
  }

  // 校验文件类型和大小
  const validation = validateFile(file.name, file.type, file.size)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 })
  }

  // 确定 Asset type
  const assetType = validation.type === 'image' ? 'UPLOADED_IMAGE' : validation.type === 'video' ? 'UPLOADED_IMAGE' : 'UPLOADED_IMAGE'

  // 上传到 OSS
  const ext = file.name.split('.').pop() || 'bin'
  const ossKey = `asset-library/${userId}/${category.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadBuffer(ossKey, buffer)
  const url = getPublicUrl(ossKey)

  // 生成缩略图
  let thumbUrl: string | null = null
  if (validation.type === 'image') {
    thumbUrl = `${url}?x-oss-process=image/resize,w_200,h_200,m_fill`
  } else if (validation.type === 'video') {
    thumbUrl = `${url}?x-oss-process=video/snapshot,t_1000,w_200,h_200,m_fast`
  }

  // 写入 Asset 表
  const asset = await prisma.asset.create({
    data: {
      userId,
      url,
      thumbUrl,
      fileName: file.name,
      displayName: displayName || file.name.replace(/\.[^.]+$/, ''),
      type: assetType,
      category,
      fileSize: file.size,
      status: 'UPLOADED',
    },
  })

  return NextResponse.json({
    id: asset.id,
    url,
    thumbUrl,
    category,
    displayName: asset.displayName,
  })
}
