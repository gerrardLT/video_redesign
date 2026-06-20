/**
 * 优先级调度器
 *
 * 根据用户等级在 BullMQ 入队时设置 priority 字段，
 * 决定任务被 Worker 消费的优先顺序。
 * 数值越小优先级越高：YEARLY=1, MONTHLY=3, FREE=5
 */

import { Queue, Job, type JobsOptions } from 'bullmq'
import { type UserTier, QUEUE_PRIORITIES } from '@/constants/concurrency'

/**
 * 根据用户等级返回 BullMQ job priority 值（纯函数）
 *
 * BullMQ priority 规则: 数值越小优先级越高
 * - YEARLY: 1（最高优先级）
 * - MONTHLY: 3
 * - FREE: 5（最低优先级）
 *
 * @param tier - 用户等级
 * @returns 队列优先级数值
 */
export function getQueuePriority(tier: UserTier): number {
  return QUEUE_PRIORITIES[tier]
}

/**
 * 带优先级的任务入队包装函数
 *
 * 在 queue.add() 时根据用户等级自动设置 opts.priority 字段。
 * additionalOpts 中的其他选项会被合并，但 priority 字段不能被覆盖
 * （始终由 tier 决定，防止外部绕过优先级规则）。
 *
 * @param queue - BullMQ 队列实例
 * @param jobName - 任务名称
 * @param data - 任务数据
 * @param tier - 用户等级（决定 priority 值）
 * @param additionalOpts - 额外的 BullMQ JobsOptions（priority 字段会被忽略）
 * @returns 入队后的 Job 实例
 */
export async function scheduleWithPriority(
  queue: Queue,
  jobName: string,
  data: Record<string, unknown>,
  tier: UserTier,
  additionalOpts?: Partial<JobsOptions>
): Promise<Job> {
  // 计算优先级
  const priority = getQueuePriority(tier)

  // 合并选项，priority 始终由 tier 决定，不允许外部覆盖
  const opts: JobsOptions = {
    ...additionalOpts,
    priority,
  }

  return queue.add(jobName, data, opts)
}
