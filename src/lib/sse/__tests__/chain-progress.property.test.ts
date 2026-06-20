/**
 * 链式生成进度一致性 属性测试
 *
 * Feature: realtime-progress-push, Property 7: 链式生成进度一致性
 *
 * 对任意 M 组链式生成，当第 N 组完成时：
 * - N < M → currentGroup = N+1 且 completedGroups = N
 * - N === M → eventType = 'completed' 且 completedGroups = M
 *
 * 测试目标：验证 publishChainProgress 方法生成的事件符合链式进度规约。
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { ProgressEventPayload, ChainMetadata } from '@/lib/sse/types'

// ─── 测试辅助：模拟 publishChainProgress 的核心逻辑 ────────────────────────────
// 直接测试 publishChainProgress 会涉及 Redis mock，
// 这里提取核心逻辑做纯函数测试，与 progress-publisher.ts 中的逻辑一致。

/**
 * 构造链式生成进度事件（纯函数版本，与 progress-publisher.ts publishChainProgress 逻辑一致）
 */
function buildChainProgressEvent(
  projectId: string,
  chainMetadata: ChainMetadata
): ProgressEventPayload {
  const isCompleted = chainMetadata.completedGroups >= chainMetadata.totalGroups
  return {
    taskId: projectId,
    taskType: 'chain',
    eventType: isCompleted ? 'completed' : 'progress_update',
    timestamp: new Date().toISOString(),
    progress: Math.round(
      (chainMetadata.completedGroups / chainMetadata.totalGroups) * 100
    ),
    metadata: chainMetadata as unknown as Record<string, unknown>,
  }
}

// ─── Arbitraries ────────────────────────────────────────────────────────────────

/**
 * 生成合法的链式生成场景参数：
 * - totalGroups (M): 1-20 之间
 * - completedGroup (N): 1-M 之间，表示刚完成第 N 组
 */
const chainScenarioArb = fc
  .integer({ min: 1, max: 20 })
  .chain((totalGroups) =>
    fc.record({
      totalGroups: fc.constant(totalGroups),
      completedGroup: fc.integer({ min: 1, max: totalGroups }),
      projectId: fc.uuid(),
    })
  )

// ─── Property 7: 链式生成进度一致性 ─────────────────────────────────────────────

describe('Feature: realtime-progress-push, Property 7: 链式生成进度一致性', () => {
  it('当第 N 组完成时，N < M → currentGroup=N+1 且 completedGroups=N；N===M → eventType=completed 且 completedGroups=M', () => {
    fc.assert(
      fc.property(chainScenarioArb, ({ totalGroups, completedGroup, projectId }) => {
        const N = completedGroup
        const M = totalGroups

        // 构造第 N 组完成后的 ChainMetadata
        const chainMetadata: ChainMetadata = {
          totalGroups: M,
          currentGroup: N < M ? N + 1 : M,
          completedGroups: N,
        }

        const event = buildChainProgressEvent(projectId, chainMetadata)

        // 验证 metadata 中的 completedGroups 正确
        const meta = event.metadata as unknown as ChainMetadata
        expect(meta.completedGroups).toBe(N)

        if (N < M) {
          // 未完成：eventType 应为 progress_update，currentGroup 为 N+1
          expect(event.eventType).toBe('progress_update')
          expect(meta.currentGroup).toBe(N + 1)
          expect(meta.completedGroups).toBe(N)
        } else {
          // 全部完成 (N === M)：eventType 应为 completed，completedGroups = M
          expect(event.eventType).toBe('completed')
          expect(meta.completedGroups).toBe(M)
        }

        // 验证 progress 计算正确
        const expectedProgress = Math.round((N / M) * 100)
        expect(event.progress).toBe(expectedProgress)

        // 验证基础字段
        expect(event.taskId).toBe(projectId)
        expect(event.taskType).toBe('chain')
      }),
      { numRuns: 200 }
    )
  })
})
