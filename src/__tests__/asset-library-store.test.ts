import { describe, it, expect, beforeEach } from 'vitest'
import { useAssetLibraryStore } from '../stores/asset-library-store'

describe('AssetLibraryStore', () => {
  beforeEach(() => {
    useAssetLibraryStore.getState().reset()
  })

  it('should have correct initial state', () => {
    const state = useAssetLibraryStore.getState()
    expect(state.category).toBeNull()
    expect(state.keyword).toBe('')
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(20)
  })

  it('setCategory should update category and reset page to 1', () => {
    // 先切到第 3 页
    useAssetLibraryStore.getState().setPage(3)
    expect(useAssetLibraryStore.getState().page).toBe(3)

    // 切换分类时 page 应重置为 1
    useAssetLibraryStore.getState().setCategory('CHARACTER')
    const state = useAssetLibraryStore.getState()
    expect(state.category).toBe('CHARACTER')
    expect(state.page).toBe(1)
  })

  it('setCategory with null should clear category filter', () => {
    useAssetLibraryStore.getState().setCategory('AUDIO')
    useAssetLibraryStore.getState().setCategory(null)
    expect(useAssetLibraryStore.getState().category).toBeNull()
  })

  it('setKeyword should update keyword and reset page to 1', () => {
    useAssetLibraryStore.getState().setPage(5)
    useAssetLibraryStore.getState().setKeyword('角色')
    const state = useAssetLibraryStore.getState()
    expect(state.keyword).toBe('角色')
    expect(state.page).toBe(1)
  })

  it('setPage should update page without affecting other fields', () => {
    useAssetLibraryStore.getState().setCategory('MATERIAL')
    useAssetLibraryStore.getState().setKeyword('test')
    useAssetLibraryStore.getState().setPage(4)

    const state = useAssetLibraryStore.getState()
    expect(state.page).toBe(4)
    expect(state.category).toBe('MATERIAL')
    expect(state.keyword).toBe('test')
  })

  it('reset should restore all fields to initial defaults', () => {
    useAssetLibraryStore.getState().setCategory('AUDIO')
    useAssetLibraryStore.getState().setKeyword('some keyword')
    useAssetLibraryStore.getState().setPage(10)

    useAssetLibraryStore.getState().reset()
    const state = useAssetLibraryStore.getState()
    expect(state.category).toBeNull()
    expect(state.keyword).toBe('')
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(20)
  })
})
