/**
 * 进度事件发布器 (Worker 侧)
 *
 * 通过 Redis Pub/Sub 发布进度事件到 API 进程，由 API 进程经 SSE 推送给客户端。
 * 使用 fire-and-forget 模式：发布失败仅记录 warn 日志，不抛出异常，不阻塞任务执行流程。
 * 进度推送是"尽力而为"（best-effort），最终一致性由客户端轮询兜底。
 */

import { redis } from './redis'
import { buildChannel } from './sse/event-serializer'
import { logger } from './logger'
import type { ProgressEventPayload, TaskType, ChainMetadata } from './sse/types'

/**
 * 核心发布方法：将进度事件发布到 Redis Pub/Sub
 *
 * @param userId - 目标用户 ID
 * @param taskType - 任务类型 (generation | parse | character | merge | chain)
 * @param taskId - 任务/项目 ID
 * @param event - 进度事件负载
 */
export async function publish(
  userId: string,
  taskType: TaskType,
  taskId: string,
  event: ProgressEventPayload
): Promise<void> {
  try {
    const channel = buildChannel(userId, taskType, taskId)
    const json = JSON.stringify(event)
    await redis.publish(channel, json)
  } catch (error) {
    logger.warn('进度事件发布失败', {
      userId,
      taskType,
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 发布任务状态变更事件
 *
 * @param userId - 目标用户 ID
 * @param taskType - 任务类型
 * @param taskId - 任务 ID
 * @param stage - 当前阶段描述 (如 QUEUED, SUBMITTED, GENERATING)
 * @param progress - 可选，进度百分比 (0-100)
 * @param eta - 可选，预估剩余时间（秒）
 */
export async function publishStateChange(
  userId: string,
  taskType: TaskType,
  taskId: string,
  stage: string,
  progress?: number,
  eta?: number
): Promise<void> {
  const event: ProgressEventPayload = {
    taskId,
    taskType,
    eventType: 'state_change',
    timestamp: new Date().toISOString(),
    stage,
    ...(progress !== undefined ? { progress } : {}),
    ...(eta !== undefined ? { estimatedRemainingSeconds: eta } : {}),
  }
  await publish(userId, taskType, taskId, event)
}

/**
 * 发布任务完成事件
 *
 * @param userId - 目标用户 ID
 * @param taskType - 任务类型
 * @param taskId - 任务 ID
 */
export async function publishCompleted(
  userId: string,
  taskType: TaskType,
  taskId: string
): Promise<void> {
  const event: ProgressEventPayload = {
    taskId,
    taskType,
    eventType: 'completed',
    timestamp: new Date().toISOString(),
    progress: 100,
  }
  await publish(userId, taskType, taskId, event)
}

/**
 * 发布任务失败事件
 *
 * @param userId - 目标用户 ID
 * @param taskType - 任务类型
 * @param taskId - 任务 ID
 * @param reason - 可选，失败原因描述
 */
export async function publishFailed(
  userId: string,
  taskType: TaskType,
  taskId: string,
  reason?: string
): Promise<void> {
  const event: ProgressEventPayload = {
    taskId,
    taskType,
    eventType: 'failed',
    timestamp: new Date().toISOString(),
    ...(reason ? { metadata: { reason } } : {}),
  }
  await publish(userId, taskType, taskId, event)
}

/**
 * 发布链式生成整体进度事件
 *
 * 当 completedGroups >= totalGroups 时自动标记为 completed 事件。
 * progress 按已完成组数/总组数计算百分比。
 *
 * @param userId - 目标用户 ID
 * @param projectId - 项目 ID（作为 taskId）
 * @param chainMetadata - 链式生成元数据 (totalGroups, currentGroup, completedGroups 等)
 */
export async function publishChainProgress(
  userId: string,
  projectId: string,
  chainMetadata: ChainMetadata
): Promise<void> {
  const isCompleted = chainMetadata.completedGroups >= chainMetadata.totalGroups
  const event: ProgressEventPayload = {
    taskId: projectId,
    taskType: 'chain',
    eventType: isCompleted ? 'completed' : 'progress_update',
    timestamp: new Date().toISOString(),
    progress: Math.round(
      (chainMetadata.completedGroups / chainMetadata.totalGroups) * 100
    ),
    metadata: chainMetadata as unknown as Record<string, unknown>,
  }
  await publish(userId, 'chain', projectId, event)
}
