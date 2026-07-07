import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { renewExpiry } from '@/lib/shared/asset-lifecycle-service'
import { computeExpiryStatus } from '@/lib/shared/expiry-status'

export const dynamic = 'force-dynamic'

/**
 * POST /api/assets/[id]/renew - 续期资产
 *
 * 从当前时间起延长资产有效期 14 天
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 响应：{ success: true, asset: { id, expiresAt, expiryStatus, remainingDays } }
 *
 * 错误处理：
 * - 401: 未授权（缺少 x-user-id）
 * - 404: 资产不存在或不属于当前用户
 * - 400: 永久资产无需续期 / 已过期资产无法续期
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. 获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { id } = await params

    // 2. 查找资产并校验所有权（通过项目关联）
    const asset = await prisma.asset.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    })

    if (!asset || asset.project?.userId !== userId) {
      return NextResponse.json({ error: '资产不存在' }, { status: 404 })
    }

    // 3. 校验：永久资产（category 有值）无需续期
    if (asset.category) {
      return NextResponse.json({ error: '永久资产无需续期' }, { status: 400 })
    }

    // 4. 校验：已过期资产无法续期
    if (asset.status === 'EXPIRED') {
      return NextResponse.json({ error: '该资产已过期，无法续期' }, { status: 400 })
    }

    // 5. 调用续期服务：从当前时间起延长 14 天
    await renewExpiry(id, 14)

    // 6. 重新查询更新后的资产
    const updated = await prisma.asset.findUnique({ where: { id } })
    const expiryStatus = computeExpiryStatus(updated!.expiresAt)

    return NextResponse.json({
      success: true,
      asset: {
        id: updated!.id,
        expiresAt: updated!.expiresAt,
        expiryStatus: expiryStatus.status,
        remainingDays: expiryStatus.remainingDays,
      },
    })
  } catch (error) {
    console.error('[POST /api/assets/[id]/renew]', error)
    return NextResponse.json(
      { error: '续期资产失败' },
      { status: 500 }
    )
  }
}
