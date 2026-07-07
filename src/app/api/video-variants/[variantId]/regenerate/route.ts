/**
 * POST /api/video-variants/[variantId]/regenerate — 单版本重生成（需求 4.2, 4.6, 4.7, 4.8, 4.9）
 *
 * 仅重生成指定的 VideoVariant，保留同一 brief 下的其它版本（隔离性）。
 *
 * 流程：
 * 1. 鉴权：从 x-user-id header 获取用户 ID
 * 2. 验证归属关系：variant → ContentBrief → Store → Merchant.userId === currentUserId
 * 3. 接收可选 body：{ advancedParams?: { style?, durationSec?, templateId? } }
 *    —— 小白老板默认一键路径无 body；运营型用户「高级」抽屉才传 advancedParams（需求 4.6）
 * 4. 调用 regenerateSingleVariant（其内部已含分布式锁 + 计费链路 reserve→charge/refund +
 *    余额预检 + 高级参数校验与可解释标注），不新建并行计费路径（需求 4.9）
 * 5. 返回重生成后的 VideoVariant
 *
 * 计费：消耗积分，统一复用 local-render-service 既有计费链路（经 withCreditLock 串行化）。
 * 余额不足在服务层预检阶段显式拒绝（需求 4.8），由 ApiError('INSUFFICIENT_CREDITS') 映射 402。
 *
 * 响应：
 * - 200: { variant, message }
 * - 400: 请求体/高级参数非法（VALIDATION_ERROR）
 * - 401: 未认证
 * - 403: 无权限
 * - 404: VideoVariant 不存在
 * - 402: 积分不足（INSUFFICIENT_CREDITS）
 * - 500: 服务器内部错误
 *
 * Requirements: 4.2, 4.6, 4.7, 4.8, 4.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { regenerateSingleVariant } from '@/lib/merchant/local-render-service'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ variantId: string }>
}

/**
 * 高级参数请求体校验 Schema（需求 4.6）。
 *
 * 仅校验形状（字段可选、类型正确）；具体取值合法性（风格/模板枚举、时长区间）由
 * local-render-service.resolveAdvancedParams 严格校验，非法取值显式抛 VALIDATION_ERROR（不静默回退）。
 */
const RegenerateRequestSchema = z
  .object({
    advancedParams: z
      .object({
        /** 渲染风格预设（PROMOTION/ATMOSPHERE/OWNER_TALKING 之一，服务层校验） */
        style: z.string().optional(),
        /** AI 补充片段目标时长（秒），服务层校验区间 */
        durationSec: z.number().optional(),
        /** 镜头编排模板（PROMOTION/ATMOSPHERE/OWNER_TALKING 之一，服务层校验） */
        templateId: z.string().optional(),
      })
      .optional(),
  })
  .optional()

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { variantId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 解析请求体（一键路径允许空 body：无 body 时按无高级参数处理）
    let body: unknown
    const rawBody = await request.text()
    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
          { status: 400 }
        )
      }
    }

    const parseResult = RegenerateRequestSchema.safeParse(body)
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

    const advancedParams = parseResult.data?.advancedParams

    // 查询 VideoVariant 并验证归属：variant → ContentBrief → Store → Merchant.userId
    const variant = await prisma.videoVariant.findUnique({
      where: { id: variantId },
      include: {
        contentBrief: {
          include: {
            store: {
              include: { merchant: { select: { userId: true } } },
            },
          },
        },
      },
    })

    if (!variant) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '视频版本不存在' } },
        { status: 404 }
      )
    }

    if (variant.contentBrief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权重新生成该视频版本' } },
        { status: 403 }
      )
    }

    // 调用服务：内部含分布式锁 + 余额预检 + reserve→charge/refund + 高级参数校验与标注
    const updated = await regenerateSingleVariant({
      videoVariantId: variantId,
      userId,
      advancedParams,
    })

    return NextResponse.json({
      variant: updated,
      message: '已重新生成该版本，其它版本保持不变',
    })
  } catch (error) {
    // 服务层抛出的 ApiError 按其状态码映射：INSUFFICIENT_CREDITS→402、VALIDATION_ERROR→400 等
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/video-variants/[variantId]/regenerate] 未知错误:', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : '服务器内部错误',
        },
      },
      { status: 500 }
    )
  }
}
