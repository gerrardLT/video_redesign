/**
 * 并发控制常量定义
 * 基于用户等级（FREE/MONTHLY/YEARLY）的并发额度、队列优先级配置
 *
 * 并发限制含义：用户能同时对多少个不同项目发起该类型任务
 * - generate 并发 = 用户能同时对多少个不同项目发起生成任务
 * - 单个项目内的分镜组始终走链式串行（尾帧衔接需要前一组完成后才能拿到尾帧给下一组）
 */

/** 任务类型：解析、生成、合并 */
export type TaskType = 'parse' | 'generate' | 'merge'

/** 用户等级：免费、月卡、年卡 */
export type UserTier = 'FREE' | 'MONTHLY' | 'YEARLY'

/** 并发配置接口 */
export interface ConcurrencyConfig {
  /** 解析并发限制（用户可同时解析多少个项目） */
  parse: number
  /** 生成并发限制（用户可同时对多少个项目发起生成） */
  generate: number
  /** 合并并发限制（用户可同时合并多少个项目） */
  merge: number
}

/**
 * 各等级并发额度映射（项目级并发）
 * - FREE: 每种任务类型最多 1 个项目并发
 * - MONTHLY: 解析 2、生成 2、合并 1 个项目并发
 * - YEARLY: 解析 5、生成 5、合并 2 个项目并发
 */
export const CONCURRENCY_LIMITS: Record<UserTier, ConcurrencyConfig> = {
  FREE: { parse: 1, generate: 1, merge: 1 },
  MONTHLY: { parse: 2, generate: 2, merge: 1 },
  YEARLY: { parse: 5, generate: 5, merge: 2 },
} as const

/**
 * 各等级队列优先级映射
 * BullMQ priority 数值越小优先级越高
 * - YEARLY: 1（最高优先级）
 * - MONTHLY: 3
 * - FREE: 5（最低优先级）
 */
export const QUEUE_PRIORITIES: Record<UserTier, number> = {
  FREE: 5,
  MONTHLY: 3,
  YEARLY: 1,
} as const
