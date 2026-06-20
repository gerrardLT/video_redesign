import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { faceDetectionService } from '@/lib/face-detection-service'

export const dynamic = 'force-dynamic'

// 确认上传 schema
const ConfirmSchema = z.object({
  assetId: z.string(),
  url: z.string(),
})

// POST /api/assets/confirm - 确认上传完成
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const body = await request.json()
    const parseResult = ConfirmSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: '参数校验失败', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const { assetId, url } = parseResult.data

    // 验证素材存在且属于当前用户的项目
    const asset = await prisma.asset.findFirst({
      where: { id: assetId },
      include: { project: { select: { userId: true } } },
    })

    if (!asset || asset.project?.userId !== userId) {
      return NextResponse.json({ error: '素材不存在' }, { status: 404 })
    }

    // 判断是否为需要人脸检测的参考素材类型（UPLOADED_IMAGE）
    const isReferenceAsset = asset.type === 'UPLOADED_IMAGE'

    // 更新素材状态：参考素材设为 CHECKING，其他类型设为 UPLOADED
    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: isReferenceAsset ? 'CHECKING' : 'UPLOADED',
        url,
      },
    })

    // 仅对 Reference_Asset（UPLOADED_IMAGE）触发人脸检测，Source_Video 和 CHARACTER_IMAGE 不触发
    if (isReferenceAsset) {
      // 异步触发人脸检测，不阻塞上传响应
      faceDetectionService.triggerFaceCheck(assetId, userId).catch((err) => {
        console.error('[POST /api/assets/confirm] 触发人脸检测失败:', err)
      })
    }

    return NextResponse.json({
      asset: {
        id: updatedAsset.id,
        type: updatedAsset.type,
        url: updatedAsset.url,
        thumbUrl: updatedAsset.thumbUrl,
        fileName: updatedAsset.fileName,
        isCharImage: updatedAsset.isCharImage,
        status: updatedAsset.status,
      },
    })
  } catch (error) {
    console.error('[POST /api/assets/confirm]', error)
    return NextResponse.json({ error: '确认上传失败' }, { status: 500 })
  }
}
