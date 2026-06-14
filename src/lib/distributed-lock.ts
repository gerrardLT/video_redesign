/**
 * Redis 分布式锁
 * 基于 Redis SET NX EX 实现非阻塞锁获取，Lua 脚本实现原子锁释放。
 *
 * 两类锁：
 *  1. 生成任务锁（generateLockKey + acquireLock，非阻塞，TTL 12 分钟）——按分镜组/任务隔离，
 *     覆盖 Seedance 长时轮询，获取失败即跳过（另一 Worker 在处理）。
 *  2. 全局积分写锁（withCreditLock，阻塞式，TTL 15 秒）——对关键积分/余额/状态写做
 *     【跨进程】串行化（缺陷 11），获取失败则退避重试直至获锁或超时抛错（绝不静默跳过）。
 */
import { randomUUID } from 'crypto'
import { redis } from './redis'
import { withRetry } from './db-retry'

/** 锁 TTL：12 分钟（720 秒），覆盖 Seedance 最大生成时长 + 轮询冗余 */
const LOCK_TTL_SECONDS = 720

/**
 * 尝试获取分布式锁（非阻塞）
 * 使用 Redis SET key value NX EX ttl
 * @param key 锁键名
 * @param value 锁值（通常为 jobId，用于安全释放时验证持有者）
 * @returns true 表示获取成功，false 表示已被其他实例持有
 */
export async function acquireLock(key: string, value: string): Promise<boolean> {
  const result = await redis.set(key, value, 'EX', LOCK_TTL_SECONDS, 'NX')
  return result === 'OK'
}

/**
 * 安全释放分布式锁
 * 仅当锁值与预期一致时才释放（Lua 脚本原子操作）
 * @param key 锁键名
 * @param expectedValue 预期锁值（当前持有者的 jobId）
 * @returns true 表示成功释放，false 表示锁已不属于当前持有者
 */
export async function releaseLock(key: string, expectedValue: string): Promise<boolean> {
  // Lua 脚本：原子验证锁值 + 删除
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `
  const result = await redis.eval(script, 1, key, expectedValue)
  return result === 1
}

/**
 * 生成生成任务的锁键
 * @param shotGroupId 分镜组 ID
 */
export function generateLockKey(shotGroupId: string): string {
  return `lock:generate:shotGroup:${shotGroupId}`
}

// ============================================================
// 全局积分写锁（跨进程串行化，缺陷 11）
// ============================================================

/** 全局积分写锁键：所有关键积分/余额/状态写跨进程争用的同一把锁 */
const CREDIT_LOCK_KEY = 'lock:credit:global'

/**
 * 全局积分写锁 TTL：15 秒。
 * 取值依据：仅需覆盖单次「读余额 → 改余额 → 写流水」关键事务（正常亚秒级，
 * generate 成功事务 Prisma 超时上限 10s）即可释放，远小于生成任务锁的 12 分钟
 * （LOCK_TTL_SECONDS）。短 TTL 保证持有者进程崩溃时锁能快速自动过期，不长期阻塞积分写。
 */
const CREDIT_LOCK_TTL_SECONDS = 15

/** 抢锁失败时的退避基准（毫秒）：50~100ms 区间小退避，叠加抖动避免多进程惊群 */
const CREDIT_LOCK_RETRY_BASE_MS = 75

/**
 * 抢锁最大等待时长：30 秒。超时仍未获得锁则抛错拒绝（绝不静默跳过积分写），
 * 由上层（BullMQ 重试 / API 错误响应）处理。积分事务为亚秒级，30s 足以容纳并发突发排队。
 */
const CREDIT_LOCK_MAX_WAIT_MS = 30000

function creditLockSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 在「全局积分写锁」保护下串行执行一个关键积分/余额/状态写操作（缺陷 11，跨进程串行化）。
 *
 * 背景与必要性：数据库为 libSQL/SQLite 单写锁模型。高并发积分写来自两类【不同进程】：
 *   1. BullMQ Worker 进程（src/workers/index.ts 单进程导入 generate(concurrency=5)/merge/链式续接）；
 *   2. Next.js 应用进程（充值回调 topupCredits、入队冻结 reserveCredits / 路由内联 RESERVE、管理员调账等）。
 * 二者并发写 creditLedger / user.creditBalance 既触发 SQLITE_BUSY 写锁竞争，
 * 又因积分事务是「读余额 → 改余额」的读-改-写而存在丢失更新风险。进程内互斥无法覆盖
 * 「Worker 进程 × 应用进程」的跨进程竞争，故必须用 Redis 全局锁（所有进程共享同一 Redis）
 * 对关键积分写做【跨进程串行化】：同一时刻全局仅一个关键积分事务在执行，从根本上消除
 * 跨进程写锁竞争与读-改-写丢失更新。
 *
 * 机制：阻塞式获取单一全局键 CREDIT_LOCK_KEY（SET NX EX，TTL=15s）——非阻塞抢锁失败则按
 * ~75ms（含抖动）小退避重试，直至获得锁或超过最大等待 30s 抛错拒绝（绝不静默跳过）；
 * 获锁后执行 fn，最终在 finally 用本次唯一锁值经 Lua 安全释放（仅删自己的锁）。
 *
 * 与 db-retry 互补而非替代：串行化消除主竞争源后，仍在锁内复用 withRetry 对跨进程残余
 * SQLITE_BUSY 兜底重试，保证最终写入成功。幂等不受影响：本锁只控制「何时执行」，不改变
 * 事务内部逻辑，既有 existingCharge / orderId / REFUND 幂等守卫完全保留。
 *
 * 注意：本锁【不可重入】——持有者内部不得再调用 withCreditLock（会自锁死至超时抛错）。
 * 故仅包裹【最外层】关键积分写事务（credit-service 内部 $transaction，及 Worker / API 路由中
 * 直接写 creditLedger 的 $transaction 调用点），不在其内层再次加锁。
 *
 * @param fn 需串行执行的关键积分写操作（通常为一个 prisma.$transaction 调用）
 * @param label 操作标签，用于 db-retry 重试日志上下文
 * @returns fn 的返回值
 */
export async function withCreditLock<T>(
  fn: () => Promise<T>,
  label = 'creditWrite'
): Promise<T> {
  const lockValue = randomUUID()
  const deadline = Date.now() + CREDIT_LOCK_MAX_WAIT_MS

  // 阻塞式抢锁：非阻塞 SET NX 失败则小退避重试，直至获锁或超时抛错（绝不静默跳过）
  for (;;) {
    const acquired = await redis.set(CREDIT_LOCK_KEY, lockValue, 'EX', CREDIT_LOCK_TTL_SECONDS, 'NX')
    if (acquired === 'OK') break
    if (Date.now() >= deadline) {
      throw new Error(
        `[withCreditLock] ${label} 获取全局积分写锁超时（>${CREDIT_LOCK_MAX_WAIT_MS}ms），拒绝继续以保证积分一致性`
      )
    }
    // 退避叠加抖动（0~base）避免多进程同时唤醒惊群
    await creditLockSleep(CREDIT_LOCK_RETRY_BASE_MS + Math.floor(Math.random() * CREDIT_LOCK_RETRY_BASE_MS))
  }

  try {
    // 锁内复用 db-retry：对跨进程残余 SQLITE_BUSY 兜底重试，串行化与重试互补
    return await withRetry(fn, label)
  } finally {
    // 安全释放：仅当锁值仍为本次唯一值时删除，避免误删 TTL 过期后他人持有的锁
    await releaseLock(CREDIT_LOCK_KEY, lockValue)
  }
}
