/**
 * ContentBrief 状态机单元测试
 *
 * 测试范围：
 * - canBriefTransition：合法/非法状态转换
 * - assertBriefTransition：非法转换抛错
 * - canRetryRender：仅 FAILED 可重试
 * - getNextBriefStates：返回合法下一状态
 * - isBriefTerminalState：终态判断
 */

import { describe, it, expect } from 'vitest'
import {
  canBriefTransition,
  assertBriefTransition,
  canRetryRender,
  getNextBriefStates,
  isBriefTerminalState,
} from '@/lib/merchant/content-brief-state-machine'

// ========================
// canBriefTransition
// ========================

describe('canBriefTransition', () => {
  it('DRAFT → READY_TO_SHOOT 合法', () => {
    expect(canBriefTransition('DRAFT', 'READY_TO_SHOOT')).toBe(true)
  })

  it('DRAFT → RENDERING 合法（AUTO 模式）', () => {
    expect(canBriefTransition('DRAFT', 'RENDERING')).toBe(true)
  })

  it('READY_TO_SHOOT → MATERIALS_UPLOADED 合法', () => {
    expect(canBriefTransition('READY_TO_SHOOT', 'MATERIALS_UPLOADED')).toBe(true)
  })

  it('READY_TO_SHOOT → RENDERING 合法（AUTO 模式跳过上传）', () => {
    expect(canBriefTransition('READY_TO_SHOOT', 'RENDERING')).toBe(true)
  })

  it('MATERIALS_UPLOADED → RENDERING 合法', () => {
    expect(canBriefTransition('MATERIALS_UPLOADED', 'RENDERING')).toBe(true)
  })

  it('RENDERING → GENERATED 合法', () => {
    expect(canBriefTransition('RENDERING', 'GENERATED')).toBe(true)
  })

  it('RENDERING → FAILED 合法', () => {
    expect(canBriefTransition('RENDERING', 'FAILED')).toBe(true)
  })

  it('GENERATED → COMPLIANCE_REVIEW 合法', () => {
    expect(canBriefTransition('GENERATED', 'COMPLIANCE_REVIEW')).toBe(true)
  })

  it('GENERATED → READY_TO_EXPORT 合法', () => {
    expect(canBriefTransition('GENERATED', 'READY_TO_EXPORT')).toBe(true)
  })

  it('FAILED → MATERIALS_UPLOADED 合法（重试）', () => {
    expect(canBriefTransition('FAILED', 'MATERIALS_UPLOADED')).toBe(true)
  })

  it('FAILED → READY_TO_SHOOT 合法（重试）', () => {
    expect(canBriefTransition('FAILED', 'READY_TO_SHOOT')).toBe(true)
  })

  it('EXPORTED → PUBLISHED 合法', () => {
    expect(canBriefTransition('EXPORTED', 'PUBLISHED')).toBe(true)
  })

  it('EXPORTED → ARCHIVED 合法', () => {
    expect(canBriefTransition('EXPORTED', 'ARCHIVED')).toBe(true)
  })

  it('PUBLISHED → ARCHIVED 合法', () => {
    expect(canBriefTransition('PUBLISHED', 'ARCHIVED')).toBe(true)
  })

  // 非法转换
  it('ARCHIVED → 任何状态均非法（终态）', () => {
    expect(canBriefTransition('ARCHIVED', 'DRAFT')).toBe(false)
    expect(canBriefTransition('ARCHIVED', 'RENDERING')).toBe(false)
    expect(canBriefTransition('ARCHIVED', 'EXPORTED')).toBe(false)
  })

  it('DRAFT → GENERATED 非法（跳过中间状态）', () => {
    expect(canBriefTransition('DRAFT', 'GENERATED')).toBe(false)
  })

  it('DRAFT → EXPORTED 非法', () => {
    expect(canBriefTransition('DRAFT', 'EXPORTED')).toBe(false)
  })

  it('RENDERING → READY_TO_SHOOT 非法（不能回退）', () => {
    expect(canBriefTransition('RENDERING', 'READY_TO_SHOOT')).toBe(false)
  })

  it('GENERATED → DRAFT 非法', () => {
    expect(canBriefTransition('GENERATED', 'DRAFT')).toBe(false)
  })

  it('未知状态返回 false', () => {
    expect(canBriefTransition('UNKNOWN_STATUS', 'DRAFT')).toBe(false)
    expect(canBriefTransition('DRAFT', 'UNKNOWN_STATUS')).toBe(false)
  })
})

// ========================
// assertBriefTransition
// ========================

describe('assertBriefTransition', () => {
  it('合法转换不抛错', () => {
    expect(() => assertBriefTransition('DRAFT', 'READY_TO_SHOOT')).not.toThrow()
    expect(() => assertBriefTransition('RENDERING', 'GENERATED')).not.toThrow()
  })

  it('非法转换抛错', () => {
    expect(() => assertBriefTransition('ARCHIVED', 'DRAFT')).toThrow(/非法状态转换/)
    expect(() => assertBriefTransition('DRAFT', 'GENERATED')).toThrow(/非法状态转换/)
  })

  it('错误消息包含 from 和 to', () => {
    expect(() => assertBriefTransition('RENDERING', 'DRAFT')).toThrow('RENDERING → DRAFT')
  })
})

// ========================
// canRetryRender
// ========================

describe('canRetryRender', () => {
  it('FAILED 可重试', () => {
    expect(canRetryRender('FAILED')).toBe(true)
  })

  it('其它状态不可重试', () => {
    expect(canRetryRender('DRAFT')).toBe(false)
    expect(canRetryRender('RENDERING')).toBe(false)
    expect(canRetryRender('GENERATED')).toBe(false)
    expect(canRetryRender('ARCHIVED')).toBe(false)
  })
})

// ========================
// getNextBriefStates
// ========================

describe('getNextBriefStates', () => {
  it('DRAFT 的合法下一状态', () => {
    const next = getNextBriefStates('DRAFT')
    expect(next).toContain('READY_TO_SHOOT')
    expect(next).toContain('RENDERING')
    expect(next).toHaveLength(2)
  })

  it('RENDERING 的合法下一状态', () => {
    const next = getNextBriefStates('RENDERING')
    expect(next).toContain('GENERATED')
    expect(next).toContain('FAILED')
    expect(next).toHaveLength(2)
  })

  it('ARCHIVED 无合法下一状态', () => {
    expect(getNextBriefStates('ARCHIVED')).toEqual([])
  })

  it('未知状态返回空数组', () => {
    expect(getNextBriefStates('NONEXISTENT')).toEqual([])
  })
})

// ========================
// isBriefTerminalState
// ========================

describe('isBriefTerminalState', () => {
  it('ARCHIVED 为终态', () => {
    expect(isBriefTerminalState('ARCHIVED')).toBe(true)
  })

  it('其它状态非终态', () => {
    expect(isBriefTerminalState('DRAFT')).toBe(false)
    expect(isBriefTerminalState('GENERATED')).toBe(false)
    expect(isBriefTerminalState('FAILED')).toBe(false)
    expect(isBriefTerminalState('EXPORTED')).toBe(false)
  })
})
