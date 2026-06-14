/**
 * 任务状态机
 * 定义 GenerationJob 的合法状态转换
 *
 * 真实流程（与 worker/路由实现一致）：
 *   QUEUED → SUBMITTED → GENERATING → SUCCEEDED
 *   - 创建 GenerationJob 时即在同事务冻结积分（RESERVE），状态直接为 QUEUED；
 *   - 项目级分段生成：QUEUED 直接 → GENERATING（不经过 SUBMITTED）；
 *   - 任一步失败 → FAILED；FAILED 可重试回 QUEUED，或重试恢复时 → GENERATING；
 *   - QUEUED 可取消 → CANCELED。
 *
 * 校验调用点（真实现状）：assertTransition 仅由 API 路由调用——
 *   `jobs/[id]/retry`、`admin/jobs/[id]/retry`（FAILED→QUEUED）与 `jobs/[id]/cancel`（→CANCELED）。
 *   生成/解析/合并 worker 直接 update({ status }) 写入，不经过 assertTransition。
 *
 * 注：本表仅约束 GenerationJob 状态空间，不含 Project.status（PARSING/EDITABLE/
 *   GENERATING/EXPORTED/MERGE_FAILED/FAILED），二者为不同状态空间，互不混用。
 *
 * 注：CREATED / CREDIT_RESERVED 为历史保留枚举值，当前实现不产生这两个中间状态，
 * 但仍保留在转换表中以兼容历史数据与既有属性测试。
 */

// 合法状态转换映射
const VALID_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['QUEUED'],
  QUEUED: ['CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'CANCELED', 'FAILED'],
  CREDIT_RESERVED: ['SUBMITTED', 'GENERATING', 'FAILED', 'CANCELED'],
  SUBMITTED: ['GENERATING', 'FAILED'],
  GENERATING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: ['QUEUED', 'GENERATING'],
  CANCELED: [],
  REFUNDED: [],
}

/**
 * 检查状态转换是否合法
 */
export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

/**
 * 强制校验状态转换：非法转换抛错。
 * 由状态变更类 API 路由（jobs/retry、admin/jobs/retry、jobs/cancel）在写入前调用；
 * worker 直接写状态，不经过此校验（见文件头说明）。
 *
 * @throws 当 from→to 非法时抛出错误
 */
export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法状态转换：${from} → ${to}`)
  }
}

/**
 * 检查任务是否可取消
 * 只有尚未真正提交给 Seedance 的 QUEUED 状态可取消（CREDIT_RESERVED 为历史兼容值）
 */
export function canCancel(status: string): boolean {
  return status === 'QUEUED' || status === 'CREDIT_RESERVED'
}

/**
 * 检查任务是否可重试
 * 只有 FAILED 状态可重试
 */
export function canRetry(status: string): boolean {
  return status === 'FAILED'
}

/**
 * 获取所有合法的下一状态
 */
export function getNextStates(status: string): string[] {
  return VALID_TRANSITIONS[status] ?? []
}

/**
 * 所有终态（不可再转换）
 */
export const TERMINAL_STATES = ['SUCCEEDED', 'CANCELED', 'REFUNDED']

/**
 * 判断状态是否为终态
 */
export function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.includes(status)
}
