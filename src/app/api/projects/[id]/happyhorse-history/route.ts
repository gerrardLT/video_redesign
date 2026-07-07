/**
 * GET /api/projects/:id/happyhorse-history
 * HappyHorse 生成历史记录接口
 *
 * Query 参数:
 * - cursor: 分页游标（上一页最后一条记录的 ID）
 * - limit: 每页数量（默认 20，最大 50）
 *
 * Response (200):
 * {
 *   records: HistoryRecord[],
 *   nextCursor?: string
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  // 校验 query 参数
  const searchParams = Object.fromEntries(request.nextUrl.searchParams)
  const parsed = querySchema.safeParse(searchParams)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数校验失败', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const { cursor, limit } = parsed.data

  try {
    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 查询历史记录（engine = 'happyhorse'，按时间倒序）
    const jobs = await prisma.generationJob.findMany({
      where: {
        projectId,
        userId,
        engine: 'happyhorse',
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // 多取一条判断是否有下一页
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // 跳过 cursor 指向的记录
      }),
      select: {
        id: true,
        createdAt: true,
        promptSnapshot: true,
        status: true,
        resultVideoUrl: true,
        costEstimate: true,
        segmentIndex: true,
      },
    })

    // 判断是否有下一页
    const hasMore = jobs.length > limit
    const records = hasMore ? jobs.slice(0, limit) : jobs

    // 映射为前端格式
    const formattedRecords = records.map((job) => ({
      id: job.id,
      createdAt: job.createdAt.toISOString(),
      prompt: job.promptSnapshot || '',
      status: mapStatus(job.status),
      thumbnailUrl: undefined, // 视频缩略图由前端生成或后续补充
      videoUrl: job.resultVideoUrl || undefined,
      creditCost: job.costEstimate || undefined,
    }))

    const nextCursor = hasMore ? records[records.length - 1].id : undefined

    return NextResponse.json({
      records: formattedRecords,
      nextCursor,
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/happyhorse-history]', error)
    return NextResponse.json({ error: '获取历史记录失败' }, { status: 500 })
  }
}

/** 将数据库状态映射为前端状态枚举 */
function mapStatus(dbStatus: string): 'pending' | 'running' | 'succeeded' | 'failed' {
  switch (dbStatus) {
    case 'CREATED':
    case 'QUEUED':
    case 'CREDIT_RESERVED':
      return 'pending'
    case 'SUBMITTED':
    case 'GENERATING':
      return 'running'
    case 'SUCCEEDED':
      return 'succeeded'
    case 'FAILED':
    case 'CANCELED':
    case 'REFUNDED':
      return 'failed'
    default:
      return 'pending'
  }
}
