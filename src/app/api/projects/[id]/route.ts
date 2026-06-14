import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { toMediaProxyUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id] - 获取项目详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    const project = await prisma.project.findFirst({
      where: { id, userId },
      include: {
        _count: {
          select: { shots: true },
        },
        shots: {
          select: { genStatus: true },
        },
        characters: {
          select: { enabled: true, avatarStatus: true, avatarAssetUrl: true },
        },
        assets: {
          select: { status: true },
        },
        styleConfig: {
          select: { templateId: true, customDescription: true, structuredStyle: true },
        },
        // 分镜组：按 groupIndex 升序，组内 shots 按 orderIndex 升序
        shotGroups: {
          orderBy: { groupIndex: 'asc' },
          select: {
            id: true,
            groupIndex: true,
            genStatus: true,
            genVideoUrl: true,
            genDuration: true,
            timelineScript: true,
            groupCharacters: { select: { characterId: true } },
            shots: {
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true,
                orderIndex: true,
                prompt: true,
                coverUrl: true,
              },
            },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 查询合成导出视频 URL（从 Asset 表查最新的 AI_GENERATED 文件）
    const exportedAsset = await prisma.asset.findFirst({
      where: {
        projectId: project.id,
        type: 'AI_GENERATED',
      },
      orderBy: { createdAt: 'desc' },
      select: { url: true },
    })

    // 分镜组数据：兼容新旧两种模式
    // 旧模式：解析阶段创建了 ShotGroup，前端通过 shotGroups 嵌套展示
    // 新模式（Gemini 帧分析）：解析阶段不创建 ShotGroup，Shot.shotGroupId = null
    // 兼容策略：如果 shotGroups 为空但存在未分组的 Shot，按 ≤15s 虚拟分组返回
    let shotGroupsResponse = project.shotGroups.map((g) => ({
      id: g.id,
      groupIndex: g.groupIndex,
      genStatus: g.genStatus,
      genVideoUrl: g.genVideoUrl,
      genDuration: g.genDuration,
      timelineScript: g.timelineScript,
      characterIds: g.groupCharacters.map((gc) => gc.characterId),
      shots: g.shots.map((s) => ({
        id: s.id,
        orderIndex: s.orderIndex,
        prompt: s.prompt,
        coverUrl: s.coverUrl,
      })),
    }))

    // 如果无 ShotGroup 但有未分组 Shot，虚拟分组供前端展示
    if (shotGroupsResponse.length === 0 && project._count.shots > 0) {
      const ungroupedShots = await prisma.shot.findMany({
        where: { projectId: project.id, shotGroupId: null },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          orderIndex: true,
          startTime: true,
          endTime: true,
          prompt: true,
          coverUrl: true,
        },
      })

      if (ungroupedShots.length > 0) {
        // 按 ≤15s 贪心切段，将未分组分镜虚拟分组（仅用于响应展示）
        const virtualGroups: typeof shotGroupsResponse = []
        let currentGroup: typeof ungroupedShots = []
        let currentDuration = 0

        for (const shot of ungroupedShots) {
          const shotDur = shot.endTime - shot.startTime
          if (currentGroup.length === 0) {
            currentGroup.push(shot)
            currentDuration = shotDur
          } else if (currentDuration + shotDur <= 15) {
            currentGroup.push(shot)
            currentDuration += shotDur
          } else {
            virtualGroups.push({
              id: `virtual-${virtualGroups.length}`,
              groupIndex: virtualGroups.length,
              genStatus: 'PENDING',
              genVideoUrl: null,
              genDuration: Math.round(currentDuration * 100) / 100,
              timelineScript: null,
              characterIds: [],
              shots: currentGroup.map((s) => ({
                id: s.id,
                orderIndex: s.orderIndex,
                prompt: s.prompt,
                coverUrl: s.coverUrl,
              })),
            })
            currentGroup = [shot]
            currentDuration = shotDur
          }
        }
        // 最后一组
        if (currentGroup.length > 0) {
          virtualGroups.push({
            id: `virtual-${virtualGroups.length}`,
            groupIndex: virtualGroups.length,
            genStatus: 'PENDING',
            genVideoUrl: null,
            genDuration: Math.round(currentDuration * 100) / 100,
            timelineScript: null,
            characterIds: [],
            shots: currentGroup.map((s) => ({
              id: s.id,
              orderIndex: s.orderIndex,
              prompt: s.prompt,
              coverUrl: s.coverUrl,
            })),
          })
        }

        shotGroupsResponse = virtualGroups
      }
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        // 私有产物统一经鉴权代理路径 /api/media/{key} 下发，前端访问时由代理校验登录+归属（缺陷 10）
        videoUrl: toMediaProxyUrl(project.videoUrl),
        coverUrl: toMediaProxyUrl(project.coverUrl),
        exportedVideoUrl: toMediaProxyUrl(exportedAsset?.url) || null,
        status: project.status,
        duration: project.duration,
        aspectRatio: project.aspectRatio,
        errorMsg: project.errorMsg,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        shotCount: project._count.shots,
        // Stepper 所需的步骤状态计算数据
        shots: project.shots.map((s) => ({ genStatus: s.genStatus })),
        characters: project.characters.map((c) => ({ enabled: c.enabled, avatarStatus: c.avatarStatus, avatarAssetUrl: c.avatarAssetUrl })),
        assets: project.assets.map((a) => ({ status: a.status })),
        styleConfig: project.styleConfig,
        // 分镜组列表（真实 ShotGroup 或虚拟分组）：私有视频/封面同样经鉴权代理路径下发
        shotGroups: shotGroupsResponse.map((g) => ({
          ...g,
          genVideoUrl: toMediaProxyUrl(g.genVideoUrl) ?? null,
          shots: g.shots.map((s) => ({ ...s, coverUrl: toMediaProxyUrl(s.coverUrl) ?? null })),
        })),
      },
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]]', error)
    return NextResponse.json({ error: '获取项目详情失败' }, { status: 500 })
  }
}

// DELETE /api/projects/[id] - 删除项目
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    // 校验项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 删除项目（级联删除 shots, characters, assets）
    await prisma.project.delete({
      where: { id },
    })

    return NextResponse.json({ message: '项目已删除' })
  } catch (error) {
    console.error('[DELETE /api/projects/[id]]', error)
    return NextResponse.json({ error: '删除项目失败' }, { status: 500 })
  }
}
