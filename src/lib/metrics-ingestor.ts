/**
 * 数据录入服务 — 发布数据指标手动录入
 *
 * 职责：
 * 1. 验证 contentBriefId 存在且 status 已过 EXPORTED
 * 2. 验证当前 contentBrief 的 metrics 条目数未超过 50
 * 3. 创建 PublishMetric 记录
 * 4. 异步触发表现学习分析（5 秒内）
 *
 * Requirements: 11.1-11.7
 */

import { prisma } from '@/lib/db'
import { MetricsInputSchema } from '@/lib/validations/merchant'
import type { PublishPlatform } from '@/types/merchant'
import type { PublishMetric } from '@/generated/prisma'

// ========================
// 常量定义
// ========================

/** 每个 ContentBrief 最多允许的 metrics 条目数 (Req 11.7) */
const MAX_METRICS_PER_BRIEF = 50

/**
 * 已过 EXPORTED 的状态集合（含 EXPORTED 自身）
 * ContentBrief 必须处于这些状态之一才允许录入数据 (Req 11.4)
 */
const ELIGIBLE_STATUSES = new Set([
  'EXPORTED',
  'PUBLISHED',
  'ARCHIVED',
])

// ========================
// 错误类型
// ========================

/** 验证错误 — 包含具体字段错误信息 */
export class MetricsValidationError extends Error {
  public readonly fieldErrors: Record<string, string[]>

  constructor(fieldErrors: Record<string, string[]>) {
    const fields = Object.keys(fieldErrors).join(', ')
    super(`数据录入验证失败: ${fields}`)
    this.name = 'MetricsValidationError'
    this.fieldErrors = fieldErrors
  }
}

/** 业务逻辑错误 — ContentBrief 不符合录入条件 */
export class MetricsBusinessError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MetricsBusinessError'
    this.code = code
  }
}

// ========================
// 主函数
// ========================

/**
 * 录入发布数据指标
 *
 * @param input.contentBriefId - 目标内容任务 ID
 * @param input.platform - 发布平台
 * @param input.metrics - 各项数据指标
 * @param input.userId - 操作用户 ID（用于权限校验预留）
 * @returns 创建的 PublishMetric 记录
 * @throws MetricsValidationError 验证失败时抛出，包含具体字段错误
 * @throws MetricsBusinessError 业务规则不满足时抛出
 */
export async function recordManualMetrics(input: {
  contentBriefId: string
  platform: PublishPlatform
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
    linkClicks: number
    messages: number
    orders: number
    redemptions: number
    revenueCents: number
  }
  userId: string
}): Promise<PublishMetric> {
  const { contentBriefId, platform, metrics, userId } = input

  // ─── Step 1: 验证 metrics 字段 (Req 11.2, 11.3) ───
  const validationPayload = {
    platform,
    ...metrics,
  }
  const parseResult = MetricsInputSchema.safeParse(validationPayload)

  if (!parseResult.success) {
    // 将 Zod 错误格式化为字段 → 错误消息映射
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parseResult.error.issues) {
      const fieldName = issue.path.join('.') || 'unknown'
      if (!fieldErrors[fieldName]) {
        fieldErrors[fieldName] = []
      }
      fieldErrors[fieldName].push(issue.message)
    }
    throw new MetricsValidationError(fieldErrors)
  }

  // ─── Step 2: 验证 contentBriefId 存在且状态已过 EXPORTED (Req 11.4) ───
  const contentBrief = await prisma.contentBrief.findUnique({
    where: { id: contentBriefId },
    select: {
      id: true,
      status: true,
      _count: {
        select: { metrics: true },
      },
    },
  })

  if (!contentBrief) {
    throw new MetricsBusinessError(
      'CONTENT_BRIEF_NOT_FOUND',
      `ContentBrief "${contentBriefId}" 不存在`
    )
  }

  if (!ELIGIBLE_STATUSES.has(contentBrief.status)) {
    throw new MetricsBusinessError(
      'CONTENT_BRIEF_NOT_ELIGIBLE',
      `ContentBrief 当前状态为 "${contentBrief.status}"，仅 EXPORTED/PUBLISHED/ARCHIVED 状态允许录入数据`
    )
  }

  // ─── Step 3: 验证条目数上限 (Req 11.7) ───
  if (contentBrief._count.metrics >= MAX_METRICS_PER_BRIEF) {
    throw new MetricsBusinessError(
      'METRICS_LIMIT_EXCEEDED',
      `ContentBrief "${contentBriefId}" 的数据录入已达上限 ${MAX_METRICS_PER_BRIEF} 条`
    )
  }

  // ─── Step 4: 创建 PublishMetric 记录 (Req 11.1, 11.5) ───
  const publishMetric = await prisma.publishMetric.create({
    data: {
      contentBriefId,
      platform,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      linkClicks: metrics.linkClicks,
      messages: metrics.messages,
      orders: metrics.orders,
      redemptions: metrics.redemptions,
      revenueCents: metrics.revenueCents,
      source: 'MANUAL',
      capturedAt: new Date(), // 提交时间戳
    },
  })

  // ─── Step 5: 异步触发表现学习分析（Req 11.6） ───
  // performance-learning 是纯 DB 查询+计算（无外部 API），直接 await 调用
  // 使用 setImmediate 风格的非阻塞调用 + try/catch 记录错误，不影响录入响应
  triggerPerformanceLearning(contentBriefId)

  return publishMetric
}

// ========================
// 内部辅助函数
// ========================

/**
 * 异步触发表现学习分析
 *
 * performance-learning-service 是纯 DB 查询+规则计算（无外部 API 调用），
 * 延迟可接受，直接使用 void async 调用（不阻塞返回但在同一事件循环中执行）。
 * 错误不向上层传播（不影响录入结果），但会记录日志。
 */
function triggerPerformanceLearning(contentBriefId: string): void {
  void (async () => {
    try {
      const { generatePerformanceInsights } = await import('@/lib/performance-learning-service')

      // 获取 storeId
      const brief = await prisma.contentBrief.findUnique({
        where: { id: contentBriefId },
        select: { storeId: true },
      })

      if (brief) {
        await generatePerformanceInsights({
          storeId: brief.storeId,
          contentBriefId,
        })
      }
    } catch (error) {
      // 学习分析失败不影响数据录入结果，仅记录错误
      console.error(
        `[metrics-ingestor] 表现学习分析触发失败 contentBriefId=${contentBriefId}:`,
        error instanceof Error ? error.message : error
      )
    }
  })()
}
