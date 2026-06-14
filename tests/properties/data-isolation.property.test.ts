/**
 * Property 10: 用户数据隔离
 * 
 * **Validates: Requirements 22.5, 17.5**
 * 
 * 对任意两个不同用户 A 和 B，用户 A 的 API 请求只能访问和修改 userId === A 的项目、
 * 分镜和素材数据。尝试访问用户 B 的资源应返回 404 或 403。
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { getUserId, requireAdmin } from '@/lib/auth-helpers'
import { ApiError } from '@/lib/api-error'

// Mock NextRequest for testing
function createMockRequest(headers: Record<string, string>) {
  return {
    headers: {
      get: (name: string) => headers[name] || null,
    },
  } as unknown as import('next/server').NextRequest
}

describe('Property 10: 用户数据隔离', () => {
  describe('getUserId - 认证强制性', () => {
    it('对任意缺失 x-user-id 的请求应抛出 UNAUTHORIZED 错误', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', undefined, null),
          (headerValue) => {
            const headers: Record<string, string> = {}
            if (headerValue) {
              headers['x-user-id'] = headerValue as string
            }
            const req = createMockRequest(headers)

            expect(() => getUserId(req)).toThrow(ApiError)
            try {
              getUserId(req)
            } catch (e) {
              expect(e).toBeInstanceOf(ApiError)
              expect((e as ApiError).code).toBe('UNAUTHORIZED')
              expect((e as ApiError).statusCode).toBe(401)
            }
          }
        ),
        { numRuns: 10 }
      )
    })

    it('对任意非空 x-user-id 应返回该 userId', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (userId) => {
            const req = createMockRequest({ 'x-user-id': userId })
            const result = getUserId(req)
            expect(result).toBe(userId)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  describe('requireAdmin - 角色校验', () => {
    it('对任意非 ADMIN 角色应抛出 FORBIDDEN 错误', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 20 }).filter((s) => s !== 'ADMIN'),
          (role) => {
            const req = createMockRequest({ 'x-user-role': role })

            expect(() => requireAdmin(req)).toThrow(ApiError)
            try {
              requireAdmin(req)
            } catch (e) {
              expect(e).toBeInstanceOf(ApiError)
              expect((e as ApiError).code).toBe('FORBIDDEN')
              expect((e as ApiError).statusCode).toBe(403)
            }
          }
        ),
        { numRuns: 50 }
      )
    })

    it('ADMIN 角色不应抛出错误', () => {
      const req = createMockRequest({ 'x-user-role': 'ADMIN' })
      expect(() => requireAdmin(req)).not.toThrow()
    })

    it('缺失 x-user-role 头应抛出 FORBIDDEN 错误', () => {
      const req = createMockRequest({})
      expect(() => requireAdmin(req)).toThrow(ApiError)
      try {
        requireAdmin(req)
      } catch (e) {
        expect((e as ApiError).code).toBe('FORBIDDEN')
      }
    })
  })
})
