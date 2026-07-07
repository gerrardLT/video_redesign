import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { signToken, verifyToken } from '@/lib/shared/auth'

/**
 * Feature: video-reshaping-mvp
 * Property 1: JWT 签发/验证 Round-Trip
 *
 * **Validates: Requirements 1.2**
 *
 * 对于任意合法的 userId 和 role 组合，签发的 token 验证后
 * 应该返回原始的 userId 和 role。
 */
describe('JWT Round-Trip Property', () => {
  it('should verify any token signed with valid userId and role', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 30 }), // userId (cuid-like)
        fc.constantFrom('USER', 'ADMIN'),             // role
        (userId, role) => {
          const token = signToken({ userId, role })
          const decoded = verifyToken(token)
          expect(decoded.userId).toBe(userId)
          expect(decoded.role).toBe(role)
        }
      ),
      { numRuns: 100 }
    )
  })
})
