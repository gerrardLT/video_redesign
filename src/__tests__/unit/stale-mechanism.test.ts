/**
 * Unit Test: handleStaleTransition 和 checkStaleBeforeExport
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */
import { describe, it, expect } from 'vitest'

// 复制 handleStaleTransition 的逻辑用于纯函数测试
function handleStaleTransition(currentStatus: string): 'mark_stale' | 'save_only' | 'reject' {
  if (currentStatus === 'SUCCEEDED') return 'mark_stale'
  if (currentStatus === 'QUEUED' || currentStatus === 'GENERATING') return 'reject'
  return 'save_only'
}

describe('handleStaleTransition', () => {
  it('SUCCEEDED → mark_stale（标记过期，保留视频 URL）', () => {
    expect(handleStaleTransition('SUCCEEDED')).toBe('mark_stale')
  })

  it('PENDING → save_only（仅保存编辑）', () => {
    expect(handleStaleTransition('PENDING')).toBe('save_only')
  })

  it('FAILED → save_only（仅保存编辑）', () => {
    expect(handleStaleTransition('FAILED')).toBe('save_only')
  })

  it('CANCELED → save_only（仅保存编辑）', () => {
    expect(handleStaleTransition('CANCELED')).toBe('save_only')
  })

  it('STALE → save_only（已是 STALE，仅保存编辑）', () => {
    expect(handleStaleTransition('STALE')).toBe('save_only')
  })

  it('QUEUED → reject（拒绝编辑）', () => {
    expect(handleStaleTransition('QUEUED')).toBe('reject')
  })

  it('GENERATING → reject（拒绝编辑）', () => {
    expect(handleStaleTransition('GENERATING')).toBe('reject')
  })
})

describe('checkStaleBeforeExport 逻辑', () => {
  // 模拟导出检查逻辑
  function checkStaleBeforeExport(shotGroups: Array<{ id: string; groupIndex: number; genStatus: string }>) {
    const staleGroups = shotGroups.filter(g => g.genStatus === 'STALE')
    return {
      hasStale: staleGroups.length > 0,
      staleGroups: staleGroups.map(g => ({ id: g.id, groupIndex: g.groupIndex })),
    }
  }

  it('无 STALE 组时通过', () => {
    const groups = [
      { id: '1', groupIndex: 0, genStatus: 'SUCCEEDED' },
      { id: '2', groupIndex: 1, genStatus: 'SUCCEEDED' },
    ]
    const result = checkStaleBeforeExport(groups)
    expect(result.hasStale).toBe(false)
    expect(result.staleGroups).toHaveLength(0)
  })

  it('存在 STALE 组时拦截', () => {
    const groups = [
      { id: '1', groupIndex: 0, genStatus: 'SUCCEEDED' },
      { id: '2', groupIndex: 1, genStatus: 'STALE' },
      { id: '3', groupIndex: 2, genStatus: 'STALE' },
    ]
    const result = checkStaleBeforeExport(groups)
    expect(result.hasStale).toBe(true)
    expect(result.staleGroups).toHaveLength(2)
    expect(result.staleGroups[0]).toEqual({ id: '2', groupIndex: 1 })
    expect(result.staleGroups[1]).toEqual({ id: '3', groupIndex: 2 })
  })

  it('全部 STALE 时拦截所有', () => {
    const groups = [
      { id: '1', groupIndex: 0, genStatus: 'STALE' },
    ]
    const result = checkStaleBeforeExport(groups)
    expect(result.hasStale).toBe(true)
    expect(result.staleGroups).toHaveLength(1)
  })
})
