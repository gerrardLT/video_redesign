/**
 * 单元测试：frame-continuity 外观集成
 *
 * 验证承接阶段中外观比对对承接决策的影响：
 * - 同场景+共有角色外观差异 → hasGroupAppearanceChanged 返回 true → 应跳过承接
 * - 同场景+共有角色外观一致 → hasGroupAppearanceChanged 返回 false → 不影响承接
 * - 无共有角色 → hasGroupAppearanceChanged 返回 false → 不影响承接
 * - characterAppearances 为空数组 → aggregateGroupAppearances 返回空 Map → 不影响承接
 * - characterAppearances JSON 无效 → 应被安全解析为空数组不报错
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import { describe, it, expect } from 'vitest'
import {
  hasGroupAppearanceChanged,
  aggregateGroupAppearances,
} from '@/lib/appearance-comparator'
import type { AppearanceDescriptor, CharacterAppearanceRecord } from '@/types/appearance'

// ========================
// 辅助：复刻 parseCharacterAppearances 逻辑
// （frame-continuity.ts 中该函数未导出，此处复刻其核心逻辑以测试 JSON 解析行为）
// ========================
function parseCharacterAppearances(json: string | null | undefined): CharacterAppearanceRecord {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed as CharacterAppearanceRecord
  } catch {
    // JSON 解析失败时视为空数组，不阻塞承接逻辑
    return []
  }
}

// ========================
// 辅助：模拟承接判定场景的完整组合逻辑
// （模拟 checkGroupAppearanceChanged 的数据输入流程）
// ========================
function simulateCheckGroupAppearanceChanged(
  prevShotsJson: Array<string | null>,
  currentShotsJson: Array<string | null>
): boolean {
  // 步骤1: 解析前一组的外观数据
  const prevShotAppearances = prevShotsJson
    .map(json => parseCharacterAppearances(json))
    .filter(records => records.length > 0)

  // 步骤2: 解析当前组的外观数据
  const currentShotAppearances = currentShotsJson
    .map(json => parseCharacterAppearances(json))
    .filter(records => records.length > 0)

  // 步骤3: 任一组无外观数据时，不影响承接决策
  if (prevShotAppearances.length === 0 || currentShotAppearances.length === 0) {
    return false
  }

  // 步骤4: 聚合两组的角色外观 Map（按维度取众数）
  const prevMap = aggregateGroupAppearances(prevShotAppearances)
  const currentMap = aggregateGroupAppearances(currentShotAppearances)

  // 步骤5: 判定是否存在外观变化（无共有角色时返回 false）
  return hasGroupAppearanceChanged(prevMap, currentMap)
}

// ========================
// 测试：同场景 + 共有角色外观差异 → 应跳过承接
// ========================
describe('同场景+外观差异时应跳过承接 (applied=false)', () => {
  it('共有角色发型变化时 hasGroupAppearanceChanged 返回 true', () => {
    // 前一组：主角黑色短发
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])
    // 当前组：主角金色长发（发型变了）
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '金色长发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(true)
  })

  it('共有角色服装变化时 hasGroupAppearanceChanged 返回 true', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['女主', { hair: '棕色卷发', clothing: '红色连衣裙', accessories: '珍珠项链', makeup: '淡妆' }],
    ])
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['女主', { hair: '棕色卷发', clothing: '黑色西装', accessories: '珍珠项链', makeup: '淡妆' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(true)
  })

  it('多个共有角色中任一角色外观差异即返回 true', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色衬衫', accessories: '', makeup: '' }],
      ['女主', { hair: '棕色长发', clothing: '蓝色裙子', accessories: '', makeup: '' }],
    ])
    // 主角外观一致，女主服装变了
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色衬衫', accessories: '', makeup: '' }],
      ['女主', { hair: '棕色长发', clothing: '红色外套', accessories: '', makeup: '' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(true)
  })

  it('通过完整 JSON 解析流程模拟：共有角色外观差异 → 应跳过承接', () => {
    // 模拟前一组 Shot 数据（JSON 序列化形式）
    const prevShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' } },
      ]),
    ]
    // 模拟当前组 Shot 数据（主角换了衣服）
    const currentShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '红色卫衣', accessories: '', makeup: '' } },
      ]),
    ]

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // 外观变化 → 应跳过承接
    expect(changed).toBe(true)
  })
})

// ========================
// 测试：同场景 + 共有角色外观一致 → 不影响承接
// ========================
describe('同场景+外观一致时按原逻辑承接', () => {
  it('所有共有角色外观完全一致时 hasGroupAppearanceChanged 返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '黑框眼镜', makeup: '' }],
    ])
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '黑框眼镜', makeup: '' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('外观一致但文本有大小写和标点差异时仍判定为一致（规范化后相同）', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发。', clothing: '白色T恤！', accessories: '', makeup: '' }],
    ])
    // 去掉标点后与前组相同
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('多个共有角色全部外观一致时返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '蓝色西装', accessories: '', makeup: '' }],
      ['女主', { hair: '红色长发', clothing: '白色连衣裙', accessories: '耳环', makeup: '浓妆' }],
    ])
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '蓝色西装', accessories: '', makeup: '' }],
      ['女主', { hair: '红色长发', clothing: '白色连衣裙', accessories: '耳环', makeup: '浓妆' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('通过完整 JSON 解析流程模拟：外观一致 → 不影响承接', () => {
    const prevShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色衬衫', accessories: '', makeup: '' } },
      ]),
    ]
    const currentShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色衬衫', accessories: '', makeup: '' } },
      ]),
    ]

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // 外观一致 → 不影响承接
    expect(changed).toBe(false)
  })
})

// ========================
// 测试：无共有角色时不影响承接
// ========================
describe('无共有角色时不影响承接', () => {
  it('两组角色完全不同时 hasGroupAppearanceChanged 返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['角色A', { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['角色B', { hair: '金色长发', clothing: '红色裙子', accessories: '项链', makeup: '浓妆' }],
    ])

    // 无共有角色 → 返回 false，不影响承接
    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('前组有角色、当前组为空 Map 时返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])
    const currentMap = new Map<string, AppearanceDescriptor>()

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('前组为空 Map、当前组有角色时返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>()
    const currentMap = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' }],
    ])

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('两组均为空 Map 时返回 false', () => {
    const prevMap = new Map<string, AppearanceDescriptor>()
    const currentMap = new Map<string, AppearanceDescriptor>()

    expect(hasGroupAppearanceChanged(prevMap, currentMap)).toBe(false)
  })

  it('通过完整 JSON 解析流程模拟：无共有角色 → 不影响承接', () => {
    const prevShotsJson = [
      JSON.stringify([
        { name: '角色A', appearance: { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' } },
      ]),
    ]
    const currentShotsJson = [
      JSON.stringify([
        { name: '角色B', appearance: { hair: '金色长发', clothing: '红色外套', accessories: '', makeup: '' } },
      ]),
    ]

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // 无共有角色 → 不影响承接
    expect(changed).toBe(false)
  })
})

// ========================
// 测试：characterAppearances 为空时不影响承接
// ========================
describe('characterAppearances 为空时不影响承接', () => {
  it('aggregateGroupAppearances 输入空数组时返回空 Map', () => {
    const result = aggregateGroupAppearances([])
    expect(result.size).toBe(0)
  })

  it('两组均无外观数据时 simulateCheckGroupAppearanceChanged 返回 false', () => {
    // 模拟两组的 Shot 均无 characterAppearances（null）
    const prevShotsJson: Array<string | null> = [null, null]
    const currentShotsJson: Array<string | null> = [null, null]

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    expect(changed).toBe(false)
  })

  it('前组有外观数据、当前组 characterAppearances 为空数组 JSON 时返回 false', () => {
    const prevShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' } },
      ]),
    ]
    // 当前组的 characterAppearances 为空数组
    const currentShotsJson = ['[]']

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // 当前组无外观数据 → 不影响承接
    expect(changed).toBe(false)
  })

  it('前组 characterAppearances 为空数组 JSON、当前组有外观数据时返回 false', () => {
    const prevShotsJson = ['[]']
    const currentShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' } },
      ]),
    ]

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // 前组无外观数据 → 不影响承接
    expect(changed).toBe(false)
  })

  it('两组的 characterAppearances 均为空数组 JSON 时返回 false', () => {
    const prevShotsJson = ['[]', '[]']
    const currentShotsJson = ['[]', '[]']

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    expect(changed).toBe(false)
  })
})

// ========================
// 测试：characterAppearances JSON 无效时应被安全解析为空数组不报错
// ========================
describe('characterAppearances JSON 无效时安全降级', () => {
  it('无效 JSON 字符串解析为空数组不抛错', () => {
    expect(() => parseCharacterAppearances('这不是合法JSON{')).not.toThrow()
    expect(parseCharacterAppearances('这不是合法JSON{')).toEqual([])
  })

  it('null 值解析为空数组', () => {
    expect(parseCharacterAppearances(null)).toEqual([])
  })

  it('undefined 值解析为空数组', () => {
    expect(parseCharacterAppearances(undefined)).toEqual([])
  })

  it('空字符串解析为空数组', () => {
    expect(parseCharacterAppearances('')).toEqual([])
  })

  it('JSON 为对象而非数组时解析为空数组', () => {
    // 数据库中存储了错误格式的 JSON（对象而非数组）
    expect(parseCharacterAppearances('{"name":"主角"}')).toEqual([])
  })

  it('JSON 为数字时解析为空数组', () => {
    expect(parseCharacterAppearances('123')).toEqual([])
  })

  it('JSON 为字符串时解析为空数组', () => {
    expect(parseCharacterAppearances('"hello"')).toEqual([])
  })

  it('无效 JSON 不影响承接判定流程（完整流程模拟）', () => {
    // 前组有合法外观数据
    const prevShotsJson = [
      JSON.stringify([
        { name: '主角', appearance: { hair: '黑色短发', clothing: '白色T恤', accessories: '', makeup: '' } },
      ]),
    ]
    // 当前组 JSON 损坏
    const currentShotsJson = ['invalid json {{{']

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    // JSON 无效 → 解析为空数组 → 当前组无外观数据 → 不影响承接
    expect(changed).toBe(false)
  })

  it('两组均为无效 JSON 时不影响承接判定', () => {
    const prevShotsJson = ['corrupted data!!!']
    const currentShotsJson = ['{not valid}']

    const changed = simulateCheckGroupAppearanceChanged(prevShotsJson, currentShotsJson)
    expect(changed).toBe(false)
  })
})
