/**
 * GET /api/workspace/gallery
 * 工作台画廊列表接口
 *
 * 查询参数：
 * - tab: 'discover' | 'my' — 发现/我的作品
 * - page: 页码（从 1 开始，默认 1）
 * - pageSize: 每页数量（默认 12）
 *
 * 查询逻辑：
 * - shotId=null AND shotGroupId=null → 排除分镜工厂的任务
 * - status='SUCCEEDED' → 仅展示成功作品
 * - 按 createdAt 倒序分页
 *
 * Response: { items, total, hasMore }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { GalleryItem, GalleryResponse } from '@/types/workspace'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') || 'my'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '12', 10)))
  const offset = (page - 1) * pageSize

  // 基础查询条件：工作台任务（shotId=null, shotGroupId=null, 成功状态）
  const baseWhere = {
    shotId: null,
    shotGroupId: null,
    status: 'SUCCEEDED' as const,
    ...(tab === 'my' ? { userId } : {}),
  }

  // 查询总数
  const total = await prisma.generationJob.count({ where: baseWhere })

  // 查询列表
  const jobs = await prisma.generationJob.findMany({
    where: baseWhere,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: pageSize,
  })

  // 批量查询关联的 Project 信息
  const projectIds = [...new Set(jobs.map((j) => j.projectId))]
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, coverUrl: true, aspectRatio: true, videoUrl: true },
  })
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  // 映射为 GalleryItem
  const items: GalleryItem[] = jobs.map((job) => {
    const project = projectMap.get(job.projectId)
    return {
      id: job.id,
      projectId: job.projectId,
      videoUrl: job.resultVideoUrl || project?.videoUrl || '',
      coverUrl: project?.coverUrl || undefined,
      prompt: job.promptSnapshot || '',
      model: (job.engine || 'seedance') as 'seedance' | 'happyhorse',
      duration: job.duration || 5,
      aspectRatio: project?.aspectRatio || '16:9',
      createdAt: job.createdAt.toISOString(),
    }
  })

  const response: GalleryResponse = {
    items,
    total,
    hasMore: offset + pageSize < total,
  }

  return NextResponse.json(response)
}
