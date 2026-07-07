/**
 * POST /api/content-briefs/[briefId]/generate-copy — AI 文案生成
 *
 * 基于 brief 内容 + 门店画像 + 目标平台，生成适配的发布文案。
 * 自动通过敏感词检测。
 *
 * 请求体：
 * {
 *   platform: 'douyin_local' | 'xiaohongshu' | 'wechat_video' | 'universal',
 *   contentSummary?: string  // 可选，不传则自动从 brief + shotTasks 提取
 * }
 *
 * 不消耗积分。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { generateCopy, type CopyGenerationInput } from '@/lib/merchant/copy-generator'
import type { PlatformId } from '@/lib/merchant/platform-presets'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

const VALID_PLATFORMS = new Set<PlatformId>(['douyin_local', 'xiaohongshu', 'wechat_video', 'universal'])

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 解析请求体
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const platform = (body.platform as PlatformId) || 'douyin_local'
    const contentSummary = (body.contentSummary as string) || null

    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '无效的 platform 参数' } },
        { status: 400 }
      )
    }

    // 查询 brief + store 信息
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: { merchant: { select: { userId: true } } },
        },
        shotTasks: {
          orderBy: { order: 'asc' },
          select: { title: true, type: true },
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
        { error: { code: 'FORBIDDEN', message: '无权访问' } },
        { status: 403 }
      )
    }

    // 构建内容摘要
    const summary = contentSummary || buildContentSummary(brief)

    // 解析 store 字段（兼容 JSON 字符串和数组）
    const mainProducts = parseJsonArray(brief.store.mainProducts)
    const mainSellingPoints = parseJsonArray(brief.store.mainSellingPoints)

    // 调用 AI 生成
    const input: CopyGenerationInput = {
      contentSummary: summary,
      industry: brief.store.industry || '餐饮',
      storeName: brief.store.name,
      city: brief.store.city || undefined,
      mainProducts,
      mainSellingPoints,
      platform,
      brandTone: brief.store.brandTone || undefined,
    }

    const result = await generateCopy(input)

    return NextResponse.json(result)
  } catch (error) {
    console.error(`[POST /api/content-briefs/[briefId]/generate-copy]`, error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '文案生成失败，请重试' } },
      { status: 500 }
    )
  }
}

// ========================
// 辅助函数
// ========================

function buildContentSummary(brief: {
  title: string
  goal: string | null
  shotTasks: Array<{ title: string; type: string }>
}): string {
  const parts: string[] = [brief.title]
  if (brief.goal) {
    parts.push(`目标: ${brief.goal}`)
  }
  if (brief.shotTasks.length > 0) {
    const shotDesc = brief.shotTasks
      .map((s, i) => `${i + 1}. [${s.type}] ${s.title}`)
      .join('\n')
    parts.push(`分镜:\n${shotDesc}`)
  }
  return parts.join('\n')
}

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}
