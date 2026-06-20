/**
 * 版本切换 API
 *
 * POST /api/shot-groups/[id]/versions/[versionId]/switch
 * 将指定版本设为当前版本，同步更新 ShotGroup 的 genVideoUrl/genCoverUrl/lastFrameUrl。
 * 不消耗积分，不创建 CreditLedger 记录。
 *
 * 响应：{ version: VersionItem, shotGroup: { genVideoUrl, genCoverUrl, lastFrameUrl } }
 * 错误：400（版本不属于该分镜组/无效参数）、404（版本不存在）、409（并发冲突）
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/auth-helpers'
import { switchVersion, getPromptExcerpt } from '@/lib/version-history-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    // 1. 认证：获取当前用户 ID
    const userId = getUserId(request)

    // 2. 获取动态路由参数
    const { id: shotGroupId, versionId } = await params

    // 3. 参数基本校验
    if (!shotGroupId || !versionId) {
      return NextResponse.json(
        { error: '请求参数错误' },
        { status: 400 }
      )
    }

    // 4. 验证 ShotGroup 存在且属于当前用户
    const shotGroup = await prisma.shotGroup.findFirst({
      where: { id: shotGroupId },
      include: {
        project: { select: { userId: true } },
      },
    })

    if (!shotGroup) {
      return NextResponse.json(
        { error: '分镜组不存在' },
        { status: 404 }
      )
    }

    if (shotGroup.project.userId !== userId) {
      return NextResponse.json(
        { error: '无权限操作此分镜组' },
        { status: 403 }
      )
    }

    // 5. 调用服务层切换版本
    const updatedVersion = await switchVersion(shotGroupId, versionId)

    // 6. 构造响应（VersionItem 格式 + ShotGroup 更新后的字段）
    const versionItem = {
      id: updatedVersion.id,
      versionNumber: updatedVersion.versionNumber,
      videoUrl: updatedVersion.videoUrl,
      coverUrl: updatedVersion.coverUrl,
      lastFrameUrl: updatedVersion.lastFrameUrl,
      promptExcerpt: getPromptExcerpt(updatedVersion.promptSnapshot),
      promptSnapshot: updatedVersion.promptSnapshot,
      costEstimate: updatedVersion.costEstimate,
      isCurrent: updatedVersion.isCurrent,
      createdAt: updatedVersion.createdAt.toISOString(),
    }

    return NextResponse.json({
      version: versionItem,
      shotGroup: {
        genVideoUrl: updatedVersion.videoUrl,
        genCoverUrl: updatedVersion.coverUrl,
        lastFrameUrl: updatedVersion.lastFrameUrl,
      },
    })
  } catch (error) {
    // 处理 ApiError（服务层抛出的业务错误）
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    console.error('[POST /api/shot-groups/[id]/versions/[versionId]/switch]', error)
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    )
  }
}
