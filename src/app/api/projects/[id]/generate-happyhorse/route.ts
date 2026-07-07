/**
 * POST /api/projects/:id/generate-happyhorse
 * HappyHorse V-Edit 模式生成入口
 *
 * Request Body:
 * {
 *   prompt: string,              // 编辑指令
 *   referenceImages?: string[],  // 参考图 URL（0-5 张）
 * }
 *
 * Response (200):
 * {
 *   mode: "direct" | "segmented",
 *   totalSegments: number,
 *   totalCost: number,
 *   jobs: [{ id, segmentIndex, status }]
 * }
 *
 * Error (402): { error: "INSUFFICIENT_CREDITS", message: "..." }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { orchestrateHappyHorseGeneration } from '@/lib/video/generation-orchestrator'
import { ApiError } from '@/lib/shared/api-error'
import type { UserTier } from '@/constants/concurrency'

const generateSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空').max(2500, 'prompt 最长 2500 字'),
  referenceImages: z.array(z.string().url()).max(5).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  // 解析请求体
  const body = await request.json()
  const parsed = generateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数校验失败', details: parsed.error.issues },
      { status: 400 }
    )
  }

  // 校验项目归属与状态
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, videoUrl: true, duration: true, status: true, engine: true },
  })
  if (!project) {
    return NextResponse.json({ error: '项目不存在' }, { status: 404 })
  }
  if (!project.videoUrl) {
    return NextResponse.json({ error: '项目无原始视频，无法使用 HappyHorse 模式' }, { status: 400 })
  }
  if (!project.duration || project.duration < 3) {
    return NextResponse.json(
      { error: `视频时长不足 3 秒（当前 ${project.duration}s），HappyHorse 最低要求 3 秒` },
      { status: 400 }
    )
  }

  // 确定用户等级
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  // 简化 tier 映射（与其它模块一致）
  const tier: UserTier = user?.role === 'VIP_YEARLY' ? 'YEARLY'
    : user?.role === 'VIP_MONTHLY' ? 'MONTHLY'
    : 'FREE'

  try {
    const result = await orchestrateHappyHorseGeneration({
      userId,
      projectId,
      videoUrl: project.videoUrl,
      videoDuration: project.duration,
      prompt: parsed.data.prompt,
      referenceImages: parsed.data.referenceImages,
      tier,
    })

    // 更新项目引擎为 happyhorse（若尚未设置）
    if (project.engine !== 'happyhorse') {
      await prisma.project.update({
        where: { id: projectId },
        data: { engine: 'happyhorse', status: 'GENERATING' },
      })
    } else {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: 'GENERATING' },
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json(
        { error: 'INSUFFICIENT_CREDITS', message: error.message },
        { status: 402 }
      )
    }
    throw error
  }
}
