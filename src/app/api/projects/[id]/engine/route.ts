/**
 * PATCH /api/projects/:id/engine
 * 切换项目默认生成引擎
 *
 * Request Body: { engine: "seedance" | "happyhorse" }
 * Response: { engine: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'

const engineSchema = z.object({
  engine: z.enum(['seedance', 'happyhorse']),
})

export async function PATCH(
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
  const parsed = engineSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '引擎取值无效，仅支持 "seedance" 或 "happyhorse"' },
      { status: 400 }
    )
  }

  // 校验项目归属
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  })
  if (!project) {
    return NextResponse.json({ error: '项目不存在' }, { status: 404 })
  }

  // 更新引擎
  await prisma.project.update({
    where: { id: projectId },
    data: { engine: parsed.data.engine },
  })

  return NextResponse.json({ engine: parsed.data.engine })
}
