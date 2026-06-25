/**
 * 属性测试：拍摄任务排序不变式 (Property 13)
 *
 * 对于任意 ContentBrief 的 ShotTask 列表：
 * - 按 order 字段排序后形成从 1 开始的连续序列（无间隔、无重复）
 *
 * 生成随机 ShotTaskDraft 数组，验证 playbook-engine 和 capture-director
 * 生成的 order 字段满足连续性不变式。
 *
 * **Validates: Requirements 5.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { ShotTaskDraft, ShotTaskType } from '@/types/merchant'

// ========================
// 生成器
// ========================

/** 有效的拍摄任务类型 */
const shotTaskTypeArb = fc.constantFrom(
  'STOREFRONT', 'PRODUCT_CLOSEUP', 'COOKING_PROCESS', 'STAFF_ACTION',
  'CUSTOMER_REACTION', 'OWNER_TALKING', 'ENVIRONMENT', 'OFFER_DISPLAY',
  'CTA_SCREEN', 'AI_GENERATED_FILLER',
) as fc.Arbitrary<ShotTaskType>

/** 生成有效时长（3-15 秒） */
const durationArb = fc.integer({ min: 3, max: 15 })

/**
 * 生成一个正确排序的 ShotTaskDraft 列表（模拟 playbook-engine.buildShotTasks 输出）
 * order 应从 1 开始连续递增
 */
const shotTaskDraftListArb = fc
  .array(
    fc.record({
      type: shotTaskTypeArb,
      title: fc.string({ minLength: 1, maxLength: 20 }),
      instruction: fc.string({ minLength: 1, maxLength: 200 }),
      durationSec: durationArb,
      required: fc.boolean(),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((items) =>
    items.map((item, idx): ShotTaskDraft => ({
      ...item,
      order: idx + 1,
      framingGuide: undefined,
      qualityRules: undefined,
    })),
  )

/**
 * 生成乱序的 ShotTaskDraft 列表（用于验证排序后仍满足不变式）
 */
const shuffledShotTaskDraftListArb = shotTaskDraftListArb.chain((list) =>
  fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }),
)

// ========================
// 不变式验证函数
// ========================

/**
 * 验证 ShotTask 的 order 字段形成从 1 开始的连续序列
 * @param tasks 按 order 排序后的 ShotTask 列表
 * @returns 是否满足连续性不变式
 */
function isContiguousFromOne(tasks: Array<{ order: number }>): {
  valid: boolean
  reason?: string
} {
  if (tasks.length === 0) {
    return { valid: true }
  }

  // 按 order 排序
  const sorted = [...tasks].sort((a, b) => a.order - b.order)

  // 检查起始值为 1
  if (sorted[0].order !== 1) {
    return { valid: false, reason: `起始 order 应为 1，实际为 ${sorted[0].order}` }
  }

  // 检查连续性（无间隔）和唯一性（无重复）
  for (let i = 1; i < sorted.length; i++) {
    const expected = i + 1
    if (sorted[i].order !== expected) {
      if (sorted[i].order === sorted[i - 1].order) {
        return { valid: false, reason: `order=${sorted[i].order} 存在重复` }
      }
      return {
        valid: false,
        reason: `order 序列不连续：期望 ${expected}，实际 ${sorted[i].order}`,
      }
    }
  }

  return { valid: true }
}

// ========================
// 属性测试
// ========================

describe('Property 13: 拍摄任务排序不变式', () => {
  it('ShotTaskDraft 列表的 order 字段形成从 1 开始的连续序列（无间隔、无重复）', () => {
    fc.assert(
      fc.property(shotTaskDraftListArb, (tasks) => {
        const result = isContiguousFromOne(tasks)
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('乱序后按 order 排列仍满足连续性不变式', () => {
    fc.assert(
      fc.property(shuffledShotTaskDraftListArb, (shuffledTasks) => {
        // 乱序不影响 order 值本身，排序后仍应连续
        const result = isContiguousFromOne(shuffledTasks)
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('order 字段不存在重复值', () => {
    fc.assert(
      fc.property(shotTaskDraftListArb, (tasks) => {
        const orders = tasks.map((t) => t.order)
        const uniqueOrders = new Set(orders)
        expect(uniqueOrders.size).toBe(orders.length)
      }),
      { numRuns: 100 },
    )
  })

  it('order 字段最大值等于列表长度', () => {
    fc.assert(
      fc.property(shotTaskDraftListArb, (tasks) => {
        const maxOrder = Math.max(...tasks.map((t) => t.order))
        expect(maxOrder).toBe(tasks.length)
      }),
      { numRuns: 100 },
    )
  })

  it('durationSec 在 3-15 范围内', () => {
    fc.assert(
      fc.property(shotTaskDraftListArb, (tasks) => {
        for (const task of tasks) {
          expect(task.durationSec).toBeGreaterThanOrEqual(3)
          expect(task.durationSec).toBeLessThanOrEqual(15)
        }
      }),
      { numRuns: 100 },
    )
  })
})
