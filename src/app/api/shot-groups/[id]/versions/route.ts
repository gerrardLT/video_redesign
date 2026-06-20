import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { listVersions, getVersionStats, getPromptExcerpt } from '@/lib/version-history-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/shot-groups/[id]/versions
 *
 * 获取分镜组的版本历史列表和统计信息。
 * 返回按 versionNumber 降序排列的版本列表，以及版本数量/上限统计。
 *
 * 权限校验：确认 ShotGroup 属于当前用户（通过 project.userId）。
 *
 * 响应格式:
 * {
 *   versions: VersionItem[],
 *   stats: { count: number, limit: number }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: shotGroupId } = await params

    // 校验分镜组存在且归属当前用户
    const group = await prisma.shotGroup.findFirst({
      where: { id: shotGroupId },
      include: {
        project: { select: { userId: true } },
      },
    })

    if (!group) {
      return NextResponse.json({ error: '分镜组不存在' }, { status: 404 })
    }

    if (group.project.userId !== userId) {
      return NextResponse.json({ error: '无权访问该分镜组' }, { status: 403 })
    }

    // 获取版本列表和统计信息
    const [versions, stats] = await Promise.all([
      listVersions(shotGroupId),
      getVersionStats(shotGroupId),
    ])

    // 映射为 API 响应格式，添加 promptExcerpt 字段
    const versionItems = versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      videoUrl: v.videoUrl,
      coverUrl: v.coverUrl,
      lastFrameUrl: v.lastFrameUrl,
      promptExcerpt: getPromptExcerpt(v.promptSnapshot),
      promptSnapshot: v.promptSnapshot,
      costEstimate: v.costEstimate,
      isCurrent: v.isCurrent,
      createdAt: v.createdAt.toISOString(),
    }))

    return NextResponse.json({ versions: versionItems, stats })
  } catch (error) {
    console.error('[GET /api/shot-groups/[id]/versions]', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
