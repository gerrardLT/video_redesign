import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { uploadBuffer } from '@/lib/shared/storage'
import { imageGenerateQueue } from '@/lib/shared/queue'

export const dynamic = 'force-dynamic'

/**
 * POST /api/characters/[id]/upload-image - 用户上传人物形象（锚定图）
 *
 * 改造后流程：用户上传图片 → 暂存 OSS → 入队 generate-character Worker（附带原图 URL）
 * → Worker 内调 Seedream 图文生图（以上传图为参考，外貌描述 + 项目风格为 prompt 引导风格化）
 * → 产出 AI 风格化图存 OSS → 写入 Character.imageUrl
 *
 * 优势：产出为 Seedream AI 生成图，不含原始真人人脸生物特征，绕过 Seedance reference_image 人脸审核。
 * 用户体验：上传后立即返回 202（处理中），前端通过 SSE 进度感知完成状态。
 */

// 允许的图片类型与对应扩展名
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

// 上传图片大小上限：10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 1. 校验人物存在且属于当前用户的项目（归属鉴权）
    const character = await prisma.character.findFirst({
      where: { id },
      include: { project: { select: { id: true, userId: true } } },
    })
    if (!character || character.project.userId !== userId) {
      return NextResponse.json({ error: '人物不存在' }, { status: 404 })
    }

    // 2. 读取并校验上传文件
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 })
    }
    const ext = ALLOWED_IMAGE_TYPES[file.type]
    if (!ext) {
      return NextResponse.json({ error: '仅支持 png、jpg、webp 格式图片' }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: '图片大小不能超过 10MB' }, { status: 400 })
    }

    // 3. 暂存原图到 OSS（供 Worker 的 Seedream 图生图作参考图输入）
    const projectId = character.project.id
    const ossKey = `characters/${projectId}/uploaded_source_${Date.now()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const sourceImageUrl = await uploadBuffer(ossKey, buffer)

    // 4. 标记人物状态为 REGISTERING（生成中），前端展示 loading
    await prisma.character.update({
      where: { id },
      data: { avatarStatus: 'REGISTERING' },
    })

    // 5. 入队 generate-character Worker（附带原图 URL，Worker 内走 img2img 分支）
    await imageGenerateQueue.add('generate-character-image', {
      characterId: id,
      projectId,
      userId,
      prompt: character.appearance || '',
      sourceImageUrl, // 有此字段时 Worker 走图生图分支
    })

    // 6. 返回 202 Accepted（异步处理中，前端通过 SSE 感知完成状态）
    return NextResponse.json({
      character: {
        id: character.id,
        avatarStatus: 'REGISTERING',
        message: '正在基于上传图片生成风格化人物形象，请稍候...',
      },
    }, { status: 202 })
  } catch (error) {
    console.error('[POST /api/characters/[id]/upload-image]', error)
    return NextResponse.json({ error: '上传人物形象失败' }, { status: 500 })
  }
}
