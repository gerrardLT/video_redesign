/**
 * POST /api/publish-queue/[itemId]/mark-published — 手动标记已发布（需求 8.4）
 *
 * 调用 publish-queue-service.markPublished：将「平台 + 发布时间」写入清单项的
 * publishedPlatforms，标记后该内容即纳入后续数据回填/复盘范围（可反哺）。
 *
 * Route Handler 仅做鉴权 + 归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权（防越权）：先按 itemId 查 PublishQueueItem 取其 storeId，再通过
 * validateMerchantAccess 校验当前用户对该门店的归属，避免跨门店越权标记。
 *
 * 请求体：
 * - platform: PublishPlatform（必填）发布到的目标平台
 * - publishedAt?: string（ISO 8601，可选）发布时间，缺省取服务器当前时间
 *
 * 响应：
 * - 200: { message: string }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 404: 清单项不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 8.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant-auth'
import { markPublished, PublishQueueError } from '@/lib/publish-queue-service'
import { PublishPlatformSchema } from '@/types/merchant'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

/**
 * 标记发布请求体校验：
 * - platform 必填，限定为受支持的发布平台
 * - publishedAt 可选 ISO 8601 时间戳，缺省由服务端取当前时间
 */
const MarkPublishedSchema = z.object({
  platform: PublishPlatformSchema,
  publishedAt: z.string().datetime().optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 防越权：先查清单项取其 storeId，再校验当前用户对该门店的归属
    const item = await prisma.publishQueueItem.findUnique({
      where: { id: itemId },
      select: { storeId: true },
    })
    if (!item) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '待发布清单项不存在' } },
        { status: 404 }
      )
    }
    await validateMerchantAccess(userId, item.storeId)

    // 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    // Zod 校验
    const parseResult = MarkPublishedSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }

    const { platform, publishedAt } = parseResult.data

    // 调用标记发布服务（publishedAt 缺省取当前时间，不消耗积分）
    await markPublished({
      publishQueueItemId: itemId,
      platform,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
    })

    return NextResponse.json({ message: '已标记发布' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    // 服务层业务错误（如清单项在并发删除后不存在）
    if (error instanceof PublishQueueError) {
      const status = error.code === 'QUEUE_ITEM_NOT_FOUND' ? 404 : 400
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status }
      )
    }
    console.error('[POST /api/publish-queue/[itemId]/mark-published] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
