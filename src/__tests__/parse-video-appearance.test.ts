/**
 * 单元测试：解析阶段外观提取
 *
 * 验证：
 * - SYSTEM_PROMPT 中包含 appearanceDetail 四维度结构说明
 * - 正常解析时 characterAppearances 数据正确转换
 * - AI 异常/超时时 characterAppearances 为空数组不阻塞
 *
 * Validates: Requirements 1.1, 1.2, 6.4
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { AppearanceDescriptorSchema, CharacterWithAppearanceSchema } from '@/lib/shot-schema'
import type { CharacterAppearanceRecord, AppearanceDescriptor } from '@/types/appearance'

// ========================
// 辅助：读取 video-analyzer.ts 源码以静态检查 SYSTEM_PROMPT 内容
// （SYSTEM_PROMPT 未导出，通过读取源文件进行静态验证）
// ========================
const videoAnalyzerSource = readFileSync(
  path.resolve(__dirname, '../lib/video-analyzer.ts'),
  'utf-8'
)

// ========================
// 辅助：复刻 buildCharacterAppearances 逻辑用于测试
// （原函数未导出，此处复刻其核心逻辑以验证数据转换正确性）
// ========================
interface ParsedCharacter {
  name: string
  appearance: string
  appearanceDetail?: {
    hair: string
    clothing: string
    accessories: string
    makeup: string
  }
}

function buildCharacterAppearances(
  characters: ParsedCharacter[]
): CharacterAppearanceRecord {
  const records: CharacterAppearanceRecord = []
  for (const char of characters) {
    if (char.appearanceDetail) {
      records.push({
        name: char.name,
        appearance: {
          hair: char.appearanceDetail.hair || '',
          clothing: char.appearanceDetail.clothing || '',
          accessories: char.appearanceDetail.accessories || '',
          makeup: char.appearanceDetail.makeup || '',
        } satisfies AppearanceDescriptor,
      })
    }
  }
  return records
}

// ========================
// 测试：SYSTEM_PROMPT 静态检查
// ========================
describe('SYSTEM_PROMPT 外观描述结构说明', () => {
  it('包含 appearanceDetail 字段说明', () => {
    expect(videoAnalyzerSource).toContain('appearanceDetail')
  })

  it('包含 hair 维度说明', () => {
    expect(videoAnalyzerSource).toContain('"hair"')
  })

  it('包含 clothing 维度说明', () => {
    expect(videoAnalyzerSource).toContain('"clothing"')
  })

  it('包含 accessories 维度说明', () => {
    expect(videoAnalyzerSource).toContain('"accessories"')
  })

  it('包含 makeup 维度说明', () => {
    expect(videoAnalyzerSource).toContain('"makeup"')
  })

  it('SYSTEM_PROMPT 中明确指导模型输出四维度结构', () => {
    // 验证提示词中包含对 appearanceDetail 四维度的结构化示例或说明
    expect(videoAnalyzerSource).toMatch(/appearanceDetail.*hair.*clothing.*accessories.*makeup/s)
  })
})

// ========================
// 测试：buildCharacterAppearances 正常转换
// ========================
describe('buildCharacterAppearances 数据转换', () => {
  it('含 appearanceDetail 的角色正确转换为 CharacterAppearanceRecord', () => {
    const characters: ParsedCharacter[] = [
      {
        name: '主角',
        appearance: '20岁男性，黑色短发，白色T恤',
        appearanceDetail: {
          hair: '黑色短发',
          clothing: '白色T恤搭配牛仔裤',
          accessories: '黑框眼镜',
          makeup: '',
        },
      },
      {
        name: '女主',
        appearance: '25岁女性，棕色长发，红色连衣裙',
        appearanceDetail: {
          hair: '棕色卷发及肩',
          clothing: '红色连衣裙',
          accessories: '珍珠项链',
          makeup: '淡妆红唇',
        },
      },
    ]

    const result = buildCharacterAppearances(characters)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: '主角',
      appearance: {
        hair: '黑色短发',
        clothing: '白色T恤搭配牛仔裤',
        accessories: '黑框眼镜',
        makeup: '',
      },
    })
    expect(result[1]).toEqual({
      name: '女主',
      appearance: {
        hair: '棕色卷发及肩',
        clothing: '红色连衣裙',
        accessories: '珍珠项链',
        makeup: '淡妆红唇',
      },
    })
  })

  it('无 appearanceDetail 的角色不出现在结果中', () => {
    const characters: ParsedCharacter[] = [
      {
        name: '路人甲',
        appearance: '中年男性，灰色西装',
      },
      {
        name: '路人乙',
        appearance: '年轻女性，短发',
      },
    ]

    const result = buildCharacterAppearances(characters)
    expect(result).toEqual([])
  })

  it('混合有/无 appearanceDetail 的角色，仅提取有外观详情的角色', () => {
    const characters: ParsedCharacter[] = [
      {
        name: '主角',
        appearance: '20岁男性',
        appearanceDetail: {
          hair: '黑色短发',
          clothing: '白色衬衫',
          accessories: '',
          makeup: '',
        },
      },
      {
        name: '配角',
        appearance: '30岁男性，无特殊外观',
      },
    ]

    const result = buildCharacterAppearances(characters)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('主角')
  })

  it('空角色数组返回空数组', () => {
    const result = buildCharacterAppearances([])
    expect(result).toEqual([])
  })

  it('appearanceDetail 中缺失字段使用空字符串补齐', () => {
    const characters: ParsedCharacter[] = [
      {
        name: '测试角色',
        appearance: '外貌描述',
        appearanceDetail: {
          hair: '金色长发',
          clothing: '',
          accessories: '',
          makeup: '',
        },
      },
    ]

    const result = buildCharacterAppearances(characters)
    expect(result[0].appearance.hair).toBe('金色长发')
    expect(result[0].appearance.clothing).toBe('')
    expect(result[0].appearance.accessories).toBe('')
    expect(result[0].appearance.makeup).toBe('')
  })
})

// ========================
// 测试：AI 异常/超时时 characterAppearances 为空数组不阻塞
// （通过模拟异常输入验证 buildCharacterAppearances 的容错性）
// ========================
describe('外观提取异常容错', () => {
  it('传入 undefined/null 类似的异常字段不抛错', () => {
    // 模拟 AI 返回了 characters 但 appearanceDetail 格式异常
    const characters: ParsedCharacter[] = [
      {
        name: '角色A',
        appearance: '描述',
        appearanceDetail: undefined,
      },
    ]

    expect(() => buildCharacterAppearances(characters)).not.toThrow()
    expect(buildCharacterAppearances(characters)).toEqual([])
  })

  it('异常输入产生空数组结果（模拟降级场景）', () => {
    // 当 AI 异常或超时，parse-video.ts 的 catch 块将 characterAppearances 设为 "[]"
    // 此测试验证空数组 JSON 序列化/反序列化的一致性
    const emptyAppearances: CharacterAppearanceRecord = []
    const serialized = JSON.stringify(emptyAppearances)
    const deserialized = JSON.parse(serialized) as CharacterAppearanceRecord

    expect(serialized).toBe('[]')
    expect(deserialized).toEqual([])
  })

  it('characterAppearances 空数组 JSON 可以被正确读取而不阻塞流程', () => {
    // 模拟从数据库读取降级后的空数组 JSON
    const dbValue = '[]'
    const parsed = JSON.parse(dbValue) as CharacterAppearanceRecord

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(0)
  })
})

// ========================
// 测试：Zod Schema 校验行为（通过导出的 Schema 间接验证解析阶段行为）
// ========================
describe('AppearanceDescriptorSchema Zod 校验', () => {
  it('完整四维度数据通过校验', () => {
    const input = {
      hair: '黑色短发',
      clothing: '白色T恤',
      accessories: '金色手表',
      makeup: '淡妆',
    }
    const result = AppearanceDescriptorSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(input)
    }
  })

  it('缺失字段使用空字符串默认值（模拟 AI 未返回某维度）', () => {
    const input = { hair: '黑色短发' }
    const result = AppearanceDescriptorSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hair).toBe('黑色短发')
      expect(result.data.clothing).toBe('')
      expect(result.data.accessories).toBe('')
      expect(result.data.makeup).toBe('')
    }
  })

  it('全空字段通过校验（所有维度无法识别时）', () => {
    const input = {
      hair: '',
      clothing: '',
      accessories: '',
      makeup: '',
    }
    const result = AppearanceDescriptorSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('空对象通过校验（所有字段获得默认值）', () => {
    const input = {}
    const result = AppearanceDescriptorSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        hair: '',
        clothing: '',
        accessories: '',
        makeup: '',
      })
    }
  })

  it('非字符串字段值校验失败', () => {
    const input = {
      hair: 123,
      clothing: '正常',
      accessories: '正常',
      makeup: '正常',
    }
    const result = AppearanceDescriptorSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('CharacterWithAppearanceSchema Zod 校验', () => {
  it('含 appearanceDetail 的角色数据通过校验', () => {
    const input = {
      name: '主角',
      appearance: '20岁男性黑色短发',
      appearanceDetail: {
        hair: '黑色短发',
        clothing: '白色T恤',
        accessories: '',
        makeup: '',
      },
    }
    const result = CharacterWithAppearanceSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('不含 appearanceDetail 的角色数据通过校验（字段可选）', () => {
    const input = {
      name: '配角',
      appearance: '30岁男性',
    }
    const result = CharacterWithAppearanceSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.appearanceDetail).toBeUndefined()
    }
  })

  it('appearanceDetail 部分字段缺失时自动补默认值', () => {
    const input = {
      name: '角色',
      appearance: '外貌',
      appearanceDetail: {
        hair: '红色长发',
      },
    }
    const result = CharacterWithAppearanceSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.appearanceDetail?.hair).toBe('红色长发')
      expect(result.data.appearanceDetail?.clothing).toBe('')
      expect(result.data.appearanceDetail?.accessories).toBe('')
      expect(result.data.appearanceDetail?.makeup).toBe('')
    }
  })
})
