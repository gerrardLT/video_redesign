import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { canTransition, canCancel, canRetry, isTerminalState, getNextStates } from '@/lib/shared/state-machine'

/**
 * Feature: video-reshaping-mvp
 * Property 5: 任务状态机合法性
 *
 * **Validates: Requirements 12.1, 12.2, 12.3**
 *
 * 对任意状态序列：
 * - 只有合法转换才能通过 canTransition
 * - 终态不可再转换
 * - QUEUED/CREDIT_RESERVED 可取消
 * - 只有 FAILED 可重试
 * - 不存在自循环（from === to 时总返回 false）
 */

const ALL_STATES = [
  'CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED',
  'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'
]

const EXPECTED_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['QUEUED'],
  QUEUED: ['CREDIT_RESERVED', 'SUBMITTED', 'GENERATING', 'CANCELED', 'FAILED'],
  CREDIT_RESERVED: ['SUBMITTED', 'GENERATING', 'FAILED', 'CANCELED'],
  SUBMITTED: ['GENERATING', 'FAILED'],
  GENERATING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: ['QUEUED', 'GENERATING'],
  CANCELED: [],
  REFUNDED: [],
}

describe('任务状态机 Property', () => {
  it('canTransition 应与预定义转换表一致', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        fc.constantFrom(...ALL_STATES),
        (from, to) => {
          const expected = EXPECTED_TRANSITIONS[from]?.includes(to) ?? false
          expect(canTransition(from, to)).toBe(expected)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('终态不可再转换到任何状态', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SUCCEEDED', 'CANCELED', 'REFUNDED'),
        fc.constantFrom(...ALL_STATES),
        (terminalState, anyState) => {
          expect(canTransition(terminalState, anyState)).toBe(false)
          expect(isTerminalState(terminalState)).toBe(true)
          expect(getNextStates(terminalState)).toHaveLength(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('不存在自循环', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        (state) => {
          expect(canTransition(state, state)).toBe(false)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('canCancel 仅在 QUEUED 和 CREDIT_RESERVED 时为 true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        (state) => {
          const expected = state === 'QUEUED' || state === 'CREDIT_RESERVED'
          expect(canCancel(state)).toBe(expected)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('canRetry 仅在 FAILED 时为 true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        (state) => {
          const expected = state === 'FAILED'
          expect(canRetry(state)).toBe(expected)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('非终态应至少有一个合法后继状态', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES.filter(s => !['SUCCEEDED', 'CANCELED', 'REFUNDED'].includes(s))),
        (state) => {
          const nextStates = getNextStates(state)
          expect(nextStates.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('FAILED 可重试回 QUEUED（用户重试），或恢复到 GENERATING（Worker 恢复轮询）', () => {
    // FAILED 的合法后继：QUEUED（用户重试）+ GENERATING（重试恢复已创建的 Seedance 任务）
    const failedNextStates = getNextStates('FAILED')
    expect(failedNextStates).toEqual(['QUEUED', 'GENERATING'])
    // 用户重试路径仍为 FAILED → QUEUED
    expect(canTransition('FAILED', 'QUEUED')).toBe(true)
  })
})
