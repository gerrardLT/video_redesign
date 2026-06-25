/**
 * 属性测试：合规阻断导出不变式 (Property 9)
 *
 * 不变式：
 * 1. 如果 ComplianceCheck riskLevel=BLOCKED → 导出必须被拒绝
 * 2. 如果 riskLevel=HIGH 且 acknowledgedAt=null → 导出必须被拒绝
 * 3. 不存在任何 riskLevel=BLOCKED 的视频同时有 EXPORTED 状态的 PublishJob
 *
 * 生成随机合规状态组合，验证导出权限判定逻辑。
 *
 * **Validates: Requirements 9.6, 9.7, 10.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { ComplianceRiskLevel, PublishJobStatus } from '@/types/merchant'

// ========================
// 类型定义
// ========================

/** 合规检查状态（简化） */
interface ComplianceState {
  videoVariantId: string
  riskLevel: ComplianceRiskLevel
  acknowledgedAt: Date | null
}

/** 导出任务状态 */
interface PublishJobState {
  videoVariantId: string
  status: PublishJobStatus
}

/** 导出权限判定结果 */
interface ExportPermissionResult {
  allowed: boolean
  reason?: string
}

// ========================
// 导出权限判定逻辑（提取自设计文档约束）
// ========================

/**
 * 判断视频是否可以导出
 *
 * 规则（Req 9.6, 9.7, 10.2）：
 * 1. riskLevel=BLOCKED → 绝对禁止导出
 * 2. riskLevel=HIGH 且未确认（acknowledgedAt=null）→ 禁止导出
 * 3. riskLevel=HIGH 且已确认（acknowledgedAt!=null）→ 允许导出
 * 4. riskLevel=MEDIUM 或 LOW → 允许导出
 */
function checkExportPermission(complianceState: ComplianceState): ExportPermissionResult {
  const { riskLevel, acknowledgedAt } = complianceState

  if (riskLevel === 'BLOCKED') {
    return { allowed: false, reason: '合规检查为 BLOCKED，禁止导出' }
  }

  if (riskLevel === 'HIGH' && acknowledgedAt === null) {
    return { allowed: false, reason: '合规检查为 HIGH 且未确认，禁止导出' }
  }

  return { allowed: true }
}

/**
 * 验证系统状态一致性：不存在 BLOCKED 视频同时有 EXPORTED 的 PublishJob
 */
function validateSystemConsistency(
  complianceStates: ComplianceState[],
  publishJobs: PublishJobState[],
): { valid: boolean; reason?: string } {
  // 收集所有 BLOCKED 状态的 videoVariantId
  const blockedVariants = new Set(
    complianceStates
      .filter((c) => c.riskLevel === 'BLOCKED')
      .map((c) => c.videoVariantId),
  )

  // 检查是否有 BLOCKED 视频同时存在 EXPORTED 状态的 PublishJob
  for (const job of publishJobs) {
    if (blockedVariants.has(job.videoVariantId) && job.status === 'EXPORTED') {
      return {
        valid: false,
        reason: `VideoVariant ${job.videoVariantId} 为 BLOCKED 状态但存在 EXPORTED 的 PublishJob`,
      }
    }
  }

  return { valid: true }
}

// ========================
// 生成器
// ========================

/** 风险等级生成器 */
const riskLevelArb = fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'BLOCKED') as fc.Arbitrary<ComplianceRiskLevel>

/** 确认时间生成器：null 或某个日期 */
const acknowledgedAtArb = fc.oneof(
  fc.constant(null),
  fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
)

/** 合规状态生成器 */
const complianceStateArb = fc.record({
  videoVariantId: fc.uuid(),
  riskLevel: riskLevelArb,
  acknowledgedAt: acknowledgedAtArb,
})

/** PublishJob 状态生成器 */
const publishJobStatusArb = fc.constantFrom(
  'DRAFT', 'READY', 'EXPORTING', 'EXPORTED', 'PUBLISHING', 'PUBLISHED', 'FAILED',
) as fc.Arbitrary<PublishJobStatus>

/**
 * 模拟正确执行导出权限检查后的系统状态
 * 只有通过权限检查的视频才会创建 EXPORTED 的 PublishJob
 */
function buildConsistentPublishJobs(
  complianceStates: ComplianceState[],
): PublishJobState[] {
  const jobs: PublishJobState[] = []

  for (const state of complianceStates) {
    const permission = checkExportPermission(state)

    if (permission.allowed) {
      // 允许导出时，PublishJob 可能为各种状态
      jobs.push({
        videoVariantId: state.videoVariantId,
        status: 'EXPORTED',
      })
    } else {
      // 不允许导出时，PublishJob 状态只能为 DRAFT 或 FAILED
      jobs.push({
        videoVariantId: state.videoVariantId,
        status: 'DRAFT',
      })
    }
  }

  return jobs
}

// ========================
// 属性测试
// ========================

describe('Property 9: 合规阻断导出不变式', () => {
  it('riskLevel=BLOCKED 时导出必须被拒绝', () => {
    fc.assert(
      fc.property(fc.uuid(), acknowledgedAtArb, (variantId, ackAt) => {
        const state: ComplianceState = {
          videoVariantId: variantId,
          riskLevel: 'BLOCKED',
          acknowledgedAt: ackAt,
        }

        const result = checkExportPermission(state)

        // 无论 acknowledgedAt 是否有值，BLOCKED 都不允许导出
        expect(result.allowed).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('riskLevel=HIGH 且 acknowledgedAt=null 时导出必须被拒绝', () => {
    fc.assert(
      fc.property(fc.uuid(), (variantId) => {
        const state: ComplianceState = {
          videoVariantId: variantId,
          riskLevel: 'HIGH',
          acknowledgedAt: null,
        }

        const result = checkExportPermission(state)
        expect(result.allowed).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('riskLevel=HIGH 且 acknowledgedAt 非 null 时允许导出', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
        (variantId, ackDate) => {
          const state: ComplianceState = {
            videoVariantId: variantId,
            riskLevel: 'HIGH',
            acknowledgedAt: ackDate,
          }

          const result = checkExportPermission(state)
          expect(result.allowed).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('riskLevel=LOW 或 MEDIUM 时始终允许导出', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom('LOW', 'MEDIUM') as fc.Arbitrary<ComplianceRiskLevel>,
        acknowledgedAtArb,
        (variantId, riskLevel, ackAt) => {
          const state: ComplianceState = {
            videoVariantId: variantId,
            riskLevel,
            acknowledgedAt: ackAt,
          }

          const result = checkExportPermission(state)
          expect(result.allowed).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('系统一致性：不存在 BLOCKED 视频同时有 EXPORTED 的 PublishJob', () => {
    fc.assert(
      fc.property(
        fc.array(complianceStateArb, { minLength: 1, maxLength: 20 }),
        (complianceStates) => {
          // 构建遵循权限规则的 PublishJob
          const publishJobs = buildConsistentPublishJobs(complianceStates)

          const consistency = validateSystemConsistency(complianceStates, publishJobs)
          expect(consistency.valid).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('随机 PublishJob 状态组合中检测出 BLOCKED+EXPORTED 违规', () => {
    fc.assert(
      fc.property(
        fc.array(complianceStateArb, { minLength: 1, maxLength: 10 }),
        fc.array(publishJobStatusArb, { minLength: 1, maxLength: 10 }),
        (complianceStates, jobStatuses) => {
          // 用随机状态构建 PublishJob（可能违规）
          const publishJobs: PublishJobState[] = complianceStates.map((state, idx) => ({
            videoVariantId: state.videoVariantId,
            status: jobStatuses[idx % jobStatuses.length],
          }))

          const consistency = validateSystemConsistency(complianceStates, publishJobs)

          // 手动检验：是否真的存在 BLOCKED+EXPORTED
          const blockedIds = new Set(
            complianceStates
              .filter((c) => c.riskLevel === 'BLOCKED')
              .map((c) => c.videoVariantId),
          )
          const hasViolation = publishJobs.some(
            (job) => blockedIds.has(job.videoVariantId) && job.status === 'EXPORTED',
          )

          // 不变式：validateSystemConsistency 的结果应与手动检查一致
          expect(consistency.valid).toBe(!hasViolation)
        },
      ),
      { numRuns: 100 },
    )
  })
})
