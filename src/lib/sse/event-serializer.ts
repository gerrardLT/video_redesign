/**
 * SSE Event Serializer — 事件序列化器
 *
 * 将 ProgressEventPayload 序列化为 SSE 规范格式的字符串。
 * 支持普通事件、心跳、重试指令和快照事件的序列化。
 *
 * SSE 消息格式规范：
 * - event: {taskType}
 * - id: {eventId}
 * - data: {JSON string}
 * - 每条消息以 \n\n 结尾
 */

import type { ProgressEventPayload, TaskType } from './types'

/**
 * 将 ProgressEventPayload 序列化为 SSE 格式字符串
 *
 * 输出格式：
 * ```
 * event: {taskType}
 * id: {eventId}
 * data: {JSON}
 *
 * ```
 *
 * @param event - 进度事件负载
 * @param eventId - 递增事件 ID，用于客户端 Last-Event-ID 重连追踪
 * @returns SSE 格式字符串
 */
export function serialize(event: ProgressEventPayload, eventId: number): string {
  const data = JSON.stringify(event)
  return `event: ${event.taskType}\nid: ${eventId}\ndata: ${data}\n\n`
}

/**
 * 序列化心跳消息
 *
 * 输出格式：`:ping\n\n`
 * SSE 规范中以冒号开头的行为注释行，客户端会忽略，但可维持连接活性。
 *
 * @returns 心跳 SSE 注释字符串
 */
export function serializeHeartbeat(): string {
  return `:ping\n\n`
}

/**
 * 序列化重试指令
 *
 * 输出格式：`retry: {ms}\n\n`
 * 指示客户端在连接断开后等待指定毫秒数再自动重连。
 *
 * @param ms - 重试间隔（毫秒）
 * @returns SSE retry 指令字符串
 */
export function serializeRetry(ms: number): string {
  return `retry: ${ms}\n\n`
}

/**
 * 序列化快照事件
 *
 * 输出格式：
 * ```
 * event: snapshot
 * id: {eventId}
 * data: {JSON array}
 *
 * ```
 *
 * 用于客户端重连时发送当前所有活跃任务的全量状态。
 *
 * @param tasks - 当前活跃任务的进度事件数组
 * @param eventId - 递增事件 ID
 * @returns SSE 快照事件字符串
 */
export function serializeSnapshot(tasks: ProgressEventPayload[], eventId: number): string {
  const data = JSON.stringify(tasks)
  return `event: snapshot\nid: ${eventId}\ndata: ${data}\n\n`
}

/**
 * 构建 Redis Pub/Sub 频道名称
 *
 * 格式：`progress:{userId}:{taskType}:{taskId}`
 *
 * @param userId - 用户 ID
 * @param taskType - 任务类型
 * @param taskId - 任务 ID
 * @returns Redis Pub/Sub 频道名称
 */
export function buildChannel(userId: string, taskType: TaskType, taskId: string): string {
  return `progress:${userId}:${taskType}:${taskId}`
}
