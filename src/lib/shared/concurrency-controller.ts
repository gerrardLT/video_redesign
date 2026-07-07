/**
 * 并发控制器
 * 基于 Redis 原子计数器实现用户任务并发限制的入队前门控
 *
 * 核心逻辑：
 * - checkAndIncrement: 原子 check-and-increment（INCR → 检查是否超限 → 超限则回滚 DECR）
 * - decrement: 安全递减（不低于 0）
 * - getActiveTaskCountsFromDB: 从数据库查询真实活跃任务数（真相源）
 * - reconcile: 从 DB 重建单用户 Redis 计数器，修复计数漂移
 * - reconcileAll: 批量扫描所有有活跃任务的用户并逐一对账
 * - buildRejectionResponse: 构建并发超限拒绝响应（含升级提示）
 *
 * Redis key 模式: concurrency:{userId}:{taskType}
 */

import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { CONCURRENCY_LIMITS } from '@/constants/concurrency'
import type { TaskType, UserTier } from '@/constants/concurrency'

/** 并发检查结果 */
export interface ConcurrencyCheckResult {
  /** 是否允许入队 */
  allowed: boolean
  /** 当前活跃任务数 */
  currentCount: number
  /** 该类型的并发限制 */
  limit: number
}

/**
 * Lua 脚本：原子 check-and-increment
 * 1. INCR key（先递增）
 * 2. 如果递增后超限，回滚 DECR，返回 [0, 原始计数]（拒绝）
 * 3. 如果未超限，返回 [1, 新计数]（放行）
 *
 * 保证原子性，避免 check-then-act 竞态条件
 */
const CHECK_AND_INCREMENT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local current = redis.call('INCR', key)
if current > limit then
  redis.call('DECR', key)
  return {0, current - 1}
end
return {1, current}
`

/**
 * Lua 脚本：安全 decrement
 * 确保计数不低于 0，防止异常情况导致负数
 * 1. GET 当前值
 * 2. 如果大于 0 则 DECR
 * 3. 否则返回 0（不执行递减）
 */
const SAFE_DECREMENT_SCRIPT = `
local key = KEYS[1]
local current = tonumber(redis.call('GET', key) or '0')
if current > 0 then
  return redis.call('DECR', key)
end
return 0
`

/**
 * 构建 Redis 并发计数器 key
 * 格式: concurrency:{userId}:{taskType}
 */
export function buildConcurrencyKey(userId: string, taskType: TaskType): string {
  return `concurrency:${userId}:${taskType}`
}

/**
 * 原子检查并递增并发计数
 *
 * 使用 Redis Lua 脚本保证原子性：INCR → 检查是否超限 → 超限则回滚 DECR
 * - allowed=true 时计数已递增，用户可以入队
 * - allowed=false 时计数已回滚，用户被拒绝
 *
 * @param userId - 用户 ID
 * @param taskType - 任务类型（parse/generate/merge）
 * @param limit - 并发限制值
 * @returns 并发检查结果
 */
export async function checkAndIncrement(
  userId: string,
  taskType: TaskType,
  limit: number
): Promise<ConcurrencyCheckResult> {
  const key = buildConcurrencyKey(userId, taskType)

  // 执行 Lua 脚本，保证原子性
  const result = await redis.eval(
    CHECK_AND_INCREMENT_SCRIPT,
    1,
    key,
    limit.toString()
  ) as [number, number]

  const [allowed, currentCount] = result

  return {
    allowed: allowed === 1,
    currentCount,
    limit,
  }
}

/**
 * 安全递减并发计数
 *
 * 任务完成/失败/取消时调用，释放用户并发额度
 * 使用 Lua 脚本确保计数不低于 0，防止异常递减导致负数
 *
 * @param userId - 用户 ID
 * @param taskType - 任务类型（parse/generate/merge）
 */
export async function decrement(
  userId: string,
  taskType: TaskType
): Promise<void> {
  const key = buildConcurrencyKey(userId, taskType)

  await redis.eval(
    SAFE_DECREMENT_SCRIPT,
    1,
    key
  )
}


/** 并发超限拒绝响应体 */
export interface ConcurrencyRejectionResponse {
  /** 错误信息（简体中文） */
  error: string
  /** 错误代码 */
  code: 'CONCURRENCY_LIMIT_REACHED'
  /** 用户当前等级 */
  currentTier: UserTier
  /** 当前等级该任务类型的并发限制 */
  currentLimit: number
  /** 下一等级该任务类型的并发限制（Infinity 以 'unlimited' 表示） */
  nextTierLimit: number | 'unlimited'
  /** 升级提示信息 */
  upgradePrompt: {
    /** 下一可升级等级名称 */
    nextTier: string
    /** 升级后的收益描述（简体中文） */
    benefit: string
  }
}

/**
 * 等级升级路径映射
 * FREE → MONTHLY → YEARLY
 */
const TIER_UPGRADE_PATH: Record<UserTier, UserTier | null> = {
  FREE: 'MONTHLY',
  MONTHLY: 'YEARLY',
  YEARLY: null,
}

/**
 * 各等级升级提示的收益描述（简体中文）
 */
const UPGRADE_BENEFITS: Record<UserTier, string> = {
  FREE: '升级月卡会员，解锁更高并发额度和优先队列',
  MONTHLY: '升级年卡会员，享受更高并发额度和最高优先级',
  YEARLY: '', // YEARLY 为最高等级，不会出现升级场景
}

/**
 * 各等级显示名称（简体中文）
 */
const TIER_DISPLAY_NAMES: Record<UserTier, string> = {
  FREE: '免费用户',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}

/**
 * 构建并发超限拒绝响应
 *
 * 当用户活跃任务数达到等级上限时，生成包含升级引导信息的结构化响应。
 * 响应包含当前等级、限制值、下一等级限制值及升级提示。
 *
 * @param currentTier - 用户当前等级
 * @param taskType - 被拒绝的任务类型（parse/generate/merge）
 * @param currentLimit - 当前等级该任务类型的并发限制
 * @returns 结构化拒绝响应体
 */
export function buildRejectionResponse(
  currentTier: UserTier,
  taskType: TaskType,
  currentLimit: number
): ConcurrencyRejectionResponse {
  // 确定下一可升级等级
  const nextTier = TIER_UPGRADE_PATH[currentTier]

  // 查询下一等级的并发限制
  let nextTierLimit: number | 'unlimited'
  let nextTierDisplayName: string
  let benefit: string

  if (nextTier) {
    const nextLimit = CONCURRENCY_LIMITS[nextTier][taskType]
    nextTierLimit = isFinite(nextLimit) ? nextLimit : 'unlimited'
    nextTierDisplayName = TIER_DISPLAY_NAMES[nextTier]
    benefit = UPGRADE_BENEFITS[currentTier]
  } else {
    // YEARLY 是最高等级，理论上不应触发此分支（YEARLY 有最高限制）
    // 但为代码健壮性处理此情况
    nextTierLimit = 'unlimited'
    nextTierDisplayName = TIER_DISPLAY_NAMES[currentTier]
    benefit = '您已是最高等级会员'
  }

  return {
    error: '已达到当前等级的并发限制，请升级以获取更高额度',
    code: 'CONCURRENCY_LIMIT_REACHED',
    currentTier,
    currentLimit,
    nextTierLimit,
    upgradePrompt: {
      nextTier: nextTierDisplayName,
      benefit,
    },
  }
}

/**
 * 从数据库查询用户各类型活跃任务计数（真相源）
 *
 * 活跃状态定义：
 * - parse: Project.status IN ('DOWNLOADING', 'PARSING')
 * - generate: Project.status = 'GENERATING'（项目级并发，与 API 入口门控一致）
 * - merge: Project.exportStatus IN ('MERGING')
 *
 * @param userId - 用户 ID
 * @returns 各任务类型的活跃任务数量
 */
export async function getActiveTaskCountsFromDB(
  userId: string
): Promise<Record<TaskType, number>> {
  const [parseCount, generateCount, mergeCount] = await Promise.all([
    // parse: Project 状态为 DOWNLOADING 或 PARSING
    prisma.project.count({
      where: {
        userId,
        status: { in: ['DOWNLOADING', 'PARSING'] },
      },
    }),
    // generate: 正在生成中的项目数量
    prisma.project.count({
      where: {
        userId,
        status: 'GENERATING',
      },
    }),
    // merge: Project 导出状态为 MERGING
    prisma.project.count({
      where: {
        userId,
        exportStatus: { in: ['MERGING'] },
      },
    }),
  ])

  return {
    parse: parseCount,
    generate: generateCount,
    merge: mergeCount,
  }
}

/**
 * 对账：从数据库重建单用户的 Redis 并发计数器
 *
 * 修复 Worker 崩溃/Redis 重启导致的计数漂移：
 * 1. 从数据库查询用户各类型真实活跃任务数
 * 2. 对比 Redis 当前值
 * 3. 如有偏差，直接用 DB 值覆盖 Redis 计数器
 *
 * TODO: 当前 reconcile 非原子操作（先查 DB 再 SET Redis），理论上存在与新任务 INCR 的竞态窗口。
 * 实际影响较小（对账每 5 分钟跑一次 + SAFE_DECREMENT_SCRIPT 保证不会变负），但如果需要更严格的一致性，
 * 可改用 CAS（Compare-and-swap）逻辑：先 GET Redis 值，只在 Redis 值与上次读到的值一致时才 SET 更新。
 *
 * @param userId - 用户 ID
 */
export async function reconcile(userId: string): Promise<void> {
  // 从数据库获取真实活跃任务数
  const dbCounts = await getActiveTaskCountsFromDB(userId)

  const taskTypes: TaskType[] = ['parse', 'generate', 'merge']

  for (const taskType of taskTypes) {
    const key = buildConcurrencyKey(userId, taskType)
    const redisValue = await redis.get(key)
    const redisCount = parseInt(redisValue || '0', 10)
    const dbCount = dbCounts[taskType]

    if (redisCount !== dbCount) {
      // 存在偏差，用数据库真实值覆盖 Redis
      await redis.set(key, dbCount.toString())
      console.log(
        `[并发对账] 用户 ${userId} 任务类型 ${taskType} 计数修复: Redis=${redisCount} → DB=${dbCount}`
      )
    }
  }
}

/**
 * 批量对账：扫描所有有活跃任务的用户，逐一对账
 *
 * 查询数据库中所有拥有活跃任务（parse/generate/merge）的 distinct userId，
 * 对每个用户执行 reconcile 修复 Redis 计数。
 * 完成后输出对账摘要日志。
 */
export async function reconcileAll(): Promise<void> {
  // 并行查询所有有活跃任务的用户 ID（去重）
  const [parseUsers, generateUsers, mergeUsers] = await Promise.all([
    // 有活跃 parse 任务的用户
    prisma.project.findMany({
      where: { status: { in: ['DOWNLOADING', 'PARSING'] } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    // 有活跃 generate 任务的用户（基于项目 GENERATING 状态）
    prisma.project.findMany({
      where: { status: 'GENERATING' },
      select: { userId: true },
      distinct: ['userId'],
    }),
    // 有活跃 merge 任务的用户
    prisma.project.findMany({
      where: { exportStatus: { in: ['MERGING'] } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ])

  // 合并去重所有需要对账的用户 ID
  const userIdSet = new Set<string>()
  for (const row of parseUsers) userIdSet.add(row.userId)
  for (const row of generateUsers) userIdSet.add(row.userId)
  for (const row of mergeUsers) userIdSet.add(row.userId)

  let reconciled = 0

  // 逐一对账
  for (const userId of userIdSet) {
    await reconcile(userId)
    reconciled++
  }

  console.log(`[并发对账] 对账完成: 修复了 ${reconciled} 个用户的计数偏差`)
}
