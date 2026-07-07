/**
 * GET /api/projects/:id/estimate-happyhorse
 * HappyHorse 积分预估接口
 *
 * Query 参数:
 * - duration: 输入视频时长（秒），正整数，3-60 范围
 *
 * Response (200):
 * {
 *   estimatedCredits: number,  // 预估积分消耗
 *   balance: number,           // 当前积分余额
 *   sufficient: boolean        // 余额是否充足
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { estimateHappyHorseCreditCost } from '@/lib/shared/credit-calc'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  duration: z.coerce.number().int().min(3, '时长最少 3 秒').max(60, '时长最多 60 秒'),
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

  const { duration } = parsed.data

  try {
    // 验证项目归属
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 计算预估积分
    const estimatedCredits = estimateHappyHorseCreditCost(duration)

    // 查询当前余额
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })
    const balance = user?.creditBalance ?? 0
    const sufficient = balance >= estimatedCredits

    return NextResponse.json({
      estimatedCredits,
      balance,
      sufficient,
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/estimate-happyhorse]', error)
    return NextResponse.json({ error: '预估计算失败' }, { status: 500 })
  }
}
