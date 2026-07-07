import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { deleteVersion } from '@/lib/video/version-history-service'
import { ApiError } from '@/lib/shared/api-error'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/shot-groups/[id]/versions/[versionId] - 删除指定版本
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 权限：校验 ShotGroup 属于当前用户
 * 错误处理：
 * - 400: 当前版本不可删除
 * - 401: 未登录
 * - 404: ShotGroup 或版本不存在
 * - 500: 服务器内部错误
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { id: shotGroupId, versionId } = await params

    // 校验 ShotGroup 存在且属于当前用户
    const shotGroup = await prisma.shotGroup.findFirst({
      where: { id: shotGroupId },
      include: { project: { select: { userId: true } } },
    })

    if (!shotGroup) {
      return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
    }

    if (shotGroup.project.userId !== userId) {
      return NextResponse.json({ error: '无权操作此分镜组' }, { status: 403 })
    }

    // 调用服务层删除版本
    await deleteVersion(shotGroupId, versionId)

    // 成功返回 204 No Content
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    // 处理 ApiError（statusCode 属性）
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    // 处理服务层抛出的带 status 属性的 Error
    if (error instanceof Error && 'status' in error) {
      const statusCode = (error as Error & { status: number }).status
      // 当前版本删除返回特定消息
      if (statusCode === 400) {
        return NextResponse.json(
          { error: '当前版本不可删除' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: error.message },
        { status: statusCode }
      )
    }

    console.error('[DELETE /api/shot-groups/[id]/versions/[versionId]]', error)
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    )
  }
}
