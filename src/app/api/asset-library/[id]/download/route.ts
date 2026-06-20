/**
 * 资产下载签名 URL API
 * GET /api/asset-library/[id]/download - 生成资产下载签名 URL
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * 返回：{ downloadUrl, fileName }（downloadUrl 为 10 分钟有效期 OSS 签名 URL）
 *
 * 错误处理：
 * - 400: 路由参数校验失败
 * - 403: 无权访问该资产
 * - 404: 资产不存在
 * - 500: 签名 URL 生成失败
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { generateDownloadUrl } from '@/lib/asset-library-service'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

// 路由参数校验 schema（资产 ID 必须为非空字符串）
const paramsSchema = z.object({
  id: z.string().min(1, '资产 ID 不能为空'),
})

// GET /api/asset-library/[id]/download - 生成下载签名 URL
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const resolvedParams = await params

    // Zod 校验路由参数
    const parseResult = paramsSchema.safeParse(resolvedParams)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: '资产 ID 无效' },
        { status: 400 }
      )
    }

    const { id } = parseResult.data

    // 调用服务层生成签名 URL
    const result = await generateDownloadUrl(id, userId)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('[GET /api/asset-library/[id]/download]', error)
    return NextResponse.json(
      { error: '下载链接生成失败' },
      { status: 500 }
    )
  }
}
