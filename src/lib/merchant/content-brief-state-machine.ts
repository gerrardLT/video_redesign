/**
 * ContentBrief 状态机
 * 定义 ContentBrief 的合法状态转换，与 state-machine.ts（GenerationJob）互补。
 *
 * 真实流程：
 *   DRAFT → READY_TO_SHOOT（计划生成时直接创建）
 *   DRAFT → RENDERING（AUTO 模式一键出片，跳过拍摄和上传）
 *   READY_TO_SHOOT → MATERIALS_UPLOADED（素材上传完成）
 *   READY_TO_SHOOT → RENDERING（AUTO 模式一键出片，跳过上传）
 *   MATERIALS_UPLOADED → RENDERING（触发渲染）
 *   RENDERING → GENERATED（渲染成功）
 *   RENDERING → FAILED（渲染失败）
 *   GENERATED → COMPLIANCE_REVIEW（合规检查 HIGH/BLOCKED）
 *   GENERATED → READY_TO_EXPORT（合规检查 LOW/MEDIUM）
 *   COMPLIANCE_REVIEW → READY_TO_EXPORT（用户确认/一键改写通过）
 *   READY_TO_EXPORT → EXPORTED（导出成功）
 *   EXPORTED → PUBLISHED（标记发布）
 *   PUBLISHED → ARCHIVED（归档）
 *   EXPORTED → ARCHIVED（归档）
 *   FAILED → MATERIALS_UPLOADED（重试渲染，回退到素材就绪状态）
 *   FAILED → READY_TO_SHOOT（重试渲染，回退到待拍摄状态）
 *
 * 注：本状态机仅约束 ContentBrief 状态空间，与 GenerationJob 状态机（state-machine.ts）
 * 和项目状态（Project.status）为不同状态空间，互不混用。
 */

import type { ContentBriefStatus } from '@/generated/prisma'

// 合法状态转换映射
const VALID_BRIEF_TRANSITIONS: Record<ContentBriefStatus, ContentBriefStatus[]> = {
  DRAFT: ['READY_TO_SHOOT', 'RENDERING'],
  READY_TO_SHOOT: ['MATERIALS_UPLOADED', 'RENDERING'],
  MATERIALS_UPLOADED: ['RENDERING'],
  RENDERING: ['GENERATED', 'FAILED'],
  GENERATED: ['COMPLIANCE_REVIEW', 'READY_TO_EXPORT'],
  COMPLIANCE_REVIEW: ['READY_TO_EXPORT', 'MATERIALS_UPLOADED'],
  READY_TO_EXPORT: ['EXPORTED', 'ARCHIVED'],
  EXPORTED: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  FAILED: ['MATERIALS_UPLOADED', 'READY_TO_SHOOT'],
  ARCHIVED: [],
}

/**
 * 检查 ContentBrief 状态转换是否合法
 */
export function canBriefTransition(from: ContentBriefStatus | string, to: ContentBriefStatus | string): boolean {
  const allowed = VALID_BRIEF_TRANSITIONS[from as ContentBriefStatus]
  if (!allowed) return false
  return allowed.includes(to as ContentBriefStatus)
}

/**
 * 强制校验 ContentBrief 状态转换：非法转换抛错。
 *
 * @throws 当 from→to 非法时抛出错误
 */
export function assertBriefTransition(from: ContentBriefStatus | string, to: ContentBriefStatus | string): void {
  if (!canBriefTransition(from, to)) {
    throw new Error(`ContentBrief 非法状态转换：${from} → ${to}`)
  }
}

/**
 * 检查 ContentBrief 是否可重试渲染
 * 仅 FAILED 状态可重试，回退到 MATERIALS_UPLOADED 或 READY_TO_SHOOT
 */
export function canRetryRender(status: ContentBriefStatus | string): boolean {
  return status === 'FAILED'
}

/**
 * 获取 ContentBrief 所有合法的下一状态
 */
export function getNextBriefStates(status: ContentBriefStatus | string): ContentBriefStatus[] {
  return VALID_BRIEF_TRANSITIONS[status as ContentBriefStatus] ?? []
}

/**
 * ContentBrief 终态（不可再转换）
 */
export const BRIEF_TERMINAL_STATES: ContentBriefStatus[] = ['ARCHIVED']

/**
 * 判断 ContentBrief 状态是否为终态
 */
export function isBriefTerminalState(status: ContentBriefStatus | string): boolean {
  return BRIEF_TERMINAL_STATES.includes(status as ContentBriefStatus)
}
