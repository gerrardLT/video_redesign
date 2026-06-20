// Feature: asset-expiry-policy, Property 1: ExpiryStatus 计算正确性

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeExpiryStatus } from '@/lib/expiry-status'

/**
 * Property 1: ExpiryStatus 计算正确性
 *
 * For any expiresAt 值（null 或任意 Date）和 any 参考时间 now，
 * computeExpiryStatus(expiresAt, now) 的返回值必须满足以下分区规则：
 * - expiresAt === null → status='permanent', remainingDays=null
 * - expiresAt <= now → status='expired', remainingDays=null
 * - 0 < (expiresAt - now) <= 3天 → status='expiring_soon', remainingDays=ceil(diff/天)
 * - (expiresAt - now) > 3天 → status='active', remainingDays=ceil(diff/天)
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

// 通用 date arbitrary（避免 NaN 日期）
const validDate = (min: string, max: string) =>
  fc.date({ min: new Date(min), max: new Date(max), noInvalidDate: true })

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const THREE_DAYS_MS = 3 * ONE_DAY_MS

describe('ExpiryStatus 计算正确性 Property (Property 1)', () => {
  it('expiresAt === null 时返回 permanent，remainingDays 为 null', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        (now) => {
          const result = computeExpiryStatus(null, now)

          expect(result.status).toBe('permanent')
          expect(result.remainingDays).toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })

  it('expiresAt <= now 时返回 expired，remainingDays 为 null', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        fc.integer({ min: 0, max: 365 * ONE_DAY_MS }),
        (expiresAt, offsetMs) => {
          // now >= expiresAt（now = expiresAt + offsetMs）
          const now = new Date(expiresAt.getTime() + offsetMs)

          const result = computeExpiryStatus(expiresAt, now)

          expect(result.status).toBe('expired')
          expect(result.remainingDays).toBeNull()
        }
      ),
      { numRuns: 200 }
    )
  })

  it('0 < (expiresAt - now) <= 3天 时返回 expiring_soon，remainingDays = Math.ceil(diff/天)', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        fc.integer({ min: 1, max: THREE_DAYS_MS }),
        (now, diffMs) => {
          // expiresAt = now + diffMs，保证 0 < diff <= 3天
          const expiresAt = new Date(now.getTime() + diffMs)

          const result = computeExpiryStatus(expiresAt, now)

          expect(result.status).toBe('expiring_soon')
          expect(result.remainingDays).toBe(Math.ceil(diffMs / ONE_DAY_MS))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('(expiresAt - now) > 3天 时返回 active，remainingDays = Math.ceil(diff/天)', () => {
    fc.assert(
      fc.property(
        validDate('2020-01-01', '2030-12-31'),
        fc.integer({ min: THREE_DAYS_MS + 1, max: 365 * ONE_DAY_MS }),
        (now, diffMs) => {
          // expiresAt = now + diffMs，保证 diff > 3天
          const expiresAt = new Date(now.getTime() + diffMs)

          const result = computeExpiryStatus(expiresAt, now)

          expect(result.status).toBe('active')
          expect(result.remainingDays).toBe(Math.ceil(diffMs / ONE_DAY_MS))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('所有分区互斥且完整覆盖：任意 expiresAt 和 now 组合必命中恰好一个分区', () => {
    fc.assert(
      fc.property(
        fc.option(validDate('2020-01-01', '2030-12-31'), { nil: null }),
        validDate('2020-01-01', '2030-12-31'),
        (expiresAt, now) => {
          const result = computeExpiryStatus(expiresAt, now)

          // 状态必须是四种之一
          expect(['permanent', 'expiring_soon', 'active', 'expired']).toContain(result.status)

          if (expiresAt === null) {
            expect(result.status).toBe('permanent')
            expect(result.remainingDays).toBeNull()
          } else {
            const diffMs = expiresAt.getTime() - now.getTime()

            if (diffMs <= 0) {
              expect(result.status).toBe('expired')
              expect(result.remainingDays).toBeNull()
            } else if (diffMs <= THREE_DAYS_MS) {
              expect(result.status).toBe('expiring_soon')
              expect(result.remainingDays).toBe(Math.ceil(diffMs / ONE_DAY_MS))
            } else {
              expect(result.status).toBe('active')
              expect(result.remainingDays).toBe(Math.ceil(diffMs / ONE_DAY_MS))
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
