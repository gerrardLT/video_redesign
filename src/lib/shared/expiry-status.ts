/**
 * 资产过期状态计算器（纯函数模块）
 *
 * 根据 Asset 的 expiresAt 字段计算过期状态，独立纯函数便于测试和复用。
 *
 * 状态判定规则：
 * | 条件                          | 状态            | remainingDays      |
 * |-------------------------------|----------------|--------------------|
 * | expiresAt === null            | permanent      | null               |
 * | expiresAt <= now              | expired        | null               |
 * | 0 < (expiresAt - now) <= 3天 | expiring_soon  | Math.ceil(天数差)  |
 * | (expiresAt - now) > 3天      | active         | Math.ceil(天数差)  |
 */

/** 资产过期状态枚举 */
export type ExpiryStatus = 'permanent' | 'expiring_soon' | 'active' | 'expired'

/** 过期状态计算结果 */
export interface ExpiryStatusResult {
  /** 过期状态 */
  status: ExpiryStatus
  /** 剩余天数（permanent 和 expired 时为 null） */
  remainingDays: number | null
}

/** 即将过期阈值：3 天（毫秒） */
const EXPIRING_SOON_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000

/** 一天的毫秒数 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * 计算资产过期状态
 *
 * @param expiresAt - 过期时间，null 表示永久资产
 * @param now - 当前时间（可注入，便于测试）
 * @returns 包含状态和剩余天数的结果
 */
export function computeExpiryStatus(
  expiresAt: Date | null,
  now: Date = new Date()
): ExpiryStatusResult {
  // 永久资产：expiresAt 为 null
  if (expiresAt === null) {
    return { status: 'permanent', remainingDays: null }
  }

  const diffMs = expiresAt.getTime() - now.getTime()

  // 已过期：expiresAt <= now
  if (diffMs <= 0) {
    return { status: 'expired', remainingDays: null }
  }

  // 计算剩余天数（向上取整）
  const remainingDays = Math.ceil(diffMs / ONE_DAY_MS)

  // 即将过期：距过期时间 <= 3 天
  if (diffMs <= EXPIRING_SOON_THRESHOLD_MS) {
    return { status: 'expiring_soon', remainingDays }
  }

  // 有效期内：距过期时间 > 3 天
  return { status: 'active', remainingDays }
}
