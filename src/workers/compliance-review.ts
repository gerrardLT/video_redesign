/**
 * 合规检查 Worker
 * 处理 `compliance-review` BullMQ 队列任务
 *
 * 流程：
 * 1. 从 job.data 获取 { contentBriefId, videoVariantId }
 * 2. 调用 runComplianceCheck 执行合规检查
 * 3. 根据检查结果更新 ContentBrief 状态：
 *    - riskLevel = LOW → status = READY_TO_EXPORT
 *    - riskLevel = MEDIUM → status = READY_TO_EXPORT（允许导出，带警告）
 *    - riskLevel = HIGH → status = COMPLIANCE_REVIEW（需用户确认）
 *    - riskLevel = BLOCKED → status = COMPLIANCE_REVIEW（阻断导出）
 * 4. 错误不静默，抛出让 BullMQ 重试
 *
 * Requirements: 9.1, 9.10
 */

import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { runComplianceCheck } from '@/lib/merchant/compliance-service'
import { logger } from '@/lib/shared/logger'
import { assertBriefTransition } from '@/lib/merchant/content-brief-state-machine'
import type { ContentBriefStatus } from '@/generated/prisma'

// ============ 类型定义 ============

export interface ComplianceReviewJobData {
  /** 内容任务 ID */
  contentBriefId: string
  /** 视频版本 ID */
  videoVariantId: string
}

// ============ 风险等级 → ContentBrief 状态映射 ============

/**
 * 根据合规检查风险等级决定 ContentBrief 的目标状态
 * - LOW/MEDIUM: 允许导出 → READY_TO_EXPORT
 * - HIGH/BLOCKED: 需用户确认 → COMPLIANCE_REVIEW
 */
function resolveContentBriefStatus(riskLevel: string): ContentBriefStatus {
  switch (riskLevel) {
    case 'LOW':
    case 'MEDIUM':
      return 'READY_TO_EXPORT'
    case 'HIGH':
    case 'BLOCKED':
      return 'COMPLIANCE_REVIEW'
    default:
      // 未知风险等级走保守路径，需用户确认
      return 'COMPLIANCE_REVIEW'
  }
}

// ============ Worker 处理逻辑 ============

async function processComplianceReview(job: Job<ComplianceReviewJobData>): Promise<void> {
  const { contentBriefId, videoVariantId } = job.data

  logger.info('[compliance-review] 开始合规检查', {
    jobId: job.id,
    contentBriefId,
    videoVariantId,
    attempt: job.attemptsMade + 1,
  })

  // 执行合规检查（内部会保存 ComplianceCheck 记录到数据库）
  const complianceCheck = await runComplianceCheck({ contentBriefId, videoVariantId })

  // 根据检查结果更新 ContentBrief 状态（带状态机守卫）
  const targetStatus = resolveContentBriefStatus(complianceCheck.riskLevel)

  // 读取当前状态，校验转换合法性；仅 GENERATED 状态可被合规 Worker 转换，
  // 避免覆盖用户手动设置的状态（如 ARCHIVED）
  const currentBrief = await prisma.contentBrief.findUnique({
    where: { id: contentBriefId },
    select: { status: true },
  })

  if (!currentBrief) {
    throw new Error(`[compliance-review] ContentBrief 不存在: ${contentBriefId}`)
  }

  if (currentBrief.status !== 'GENERATED') {
    logger.warn('[compliance-review] ContentBrief 状态非 GENERATED，跳过状态更新', {
      contentBriefId,
      currentStatus: currentBrief.status,
      targetStatus,
    })
  } else {
    assertBriefTransition(currentBrief.status as ContentBriefStatus, targetStatus)
    await prisma.contentBrief.update({
      where: { id: contentBriefId },
      data: { status: targetStatus },
    })
  }

  logger.info('[compliance-review] 合规检查完成', {
    jobId: job.id,
    contentBriefId,
    videoVariantId,
    riskLevel: complianceCheck.riskLevel,
    passed: complianceCheck.passed,
    issueCount: complianceCheck.issues.length,
    targetStatus,
  })
}

// ============ 创建 Worker 实例 ============

const connection = redis as unknown as ConnectionOptions

export const complianceReviewWorker = new Worker<ComplianceReviewJobData>(
  'compliance-review',
  processComplianceReview,
  {
    connection,
    concurrency: 5, // design.md 定义并发数
  },
)

complianceReviewWorker.on('completed', (job) => {
  logger.info(`[compliance-review] Job ${job.id} 完成`, {
    contentBriefId: job.data.contentBriefId,
    videoVariantId: job.data.videoVariantId,
  })
})

complianceReviewWorker.on('failed', (job, err) => {
  logger.error(`[compliance-review] Job ${job?.id} 失败`, {
    error: err.message,
    contentBriefId: job?.data?.contentBriefId,
    videoVariantId: job?.data?.videoVariantId,
  })
})

export default complianceReviewWorker
export { processComplianceReview }
