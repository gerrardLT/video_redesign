import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// DELETE /api/assets/[id] - 删除素材
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 验证素材存在且属于当前用户的项目
    const asset = await prisma.asset.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    })

    if (!asset || asset.project?.userId !== userId) {
      return NextResponse.json({ error: '素材不存在' }, { status: 404 })
    }

    // 删除关联的 ShotAsset 记录
    await prisma.shotAsset.deleteMany({
      where: { assetId: id },
    })

    // 删除素材记录
    await prisma.asset.delete({
      where: { id },
    })

    // TODO: 从 OSS 删除实际文件

    return NextResponse.json({ message: '素材已删除' })
  } catch (error) {
    console.error('[DELETE /api/assets/[id]]', error)
    return NextResponse.json({ error: '删除素材失败' }, { status: 500 })
  }
}
