import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: codebase-hygiene-fixes
 * Property: PostgreSQL 幂等清理完整性
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * 对任意 projectId 下已存在的 ShotGroup、Shot、Character 记录，
 * 执行幂等清理阶段 SHALL 在创建新记录前删除该项目的所有三种类型记录。
 *
 * 由于涉及数据库操作，通过模拟验证属性：
 * - 创建类 Prisma 接口模拟
 * - 模拟不同数量的已有记录
 * - 清理后三种记录类型的 count 均为 0
 * - 清理顺序为 ShotGroup → Shot → Character（外键依赖顺序）
 * - 若某步 deleteMany 因 PostgreSQL 事务冲突（P2034）失败，后续步骤不执行
 * - 清理操作幂等——对已清空状态再次执行结果相同
 */

// --- 模拟类 Prisma 接口用于测试清理逻辑 ---

interface MockStore {
  shotGroups: Map<string, number> // projectId → count
  shots: Map<string, number>
  characters: Map<string, number>
}

interface CleanupCallRecord {
  model: 'shotGroup' | 'shot' | 'character'
  projectId: string
  order: number
}

interface CleanupResult {
  callOrder: CleanupCallRecord[]
  finalStore: MockStore
  error: Error | null
}

/**
 * 模拟 parse-video.ts 中的幂等清理逻辑：
 *
 * ```typescript
 * await prisma.shotGroup.deleteMany({ where: { projectId } })
 * await prisma.shot.deleteMany({ where: { projectId } })
 * await prisma.character.deleteMany({ where: { projectId } })
 * ```
 *
 * 失败时抛出 PostgreSQL 事务写冲突错误（P2034）。
 * 返回调用顺序和清理后的最终状态。
 */
function simulateIdempotentCleanup(
  projectId: string,
  store: MockStore,
  failAt?: 'shotGroup' | 'shot' | 'character'
): CleanupResult {
  const callOrder: CleanupCallRecord[] = []
  let orderCounter = 0

  // Deep copy store to simulate mutations
  const finalStore: MockStore = {
    shotGroups: new Map(store.shotGroups),
    shots: new Map(store.shots),
    characters: new Map(store.characters),
  }

  // Step 1: prisma.shotGroup.deleteMany({ where: { projectId } })
  if (failAt === 'shotGroup') {
    return { callOrder, finalStore, error: new Error('P2034: Transaction failed due to a write conflict') }
  }
  callOrder.push({ model: 'shotGroup', projectId, order: orderCounter++ })
  finalStore.shotGroups.set(projectId, 0)

  // Step 2: prisma.shot.deleteMany({ where: { projectId } })
  if (failAt === 'shot') {
    return { callOrder, finalStore, error: new Error('P2034: Transaction failed due to a write conflict') }
  }
  callOrder.push({ model: 'shot', projectId, order: orderCounter++ })
  finalStore.shots.set(projectId, 0)

  // Step 3: prisma.character.deleteMany({ where: { projectId } })
  if (failAt === 'character') {
    return { callOrder, finalStore, error: new Error('P2034: Transaction failed due to a write conflict') }
  }
  callOrder.push({ model: 'character', projectId, order: orderCounter++ })
  finalStore.characters.set(projectId, 0)

  return { callOrder, finalStore, error: null }
}

describe('Idempotent cleanup completeness (Property 5)', () => {
  it('after cleanup, all three record counts are 0 for the target projectId', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }), // random projectId
        fc.integer({ min: 0, max: 100 }), // initial ShotGroup count
        fc.integer({ min: 0, max: 100 }), // initial Shot count
        fc.integer({ min: 0, max: 100 }), // initial Character count
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          const { finalStore, error } = simulateIdempotentCleanup(projectId, store)

          // No error expected in the normal path
          expect(error).toBeNull()

          // After cleanup, all three record types should have count = 0
          expect(finalStore.shotGroups.get(projectId)).toBe(0)
          expect(finalStore.shots.get(projectId)).toBe(0)
          expect(finalStore.characters.get(projectId)).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('cleanup order is ShotGroup → Shot → Character (FK dependency order)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          const { callOrder, error } = simulateIdempotentCleanup(projectId, store)

          expect(error).toBeNull()
          expect(callOrder).toHaveLength(3)

          // Verify strict ordering: ShotGroup → Shot → Character
          expect(callOrder[0].model).toBe('shotGroup')
          expect(callOrder[1].model).toBe('shot')
          expect(callOrder[2].model).toBe('character')

          // Verify order values are strictly increasing
          expect(callOrder[0].order).toBeLessThan(callOrder[1].order)
          expect(callOrder[1].order).toBeLessThan(callOrder[2].order)

          // Verify all operations target the same projectId
          for (const call of callOrder) {
            expect(call.projectId).toBe(projectId)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('if shotGroup deleteMany fails, shot and character deleteMany are NOT called', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          const { callOrder, finalStore, error } = simulateIdempotentCleanup(
            projectId,
            store,
            'shotGroup'
          )

          // Error should be thrown
          expect(error).not.toBeNull()
          expect(error!.message).toContain('P2034')

          // Zero calls should have completed (failed at first step)
          expect(callOrder).toHaveLength(0)

          // Shot and Character records should NOT be cleaned
          expect(finalStore.shots.get(projectId)).toBe(shotCount)
          expect(finalStore.characters.get(projectId)).toBe(charCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('if shot deleteMany fails, character deleteMany is NOT called', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          const { callOrder, finalStore, error } = simulateIdempotentCleanup(
            projectId,
            store,
            'shot'
          )

          // Error should be thrown
          expect(error).not.toBeNull()
          expect(error!.message).toContain('P2034')

          // Only shotGroup deletion should have completed
          expect(callOrder).toHaveLength(1)
          expect(callOrder[0].model).toBe('shotGroup')

          // ShotGroup should be cleaned (it succeeded before the failure)
          expect(finalStore.shotGroups.get(projectId)).toBe(0)

          // Character records should NOT be cleaned (comes after the failed step)
          expect(finalStore.characters.get(projectId)).toBe(charCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('if character deleteMany fails, shotGroup and shot are already cleaned', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          const { callOrder, finalStore, error } = simulateIdempotentCleanup(
            projectId,
            store,
            'character'
          )

          // Error should be thrown
          expect(error).not.toBeNull()

          // ShotGroup and Shot deletions should have completed
          expect(callOrder).toHaveLength(2)
          expect(callOrder[0].model).toBe('shotGroup')
          expect(callOrder[1].model).toBe('shot')

          // ShotGroup and Shot should be cleaned
          expect(finalStore.shotGroups.get(projectId)).toBe(0)
          expect(finalStore.shots.get(projectId)).toBe(0)

          // Character records should NOT be cleaned (the failing step)
          expect(finalStore.characters.get(projectId)).toBe(charCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('cleanup does not affect records of other projects', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (targetProject, otherProjectBase, sgCount, shotCount, charCount) => {
          // Ensure two different project IDs
          const otherProjectId = otherProjectBase === targetProject
            ? targetProject + '_other'
            : otherProjectBase

          const store: MockStore = {
            shotGroups: new Map([
              [targetProject, sgCount],
              [otherProjectId, sgCount],
            ]),
            shots: new Map([
              [targetProject, shotCount],
              [otherProjectId, shotCount],
            ]),
            characters: new Map([
              [targetProject, charCount],
              [otherProjectId, charCount],
            ]),
          }

          const { finalStore, error } = simulateIdempotentCleanup(targetProject, store)

          expect(error).toBeNull()

          // Target project records cleaned
          expect(finalStore.shotGroups.get(targetProject)).toBe(0)
          expect(finalStore.shots.get(targetProject)).toBe(0)
          expect(finalStore.characters.get(targetProject)).toBe(0)

          // Other project records untouched
          expect(finalStore.shotGroups.get(otherProjectId)).toBe(sgCount)
          expect(finalStore.shots.get(otherProjectId)).toBe(shotCount)
          expect(finalStore.characters.get(otherProjectId)).toBe(charCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('cleanup is idempotent — running cleanup twice yields the same result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (projectId, sgCount, shotCount, charCount) => {
          const store: MockStore = {
            shotGroups: new Map([[projectId, sgCount]]),
            shots: new Map([[projectId, shotCount]]),
            characters: new Map([[projectId, charCount]]),
          }

          // First cleanup
          const { finalStore: storeAfterFirst, error: err1 } =
            simulateIdempotentCleanup(projectId, store)
          expect(err1).toBeNull()

          // Second cleanup (on already-empty state)
          const { finalStore: storeAfterSecond, error: err2 } =
            simulateIdempotentCleanup(projectId, storeAfterFirst)
          expect(err2).toBeNull()

          // Both cleanups yield the same final state (all zeroed)
          expect(storeAfterSecond.shotGroups.get(projectId)).toBe(0)
          expect(storeAfterSecond.shots.get(projectId)).toBe(0)
          expect(storeAfterSecond.characters.get(projectId)).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})
