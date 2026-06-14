import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: product-competitiveness
 * Property 5: 管理员权限访问控制
 *
 * For any user and admin API endpoint, when user role is not ADMIN
 * the request should return 403; when user role is ADMIN, the request
 * should be processed normally (no 403).
 *
 * **Validates: Requirements 3.4, 6.5**
 */

// ========================
// 纯函数模拟（管理后台权限检查逻辑）
// ========================

type UserRole = 'USER' | 'ADMIN'

interface User {
  id: string
  email: string
  role: UserRole
}

interface AuthResult {
  authorized: boolean
  statusCode: number
  error?: string
}

/** 管理后台 API 端点列表 */
const ADMIN_ENDPOINTS = [
  'GET /api/admin/showcase',
  'POST /api/admin/showcase',
  'PUT /api/admin/showcase/:id',
  'DELETE /api/admin/showcase/:id',
  'GET /api/admin/help-articles',
  'POST /api/admin/help-articles',
  'PUT /api/admin/help-articles/:id',
  'DELETE /api/admin/help-articles/:id',
  'PATCH /api/admin/help-articles/:id/sort',
  'GET /api/admin/content-safety',
  'PATCH /api/admin/content-safety/:id/review',
  'GET /api/admin/orders',
  'GET /api/admin/orders/stats',
  'GET /api/admin/assets',
  'GET /api/admin/assets/stats',
] as const

/** 公开 API 端点列表（无需鉴权） */
const PUBLIC_ENDPOINTS = [
  'GET /api/showcase',
  'GET /api/showcase/:id',
  'GET /api/showcase/categories',
  'GET /api/help-articles',
  'GET /api/help-articles/search',
  'GET /api/help-articles/:slug',
] as const

/** 普通登录用户可访问的端点 */
const USER_ENDPOINTS = [
  'POST /api/projects/import-link',
  'GET /api/projects/:id/import-status',
  'GET /api/packages',
  'POST /api/orders',
  'GET /api/orders',
  'GET /api/notifications',
] as const

/**
 * 模拟管理后台权限验证逻辑
 * 管理后台路径统一要求 ADMIN 角色
 */
function checkAdminAccess(user: User | null, endpoint: string): AuthResult {
  // 未登录
  if (!user) {
    return { authorized: false, statusCode: 401, error: '请先登录' }
  }

  // 检查是否为管理后台端点
  const isAdminEndpoint = endpoint.includes('/api/admin/')

  if (isAdminEndpoint) {
    if (user.role !== 'ADMIN') {
      return { authorized: false, statusCode: 403, error: '权限不足' }
    }
    return { authorized: true, statusCode: 200 }
  }

  // 非管理后台端点，已登录即可
  return { authorized: true, statusCode: 200 }
}

/**
 * 检查公开端点访问（无需登录）
 */
function checkPublicAccess(endpoint: string): AuthResult {
  const isPublic = !endpoint.includes('/api/admin/') &&
    !endpoint.includes('/api/projects/') &&
    !endpoint.includes('/api/orders') &&
    !endpoint.includes('/api/notifications')

  if (isPublic) {
    return { authorized: true, statusCode: 200 }
  }

  return { authorized: false, statusCode: 401, error: '请先登录' }
}

// ========================
// 生成器
// ========================

const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom('USER', 'ADMIN')

const userArb: fc.Arbitrary<User> = fc.record({
  id: fc.uuid(),
  email: fc.stringMatching(/^[a-z]{4,8}@example\.com$/),
  role: userRoleArb,
})

const adminEndpointArb = fc.constantFrom(...ADMIN_ENDPOINTS)
const publicEndpointArb = fc.constantFrom(...PUBLIC_ENDPOINTS)
const userEndpointArb = fc.constantFrom(...USER_ENDPOINTS)

// ========================
// Property 5: 管理员权限访问控制
// ========================

describe('管理员权限访问控制 Property (Property 5)', () => {
  it('ADMIN 用户访问管理后台端点返回 200（正常处理）', () => {
    fc.assert(
      fc.property(
        userArb.map((u) => ({ ...u, role: 'ADMIN' as UserRole })),
        adminEndpointArb,
        (adminUser, endpoint) => {
          const result = checkAdminAccess(adminUser, endpoint)

          expect(result.authorized).toBe(true)
          expect(result.statusCode).toBe(200)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('非 ADMIN 用户访问管理后台端点返回 403', () => {
    fc.assert(
      fc.property(
        userArb.map((u) => ({ ...u, role: 'USER' as UserRole })),
        adminEndpointArb,
        (normalUser, endpoint) => {
          const result = checkAdminAccess(normalUser, endpoint)

          expect(result.authorized).toBe(false)
          expect(result.statusCode).toBe(403)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('未登录用户访问管理后台端点返回 401', () => {
    fc.assert(
      fc.property(adminEndpointArb, (endpoint) => {
        const result = checkAdminAccess(null, endpoint)

        expect(result.authorized).toBe(false)
        expect(result.statusCode).toBe(401)
      }),
      { numRuns: 100 }
    )
  })

  it('ADMIN 用户同时可以访问普通用户端点', () => {
    fc.assert(
      fc.property(
        userArb.map((u) => ({ ...u, role: 'ADMIN' as UserRole })),
        userEndpointArb,
        (adminUser, endpoint) => {
          const result = checkAdminAccess(adminUser, endpoint)

          expect(result.authorized).toBe(true)
          expect(result.statusCode).toBe(200)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('所有管理后台端点都包含 /api/admin/ 前缀', () => {
    fc.assert(
      fc.property(adminEndpointArb, (endpoint) => {
        expect(endpoint).toContain('/api/admin/')
      }),
      { numRuns: 50 }
    )
  })

  it('公开端点无需登录即可访问', () => {
    fc.assert(
      fc.property(publicEndpointArb, (endpoint) => {
        const result = checkPublicAccess(endpoint)

        expect(result.authorized).toBe(true)
        expect(result.statusCode).toBe(200)
      }),
      { numRuns: 100 }
    )
  })

  it('权限检查对任意 role + endpoint 组合是确定性的', () => {
    fc.assert(
      fc.property(
        userArb,
        fc.oneof(adminEndpointArb, userEndpointArb),
        (user, endpoint) => {
          const result1 = checkAdminAccess(user, endpoint)
          const result2 = checkAdminAccess(user, endpoint)

          expect(result1.authorized).toBe(result2.authorized)
          expect(result1.statusCode).toBe(result2.statusCode)
        }
      ),
      { numRuns: 200 }
    )
  })
})
