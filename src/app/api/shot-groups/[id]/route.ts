import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

/**
 * STALE 状态转换逻辑（编辑 timelineScript 或 Shot prompt 时触发）
 *
 * 当前 genStatus | 操作
 * SUCCEEDED     | → 标记 STALE，保留 genVideoUrl
 * PENDING/FAILED| → 仅保存编辑，不改 genStatus
 * QUEUED/GENERATING | → 拒绝编辑，返回 400
 * STALE         | → 仅保存编辑（已是 STALE）
 */
function handleStaleTransition(currentStatus: string): 'mark_stale' | 'save_only' | 'reject' {
  if (currentStatus === 'SUCCEEDED') return 'mark_stale'
  if (currentStatus === 'QUEUED' || currentStatus === 'GENERATING') return 'reject'
  return 'save_only'
}

// PATCH /api/shot-groups/[id] - 更新分镜组信息（当前支持 timelineScript 编辑）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: shotGroupId } = await params

    // 解析请求体
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求参数错误' } },
        { status: 400 }
      )
    }

    const { timelineScript, expectedUpdatedAt } = body as { timelineScript?: string; expectedUpdatedAt?: string }

    // 校验 timelineScript 类型
    if (timelineScript === undefined || typeof timelineScript !== 'string') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求参数错误' } },
        { status: 400 }
      )
    }

    // 校验长度：最大 10000 字符
    if (timelineScript.length > 10000) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '脚本内容不能超过10000个字符' } },
        { status: 400 }
      )
    }

    // 校验分镜组存在且归属当前用户
    const group = await prisma.shotGroup.findFirst({
      where: { id: shotGroupId },
      include: {
        project: { select: { userId: true } },
      },
    })

    if (!group || group.project.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '分镜组不存在' } },
        { status: 404 }
      )
    }

    // P2 修复：乐观锁 — 如果前端传了 expectedUpdatedAt，校验是否与数据库一致
    // 不一致说明另一个 tab/用户已修改，返回 409 冲突
    if (expectedUpdatedAt) {
      const expectedTime = new Date(expectedUpdatedAt).getTime()
      const actualTime = group.updatedAt.getTime()
      if (Math.abs(expectedTime - actualTime) > 1000) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: '数据已被其他操作修改，请刷新后重试' } },
          { status: 409 }
        )
      }
    }

    // STALE 状态转换检查（Req 7）
    const transition = handleStaleTransition(group.genStatus)

    if (transition === 'reject') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '该分镜组正在生成中，无法修改' } },
        { status: 400 }
      )
    }

    // 更新 timelineScript + 标记 scriptEdited=true（用户手动编辑，后续生成固定复用此脚本）
    // + 根据 transition 决定是否标记 STALE
    const updateData: { timelineScript: string; scriptEdited: boolean; genStatus?: string } = {
      timelineScript,
      scriptEdited: true,
    }
    if (transition === 'mark_stale') {
      updateData.genStatus = 'STALE'
    }

    const updated = await prisma.shotGroup.update({
      where: { id: shotGroupId },
      data: updateData,
      select: { id: true, timelineScript: true, genStatus: true, genVideoUrl: true, updatedAt: true },
    })

    return NextResponse.json({
      group: {
        id: updated.id,
        timelineScript: updated.timelineScript,
        genStatus: updated.genStatus,
        genVideoUrl: updated.genVideoUrl,
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[PATCH /api/shot-groups/[id]]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
