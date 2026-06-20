import { describe, it, expect } from 'vitest'
import { computeExpiryStatus } from '@/lib/expiry-status'

describe('computeExpiryStatus - 边界情况', () => {
  it('expiresAt === null → permanent，remainingDays 为 null', () => {
    const result = computeExpiryStatus(null)
    expect(result).toEqual({ status: 'permanent', remainingDays: null })
  })

  it('expiresAt 恰好等于 now → expired，remainingDays 为 null', () => {
    const now = new Date('2024-06-01T12:00:00.000Z')
    const expiresAt = new Date('2024-06-01T12:00:00.000Z')
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'expired', remainingDays: null })
  })

  it('expiresAt = now + 3 天整 → expiring_soon，remainingDays: 3', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'expiring_soon', remainingDays: 3 })
  })

  it('expiresAt = now + 3 天 + 1ms → active，remainingDays: 4', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000 + 1)
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'active', remainingDays: 4 })
  })

  it('expiresAt = now + 1.5 天 → expiring_soon，remainingDays: 2（向上取整）', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const expiresAt = new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000)
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'expiring_soon', remainingDays: 2 })
  })

  it('expiresAt = now + 0.1 天 → expiring_soon，remainingDays: 1（向上取整）', () => {
    const now = new Date('2024-06-01T00:00:00.000Z')
    const expiresAt = new Date(now.getTime() + 0.1 * 24 * 60 * 60 * 1000)
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'expiring_soon', remainingDays: 1 })
  })

  it('expiresAt 在过去 → expired，remainingDays 为 null', () => {
    const now = new Date('2024-06-01T12:00:00.000Z')
    const expiresAt = new Date('2024-05-20T00:00:00.000Z')
    const result = computeExpiryStatus(expiresAt, now)
    expect(result).toEqual({ status: 'expired', remainingDays: null })
  })
})
