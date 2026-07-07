/**
 * POST /api/projects/:id/background-image
 * 上传分镜组背景图（Seedance 模式）
 *
 * 接收 multipart/form-data：
 * - image: 图片文件（JPEG/PNG/WEBP, ≤10MB）
 * - shotGroupId: 分镜组 ID
 *
 * 上传至 OSS 并将 URL 写入 ShotGroup.backgroundImageUrl
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { uploadBuffer, getPublicUrl } from '@/lib/shared/storage'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  // 校验项目归属
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  })
  if (!project) {
    return NextResponse.json({ error: '项目不存在' }, { status: 404 })
  }

  // 解析 multipart/form-data
  const formData = await request.formData()
  const imageFile = formData.get('image') as File | null
  const shotGroupId = formData.get('shotGroupId') as string | null

  if (!imageFile) {
    return NextResponse.json({ error: '缺少 image 字段' }, { status: 400 })
  }
  if (!shotGroupId) {
    return NextResponse.json({ error: '缺少 shotGroupId 字段' }, { status: 400 })
  }

  // 校验文件类型
  if (!ALLOWED_TYPES.includes(imageFile.type)) {
    return NextResponse.json(
      { error: `不支持的图片格式: ${imageFile.type}，仅支持 JPEG/PNG/WEBP` },
      { status: 400 }
    )
  }

  // 校验文件大小
  if (imageFile.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `图片大小超出限制: ${(imageFile.size / 1024 / 1024).toFixed(1)}MB，最大 10MB` },
      { status: 400 }
    )
  }

  // 校验分镜组归属
  const shotGroup = await prisma.shotGroup.findFirst({
    where: { id: shotGroupId, projectId },
    select: { id: true },
  })
  if (!shotGroup) {
    return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
  }

  // 上传到 OSS
  const ext = imageFile.name.split('.').pop() || 'jpg'
  const ossKey = `background/${projectId}/${shotGroupId}_${Date.now()}.${ext}`
  const buffer = Buffer.from(await imageFile.arrayBuffer())
  await uploadBuffer(ossKey, buffer)
  const imageUrl = getPublicUrl(ossKey)

  // 更新 ShotGroup.backgroundImageUrl
  await prisma.shotGroup.update({
    where: { id: shotGroupId },
    data: { backgroundImageUrl: imageUrl },
  })

  return NextResponse.json({ url: imageUrl })
}
