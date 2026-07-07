import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { computeExpiryStatus } from '@/lib/shared/expiry-status'

export const dynamic = 'force-dynamic'

/**
 * POST /api/assets/[id]/bookmark - 收藏资产（升级为永久资产）
 *
 * 将临时资产升级为永久资产：设置 expiresAt=null，设置 category
 *
 * 鉴权：从 x-user-id header 获取用户 ID，校验与 asset.userId 一致
 * 请求体：{ category?: string }  默认 'CHARACTER'
 * 响应：{ success: true, asset: AssetWithExpiryStatus }
 *
 * 错误处理：
 * - 401: 未授权（缺少 x-user-id）
 * - 404: 资产不存在
 * - 403: 无权操作他人资产
 * - 400: 已过期资产无法收藏
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

    // 2. 查找资产
    const asset = await prisma.asset.findUnique({ where: { id } })
    if (!asset) {
      return NextResponse.json({ error: '资产不存在或已被删除' }, { status: 404 })
    }

    // 3. 校验所有权
    if (asset.userId !== userId) {
      return NextResponse.json({ error: '无权操作该资产' }, { status: 403 })
    }

    // 4. 校验状态：已过期资产无法收藏
    if (asset.status === 'EXPIRED') {
      return NextResponse.json({ error: '该资产已过期清理，无法收藏' }, { status: 400 })
    }

    // 5. 读取请求体
    const body = await request.json().catch(() => ({}))
    const category = body.category || 'CHARACTER'

    // 6. 更新资产：设置 expiresAt=null 升级为永久资产，设置 category
    const updated = await prisma.asset.update({
      where: { id },
      data: { expiresAt: null, category },
    })

    // 7. 计算 expiryStatus
    const expiryStatus = computeExpiryStatus(updated.expiresAt)

    return NextResponse.json({
      success: true,
      asset: {
        ...updated,
        expiryStatus: expiryStatus.status,
        remainingDays: expiryStatus.remainingDays,
      },
    })
  } catch (error) {
    console.error('[POST /api/assets/[id]/bookmark]', error)
    return NextResponse.json(
      { error: '收藏资产失败' },
      { status: 500 }
    )
  }
}
