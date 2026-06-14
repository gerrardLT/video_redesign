import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { uploadBuffer } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/**
 * POST /api/characters/[id]/upload-image - 用户上传人物形象（锚定图）
 *
 * 用途：允许用户为人物上传自有形象图（如插画/3D/卡通/品牌 IP），直接作为全片人物锚定图，
 *       替代文生图生成。上传图存自有 OSS 并返回公网 URL（Seedance 需公网可抓取作 reference_image）。
 *
 * 合规提示：火山方舟对含真人人脸的参考图有输入审核，上传真人照片在后续视频生成阶段可能被拦截；
 *           真人肖像请改走方舟「预置虚拟人像」或「真人认证」流程。本接口不做人脸检测（由下游平台审核）。
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

    // 3. 上传到 OSS（公网可访问，供 Seedance 作 reference_image 抓取）
    const projectId = character.project.id
    const ossKey = `characters/${projectId}/uploaded_${Date.now()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const imageUrl = await uploadBuffer(ossKey, buffer)

    // 4. 写回人物锚定图：imageUrl + 置 ACTIVE（与文生图生成结果同一字段，下游一视同仁作锚定图复用）
    await prisma.character.update({
      where: { id },
      data: { imageUrl, avatarStatus: 'ACTIVE' },
    })

    // 5. 记录为可复用的 CHARACTER_IMAGE 资产
    await prisma.asset.create({
      data: {
        projectId,
        userId,
        type: 'CHARACTER_IMAGE',
        url: imageUrl,
        fileName: file.name || `${character.name}-上传形象${ext}`,
        fileSize: file.size,
        isCharImage: true,
        status: 'UPLOADED',
        sortOrder: 0,
      },
    })

    return NextResponse.json({
      character: {
        id: character.id,
        imageUrl,
        avatarStatus: 'ACTIVE',
      },
    })
  } catch (error) {
    console.error('[POST /api/characters/[id]/upload-image]', error)
    return NextResponse.json({ error: '上传人物形象失败' }, { status: 500 })
  }
}
