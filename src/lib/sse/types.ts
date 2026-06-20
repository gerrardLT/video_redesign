/**
 * SSE 实时进度推送 — 核心类型定义
 *
 * 定义了进度事件的数据结构、任务类型枚举和连接注册表条目类型。
 * 本模块作为所有 SSE 相关模块的共享类型依赖。
 */

/** 任务类型枚举 */
export type TaskType = 'generation' | 'parse' | 'character' | 'merge' | 'chain'

/** 进度事件负载 */
export interface ProgressEventPayload {
  /** 任务唯一标识 */
  taskId: string
  /** 任务类型 */
  taskType: TaskType
  /** 事件类型 (state_change | progress_update | completed | failed | chain_group_failed) */
  eventType: string
  /** 时间戳 (ISO 8601) */
  timestamp: string
  /** 进度百分比 (0-100) */
  progress?: number
  /** 预估剩余时间（秒） */
  estimatedRemainingSeconds?: number
  /** 当前阶段描述 */
  stage?: string
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
}

/** 链式生成扩展元数据 */
export interface ChainMetadata {
  /** 总组数 M */
  totalGroups: number
  /** 当前组序号 (1-based) */
  currentGroup: number
  /** 已完成组数 */
  completedGroups: number
  /** 当前组的 GenerationJob 状态 */
  currentJobStatus?: string
}

/** 连接注册表条目 */
export interface ConnectionEntry {
  /** 唯一连接标识 (UUID) */
  connectionId: string
  /** 流控制器 */
  controller: ReadableStreamDefaultController
  /** 连接创建时间戳 (ms) */
  createdAt: number
  /** 最后活跃时间戳 (ms) */
  lastActiveAt: number
  /** 事件计数器（用于生成递增 id） */
  eventCounter: number
}
