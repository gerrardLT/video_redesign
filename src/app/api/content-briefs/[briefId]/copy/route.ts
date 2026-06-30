/**
 * PUT /api/content-briefs/[briefId]/copy — 就地保存人工编辑的平台文案（需求 2.1, 2.8）
 *
 * 将商家手工编辑的标题/正文/标签/CTA 原样写回 ContentBrief.platformCopies[platform]，
 * 并置 copyEdited=true（人工修改标记）。纯写库，不消耗积分。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId（brief→store→merchant→user 归属校验）
 *
 * 请求体：{ platform: PublishPlatform, copy: PlatformCopy }
 *
 * 响应：
 * - 200: { message: string }
 * - 400: 参数校验失败
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 2.1, 2.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { saveManualCopy } from '@/lib/publish-copy-service'
import { PublishPlatformSchema } from '@/types/merchant'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 单平台文案校验 Schema（就地保存原样写回，仅校验字段结构完整） */
const PlatformCopySchema = z.object({
  title: z.string(),
  coverTitle: z.string(),
  caption: z.string(),
  tags: z.array(z.string()),
  cta: z.string(),
})

/** 请求体校验 Schema */
const SaveCopyRequestSchema = z.object({
  platform: PublishPlatformSchema,
  copy: PlatformCopySchema,
})

/**
 * 验证 ContentBrief 归属（brief→store→merchant→user）并返回校验结果。
 */
async function validateBriefOwnership(briefId: string, userId: string) {
  const brief = await prisma.contentBrief.findUnique({
    where: { id: briefId },
    include: {
      store: {
        include: {
          merchant: { select: { userId: true } },
        },
      },
    },
  })

  if (!brief) {
    return { error: 'NOT_FOUND' as const, brief: null }
  }

  if (brief.store.merchant.userId !== userId) {
    return { error: 'FORBIDDEN' as const, brief: null }
  }

  return { error: null, brief }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    const { error, brief } = await validateBriefOwnership(briefId, userId)
    if (error === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }
    if (error === 'FORBIDDEN' || !brief) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

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

    const parseResult = SaveCopyRequestSchema.safeParse(body)
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

    const { platform, copy } = parseResult.data

    // 就地保存（不消耗积分），置人工修改标记
    await saveManualCopy({ contentBriefId: briefId, platform, copy })

    return NextResponse.json({ message: '文案已保存' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[PUT /api/content-briefs/[briefId]/copy] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '服务器内部错误' } },
      { status: 500 }
    )
  }
}
