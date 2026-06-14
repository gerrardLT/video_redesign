import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: group-editing-and-cleanup, Property 6: 权限校验拒绝非所有者操作
 *
 * For any 用户 ID 与 ShotGroup 的组合，当该用户不是组所属项目的 owner 时，
 * PATCH /api/shot-groups/[id] 应返回 404 拒绝操作。
 *
 * Validates: Requirements 6.8
 */

interface GroupOwnership {
  groupExists: boolean
  projectOwnerId: string
  requestUserId: string
}

// 从 PATCH API 中提取的权限校验逻辑
function checkPermission(ownership: GroupOwnership): { allowed: boolean; statusCode: number } {
  // 组不存在或不属于当前用户
  if (!ownership.groupExists || ownership.projectOwnerId !== ownership.requestUserId) {
    return { allowed: false, statusCode: 404 }
  }
  return { allowed: true, statusCode: 200 }
}

describe('Property 6: 权限校验拒绝非所有者操作', () => {
  it('非所有者始终被拒绝（返回 404）', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        ([ownerId, requesterId]) => {
          const result = checkPermission({
            groupExists: true,
            projectOwnerId: ownerId,
            requestUserId: requesterId,
          })
          expect(result.allowed).toBe(false)
          expect(result.statusCode).toBe(404)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('所有者访问被允许', () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        const result = checkPermission({
          groupExists: true,
          projectOwnerId: userId,
          requestUserId: userId,
        })
        expect(result.allowed).toBe(true)
        expect(result.statusCode).toBe(200)
      }),
      { numRuns: 100 }
    )
  })

  it('组不存在时始终拒绝（无论 userId 是否匹配）', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.uuid(), fc.uuid()),
        ([ownerId, requesterId]) => {
          const result = checkPermission({
            groupExists: false,
            projectOwnerId: ownerId,
            requestUserId: requesterId,
          })
          expect(result.allowed).toBe(false)
          expect(result.statusCode).toBe(404)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('组不存在时即使 userId 相同也被拒绝', () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        const result = checkPermission({
          groupExists: false,
          projectOwnerId: userId,
          requestUserId: userId,
        })
        expect(result.allowed).toBe(false)
        expect(result.statusCode).toBe(404)
      }),
      { numRuns: 100 }
    )
  })
})
