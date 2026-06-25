/**
 * POST /api/content-briefs/[briefId]/compliance/acknowledge — 确认 HIGH 风险
 *
 * 当合规检查结果为 HIGH 风险时，用户需通过此接口明确确认风险，
 * 系统记录 acknowledgedAt 时间戳后允许导出。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 请求体：
 * - complianceCheckId: string (合规检查记录 ID)
 *
 * 响应：
 * - 200: { check: ComplianceCheck, message: string }
 * - 400: 参数缺失 / 该检查不需要确认
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 或 ComplianceCheck 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 9.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 ContentBrief 并验证归属
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
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 解析请求体
    let body: { complianceCheckId?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }

    const { complianceCheckId } = body
    if (!complianceCheckId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少 complianceCheckId 字段' } },
        { status: 400 }
      )
    }

    // 查询 ComplianceCheck 并验证归属
    const check = await prisma.complianceCheck.findUnique({
      where: { id: complianceCheckId },
    })

    if (!check || check.contentBriefId !== briefId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '合规检查记录不存在或不属于该 ContentBrief' } },
        { status: 404 }
      )
    }

    // 仅 HIGH 风险等级允许确认（BLOCKED 不允许，LOW/MEDIUM 无需确认）
    if (check.riskLevel !== 'HIGH') {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: check.riskLevel === 'BLOCKED'
              ? '该检查为 BLOCKED 等级，无法通过确认解除'
              : '该检查不需要确认（仅 HIGH 风险需要确认）',
          },
        },
        { status: 400 }
      )
    }

    // 已确认的不重复处理
    if (check.acknowledgedAt) {
      return NextResponse.json({
        check,
        message: '已确认过风险，无需重复操作',
      })
    }

    // 记录确认时间
    const updatedCheck = await prisma.complianceCheck.update({
      where: { id: complianceCheckId },
      data: { acknowledgedAt: new Date() },
    })

    return NextResponse.json({
      check: updatedCheck,
      message: '已确认风险，现在可以导出视频',
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[POST /api/content-briefs/[briefId]/compliance/acknowledge] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
