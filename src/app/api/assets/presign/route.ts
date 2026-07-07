import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30MB
const MAX_ASSET_COUNT = 20

// 预签名上传 schema
const PresignSchema = z.object({
  projectId: z.string(),
  fileName: z.string(),
  fileSize: z.number().max(MAX_FILE_SIZE, '文件大小不能超过 30MB'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

// POST /api/assets/presign - 获取上传预签名 URL
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const body = await request.json()
    const parseResult = PresignSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const { projectId, fileName, fileSize, mimeType } = parseResult.data

    // 校验项目归属
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 校验素材数量限制
    const assetCount = await prisma.asset.count({
      where: { projectId },
    })

    if (assetCount >= MAX_ASSET_COUNT) {
      return NextResponse.json(
        { error: `素材数量已达上限（最多 ${MAX_ASSET_COUNT} 个）` },
        { status: 400 }
      )
    }

    // 生成存储 key
    const key = `assets/${projectId}/${Date.now()}_${fileName}`

    // MVP: 使用本地上传端点
    const uploadUrl = `/api/upload`

    // 创建素材记录（状态为 PENDING）
    const asset = await prisma.asset.create({
      data: {
        projectId,
        userId,
        type: 'UPLOADED_IMAGE',
        url: '', // 上传确认后填充
        fileName,
        fileSize,
        isCharImage: false,
        status: 'PENDING',
        sortOrder: assetCount + 1,
      },
    })

    // 隐藏 mimeType lint warning
    void mimeType

    return NextResponse.json({
      assetId: asset.id,
      uploadUrl,
      key,
    })
  } catch (error) {
    console.error('[POST /api/assets/presign]', error)
    return NextResponse.json({ error: '生成上传地址失败' }, { status: 500 })
  }
}
