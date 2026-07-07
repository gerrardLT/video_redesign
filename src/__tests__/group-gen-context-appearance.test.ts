/**
 * 单元测试：group-gen-context 外观集成
 *
 * 验证 group-gen-context.ts 中外观感知增强逻辑：
 * - 外观差异时 prompt 包含「本镜头中{角色名}的造型：」格式文案
 * - 外观一致时 prompt 不包含外观文案
 * - characterAppearances JSON 解析失败时正常降级（不抛错）
 *
 * 由于 buildGroupGenReference 依赖 Prisma DB，本测试直接测试其核心决策逻辑：
 * 即 aggregateGroupAppearances + normalizeAppearanceText + formatAppearancePrompt 的组合行为，
 * 模拟 group-gen-context.ts 中外观追加到 characterPrefix 的完整流程。
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import { describe, it, expect } from 'vitest'
import {
  aggregateGroupAppearances,
  normalizeAppearanceText,
  formatAppearancePrompt,
} from '@/lib/video/appearance-comparator'
import type { AppearanceDescriptor, CharacterAppearanceRecord } from '@/types/appearance'

// ========================
// 辅助：复刻 group-gen-context.ts 中外观追加到 characterPrefix 的核心决策逻辑
// 这段逻辑与 buildGroupGenReference 中外观增强部分完全对应
// ========================

interface CharacterInfo {
  name: string
  /** 全局 Character.appearance 文本 */
  appearance: string
}

/**
 * 模拟 group-gen-context.ts 中读取组内 shots 的 characterAppearances 并解析 JSON。
 * JSON 解析失败时视为空数组继续，不抛错。
 */
function parseShotAppearancesRaw(
  shotCharacterAppearancesJsons: (string | null | undefined)[]
): CharacterAppearanceRecord[] {
  const result: CharacterAppearanceRecord[] = []
  for (const json of shotCharacterAppearancesJsons) {
    if (!json) continue
    try {
      const parsed = JSON.parse(json) as CharacterAppearanceRecord
      if (Array.isArray(parsed)) {
        result.push(parsed)
      }
    } catch {
      // JSON 解析失败时视为空数组继续（与 group-gen-context.ts 行为一致）
    }
  }
  return result
}

/**
 * 模拟 group-gen-context.ts 中外观追加到 characterPrefix 的完整决策逻辑。
 * 逻辑完全对应 buildGroupGenReference 中「外观感知增强」代码段。
 */
function buildAppearancePromptSuffix(
  shotAppearancesRaw: CharacterAppearanceRecord[],
  characters: CharacterInfo[]
): string {
  let suffix = ''

  if (shotAppearancesRaw.length === 0) {
    return suffix
  }

  // 聚合组级代表外观
  const groupAppearanceMap = aggregateGroupAppearances(
    shotAppearancesRaw.map((record) =>
      record.map((item) => ({ name: item.name, appearance: item.appearance }))
    )
  )

  // 遍历每个角色，比对全局外观
  for (const [charName, groupAppearance] of groupAppearanceMap) {
    const globalChar = characters.find((c) => c.name === charName)
    const globalAppearanceText = globalChar?.appearance?.trim() ?? ''

    // 将组级聚合外观四个维度非空值拼接
    const groupDimensions = [
      groupAppearance.hair,
      groupAppearance.clothing,
      groupAppearance.accessories,
      groupAppearance.makeup,
    ].filter((v) => v.trim() !== '')

    if (groupDimensions.length === 0) {
      continue
    }

    const groupAppearanceText = groupDimensions.join('、')

    // 规范化后比较
    const normalizedGlobal = normalizeAppearanceText(globalAppearanceText)
    const normalizedGroup = normalizeAppearanceText(groupAppearanceText)

    // 一致时跳过追加
    if (normalizedGlobal === normalizedGroup) {
      continue
    }

    // 差异时追加
    const appearancePrompt = formatAppearancePrompt(charName, groupAppearance)
    if (appearancePrompt) {
      suffix += appearancePrompt
    }
  }

  return suffix
}

// ========================
// 测试：外观差异时 prompt 包含正确格式文案
// ========================
describe('group-gen-context 外观差异追加', () => {
  it('角色外观与全局 appearance 不同时，prompt 包含「本镜头中{角色名}的造型：」格式文案', () => {
    // 模拟组内 shot 的 characterAppearances 数据
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '金色短发',
            clothing: '黑色皮衣',
            accessories: '墨镜',
            makeup: '',
          },
        },
      ],
    ]

    // 全局角色外观（与组内不同）
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色长发、白色衬衫' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    // 验证包含正确格式
    expect(result).toContain('本镜头中主角的造型：')
    expect(result).toContain('金色短发')
    expect(result).toContain('黑色皮衣')
    expect(result).toContain('墨镜')
  })

  it('多角色存在外观差异时，每个有差异的角色都追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '红色马尾',
            clothing: '运动装',
            accessories: '',
            makeup: '',
          },
        },
        {
          name: '女主',
          appearance: {
            hair: '黑色短发',
            clothing: '蓝色连衣裙',
            accessories: '银色项链',
            makeup: '浓妆',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色长发、白色衬衫' },
      { name: '女主', appearance: '棕色长发、红色外套' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toContain('本镜头中主角的造型：')
    expect(result).toContain('本镜头中女主的造型：')
  })

  it('全局 appearance 为空时视为差异，追加外观文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '新角色',
          appearance: {
            hair: '白色长发',
            clothing: '和服',
            accessories: '扇子',
            makeup: '歌舞伎妆',
          },
        },
      ],
    ]

    // 全局无该角色信息
    const characters: CharacterInfo[] = []

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toContain('本镜头中新角色的造型：')
    expect(result).toContain('白色长发')
  })

  it('全局 appearance 存在但内容完全不同时追加外观文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '光头',
            clothing: '僧袍',
            accessories: '念珠',
            makeup: '',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色长发、西装革履、金表' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toContain('本镜头中主角的造型：')
    expect(result).toContain('光头')
    expect(result).toContain('僧袍')
    expect(result).toContain('念珠')
  })
})

// ========================
// 测试：外观一致时 prompt 不包含外观文案
// ========================
describe('group-gen-context 外观一致跳过', () => {
  it('规范化后全局外观与组外观完全一致时，不追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '黑色短发',
            clothing: '白色衬衫',
            accessories: '',
            makeup: '',
          },
        },
      ],
    ]

    // 全局外观与组外观内容一致（规范化后相同）
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、白色衬衫' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toBe('')
  })

  it('仅标点/空白差异时（规范化后一致），不追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '黑色短发。',
            clothing: '白色衬衫，',
            accessories: '',
            makeup: '',
          },
        },
      ],
    ]

    // 全局外观含不同标点但规范化后内容一致
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、白色衬衫' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toBe('')
  })

  it('大小写差异的英文描述规范化后一致时，不追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: 'Alex',
          appearance: {
            hair: 'Blonde Short Hair',
            clothing: 'White Shirt',
            accessories: '',
            makeup: '',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: 'Alex', appearance: 'blonde short hair、white shirt' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toBe('')
  })

  it('组外观所有维度均为空字符串时，不追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '',
            clothing: '',
            accessories: '',
            makeup: '',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色长发、白色衬衫' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toBe('')
  })

  it('多角色全部一致时，不追加任何文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '黑色短发',
            clothing: '白衬衫',
            accessories: '',
            makeup: '',
          },
        },
        {
          name: '女主',
          appearance: {
            hair: '棕色卷发',
            clothing: '红裙',
            accessories: '',
            makeup: '淡妆',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、白衬衫' },
      { name: '女主', appearance: '棕色卷发、红裙、淡妆' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toBe('')
  })

  it('部分角色一致部分差异时，仅差异角色追加文案', () => {
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [
        {
          name: '主角',
          appearance: {
            hair: '黑色短发',
            clothing: '白衬衫',
            accessories: '',
            makeup: '',
          },
        },
        {
          name: '女主',
          appearance: {
            hair: '金色长发',
            clothing: '黑色礼服',
            accessories: '钻石项链',
            makeup: '浓妆',
          },
        },
      ],
    ]

    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、白衬衫' },
      { name: '女主', appearance: '棕色卷发、红裙、淡妆' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    // 主角一致，不追加
    expect(result).not.toContain('本镜头中主角的造型：')
    // 女主差异，追加
    expect(result).toContain('本镜头中女主的造型：')
    expect(result).toContain('金色长发')
  })
})

// ========================
// 测试：characterAppearances JSON 解析失败时正常降级
// ========================
describe('group-gen-context JSON 解析降级', () => {
  it('JSON 格式完全无效时不抛错，返回空字符串', () => {
    const invalidJsons = [
      '这不是JSON',
      '{invalid json!!!}',
      'undefined',
      '{"broken": }',
    ]

    const parsed = parseShotAppearancesRaw(invalidJsons)

    // 所有无效 JSON 被忽略，返回空数组
    expect(parsed).toEqual([])

    // 空数据代入决策逻辑不追加任何文案
    const result = buildAppearancePromptSuffix(parsed, [
      { name: '主角', appearance: '黑色长发' },
    ])
    expect(result).toBe('')
  })

  it('null/undefined 值被安全跳过', () => {
    const jsons: (string | null | undefined)[] = [null, undefined, null]

    const parsed = parseShotAppearancesRaw(jsons)
    expect(parsed).toEqual([])
  })

  it('部分有效部分无效 JSON 时，仅使用有效的数据', () => {
    const validRecord: CharacterAppearanceRecord = [
      {
        name: '主角',
        appearance: {
          hair: '红色短发',
          clothing: '黑色夹克',
          accessories: '',
          makeup: '',
        },
      },
    ]

    const jsons: (string | null | undefined)[] = [
      '这不是有效JSON',
      JSON.stringify(validRecord),
      '{broken}',
    ]

    const parsed = parseShotAppearancesRaw(jsons)

    // 仅有效的 JSON 被解析
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual(validRecord)

    // 有效数据正常参与决策
    const result = buildAppearancePromptSuffix(parsed, [
      { name: '主角', appearance: '黑色长发、白色衬衫' },
    ])
    expect(result).toContain('本镜头中主角的造型：')
  })

  it('JSON 解析为非数组时被忽略', () => {
    const jsons = [
      JSON.stringify({ name: '主角', appearance: {} }), // 对象而非数组
      JSON.stringify('just a string'), // 字符串
      JSON.stringify(123), // 数字
    ]

    const parsed = parseShotAppearancesRaw(jsons)
    expect(parsed).toEqual([])
  })

  it('空数组 JSON "[]" 解析成功但不影响决策', () => {
    const jsons = ['[]', '[]']

    const parsed = parseShotAppearancesRaw(jsons)

    // 空数组被正确解析
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual([])
    expect(parsed[1]).toEqual([])

    // 空数组不产生任何角色外观，聚合后为空 Map
    const result = buildAppearancePromptSuffix(parsed, [
      { name: '主角', appearance: '黑色长发' },
    ])
    expect(result).toBe('')
  })

  it('全部为无效 JSON 时整体流程不受影响（降级为无外观感知模式）', () => {
    const jsons = [
      'corrupt data',
      '<!DOCTYPE html>',
      'NaN',
    ]

    // parseShotAppearancesRaw 不抛错
    expect(() => parseShotAppearancesRaw(jsons)).not.toThrow()

    const parsed = parseShotAppearancesRaw(jsons)
    expect(parsed).toEqual([])

    // 无外观数据时 characterPrefix 无额外追加
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色长发' },
      { name: '女主', appearance: '棕色卷发' },
    ]
    const result = buildAppearancePromptSuffix(parsed, characters)
    expect(result).toBe('')
  })
})

// ========================
// 测试：多 Shot 聚合后的外观追加决策
// ========================
describe('group-gen-context 多 Shot 聚合决策', () => {
  it('多个 Shot 聚合取众数后与全局比对', () => {
    // 3 个 Shot 中主角发型：黑色短发(2次) vs 金色短发(1次) → 聚合为黑色短发
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '白衬衫', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '蓝外套', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '金色短发', clothing: '蓝外套', accessories: '', makeup: '' } }],
    ]

    // 全局外观与聚合后众数一致（黑色短发、蓝外套）
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、蓝外套' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    // 聚合后 hair=黑色短发(众数), clothing=蓝外套(众数)
    // 与全局 "黑色短发、蓝外套" 一致，不追加
    expect(result).toBe('')
  })

  it('多个 Shot 聚合取众数后与全局存在差异时追加', () => {
    // 3 个 Shot 中主角发型：红色长发(2次) vs 黑色短发(1次) → 聚合为红色长发
    const shotAppearancesRaw: CharacterAppearanceRecord[] = [
      [{ name: '主角', appearance: { hair: '红色长发', clothing: '黑衣', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '红色长发', clothing: '黑衣', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '白衣', accessories: '', makeup: '' } }],
    ]

    // 全局外观为"黑色短发、白衬衫"，与聚合后（红色长发、黑衣）不同
    const characters: CharacterInfo[] = [
      { name: '主角', appearance: '黑色短发、白衬衫' },
    ]

    const result = buildAppearancePromptSuffix(shotAppearancesRaw, characters)

    expect(result).toContain('本镜头中主角的造型：')
    expect(result).toContain('红色长发')
    expect(result).toContain('黑衣')
  })

  it('空 shotAppearancesRaw 数组不追加任何文案', () => {
    const result = buildAppearancePromptSuffix([], [
      { name: '主角', appearance: '黑色长发' },
    ])
    expect(result).toBe('')
  })
})
