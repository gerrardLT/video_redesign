import { NextRequest, NextResponse } from 'next/server'
import { deleteAsset } from '@/lib/asset-library-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/asset-library/[id] - 删除资产
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 错误处理：
 * - 404: 资产不存在
 * - 403: 无权删除他人资产
 * - 500: 服务器内部错误
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    await deleteAsset(id, userId)

    return NextResponse.json({ message: '资产已删除' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[DELETE /api/asset-library/[id]]', error)
    return NextResponse.json(
      { error: '删除资产失败' },
      { status: 500 }
    )
  }
}
