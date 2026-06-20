/**
 * 跨项目角色图应用 API
 * POST /api/asset-library/[id]/apply-to-character
 *
 * 将资产库中的角色图应用到目标项目的目标角色
 * 直接引用同一 OSS URL，不复制文件（节省存储、保持一致性）
 *
 * 请求体：
 * - targetProjectId: 目标项目 ID（必填）
 * - targetCharacterId: 目标角色 ID（必填）
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 *
 * 错误处理：
 * - 400: 请求体校验失败
 * - 403: 无权访问该资产 / 无权操作该项目
 * - 404: 资产不存在 / 目标项目不存在 / 目标角色不存在
 * - 500: 服务器内部错误
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { applyToCharacter } from '@/lib/asset-library-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// 请求体校验 schema
const applyBodySchema = z.object({
  targetProjectId: z.string().min(1, '目标项目 ID 不能为空'),
  targetCharacterId: z.string().min(1, '目标角色 ID 不能为空'),
})

/**
 * POST /api/asset-library/[id]/apply-to-character
 * 将资产库角色图应用到目标项目的目标角色
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id: assetId } = await params

    // 解析并校验请求体
    const body = await request.json()
    const parseResult = applyBodySchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: '请求参数无效' },
        { status: 400 }
      )
    }

    const { targetProjectId, targetCharacterId } = parseResult.data

    // 调用服务层执行跨项目应用
    const updatedCharacter = await applyToCharacter(
      assetId,
      targetProjectId,
      targetCharacterId,
      userId
    )

    return NextResponse.json({ character: updatedCharacter })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/asset-library/[id]/apply-to-character]', error)
    return NextResponse.json(
      { error: '应用角色图失败' },
      { status: 500 }
    )
  }
}
