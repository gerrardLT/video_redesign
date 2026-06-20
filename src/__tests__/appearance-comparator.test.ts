/**
 * 外观比对模块单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeAppearanceText,
  hasAppearanceChanged,
  hasGroupAppearanceChanged,
  formatAppearancePrompt,
  aggregateGroupAppearances,
} from '@/lib/appearance-comparator'
import type { AppearanceDescriptor } from '@/types/appearance'

describe('normalizeAppearanceText', () => {
  it('去除首尾空白', () => {
    expect(normalizeAppearanceText('  hello  ')).toBe('hello')
  })

  it('统一为小写', () => {
    expect(normalizeAppearanceText('Hello World')).toBe('hello world')
  })

  it('移除英文标点', () => {
    expect(normalizeAppearanceText('hello, world!')).toBe('hello world')
  })

  it('移除中文标点', () => {
    expect(normalizeAppearanceText('黑色长发，马尾辫。')).toBe('黑色长发马尾辫')
  })

  it('综合处理：空白+大小写+中英文标点', () => {
    expect(normalizeAppearanceText('  Hello， World! 你好。  ')).toBe('hello world 你好')
  })

  it('空字符串返回空字符串', () => {
    expect(normalizeAppearanceText('')).toBe('')
  })

  it('纯空白字符返回空字符串', () => {
    expect(normalizeAppearanceText('   ')).toBe('')
  })
})

describe('hasAppearanceChanged', () => {
  const base: AppearanceDescriptor = {
    hair: '黑色长发',
    clothing: '白色衬衫',
    accessories: '金色耳环',
    makeup: '淡妆',
  }

  it('完全相同返回 false', () => {
    expect(hasAppearanceChanged(base, { ...base })).toBe(false)
  })

  it('仅大小写/标点差异返回 false（规范化后一致）', () => {
    const next: AppearanceDescriptor = {
      hair: '黑色长发。',
      clothing: '白色衬衫，',
      accessories: '金色耳环！',
      makeup: '淡妆',
    }
    expect(hasAppearanceChanged(base, next)).toBe(false)
  })

  it('某维度存在实质差异返回 true', () => {
    const next: AppearanceDescriptor = {
      ...base,
      hair: '金色短发',
    }
    expect(hasAppearanceChanged(base, next)).toBe(true)
  })

  it('某维度在 prev 为空字符串时忽略', () => {
    const prev: AppearanceDescriptor = {
      ...base,
      hair: '',
    }
    const next: AppearanceDescriptor = {
      ...base,
      hair: '金色短发',
    }
    expect(hasAppearanceChanged(prev, next)).toBe(false)
  })

  it('某维度在 next 为空字符串时忽略', () => {
    const next: AppearanceDescriptor = {
      ...base,
      clothing: '',
    }
    expect(hasAppearanceChanged(base, next)).toBe(false)
  })

  it('所有维度均为空字符串返回 false', () => {
    const empty: AppearanceDescriptor = {
      hair: '',
      clothing: '',
      accessories: '',
      makeup: '',
    }
    expect(hasAppearanceChanged(empty, empty)).toBe(false)
  })

  it('仅空白/标点的维度规范化后视为空字符串，忽略该维度', () => {
    const prev: AppearanceDescriptor = {
      ...base,
      accessories: '  ，。 ',
    }
    const next: AppearanceDescriptor = {
      ...base,
      accessories: '珍珠项链',
    }
    // prev.accessories 规范化后为空字符串，应忽略
    expect(hasAppearanceChanged(prev, next)).toBe(false)
  })
})

describe('hasGroupAppearanceChanged', () => {
  it('无共有角色返回 false', () => {
    const prev = new Map<string, AppearanceDescriptor>([
      ['角色A', { hair: '黑色', clothing: '白色', accessories: '', makeup: '' }],
    ])
    const next = new Map<string, AppearanceDescriptor>([
      ['角色B', { hair: '黑色', clothing: '白色', accessories: '', makeup: '' }],
    ])
    expect(hasGroupAppearanceChanged(prev, next)).toBe(false)
  })

  it('共有角色外观一致返回 false', () => {
    const desc: AppearanceDescriptor = {
      hair: '黑色长发',
      clothing: '白色衬衫',
      accessories: '',
      makeup: '淡妆',
    }
    const prev = new Map<string, AppearanceDescriptor>([['主角', desc]])
    const next = new Map<string, AppearanceDescriptor>([['主角', { ...desc }]])
    expect(hasGroupAppearanceChanged(prev, next)).toBe(false)
  })

  it('共有角色外观存在差异返回 true', () => {
    const prev = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色长发', clothing: '白色衬衫', accessories: '', makeup: '' }],
    ])
    const next = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '金色短发', clothing: '白色衬衫', accessories: '', makeup: '' }],
    ])
    expect(hasGroupAppearanceChanged(prev, next)).toBe(true)
  })

  it('多个共有角色，其中一个变化即返回 true', () => {
    const prev = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色长发', clothing: '白色', accessories: '', makeup: '' }],
      ['女主', { hair: '棕色卷发', clothing: '红裙', accessories: '', makeup: '' }],
    ])
    const next = new Map<string, AppearanceDescriptor>([
      ['主角', { hair: '黑色长发', clothing: '白色', accessories: '', makeup: '' }],
      ['女主', { hair: '金色直发', clothing: '红裙', accessories: '', makeup: '' }],
    ])
    expect(hasGroupAppearanceChanged(prev, next)).toBe(true)
  })

  it('两个 Map 均为空返回 false', () => {
    const prev = new Map<string, AppearanceDescriptor>()
    const next = new Map<string, AppearanceDescriptor>()
    expect(hasGroupAppearanceChanged(prev, next)).toBe(false)
  })
})

describe('formatAppearancePrompt', () => {
  it('正常格式化：各维度非空描述用顿号拼接', () => {
    const appearance: AppearanceDescriptor = {
      hair: '黑色短发',
      clothing: '白色衬衫',
      accessories: '金色耳环',
      makeup: '淡妆',
    }
    const result = formatAppearancePrompt('主角', appearance)
    expect(result).toBe('本镜头中主角的造型：黑色短发、白色衬衫、金色耳环、淡妆')
  })

  it('跳过空字符串维度', () => {
    const appearance: AppearanceDescriptor = {
      hair: '黑色短发',
      clothing: '',
      accessories: '金色耳环',
      makeup: '',
    }
    const result = formatAppearancePrompt('女主', appearance)
    expect(result).toBe('本镜头中女主的造型：黑色短发、金色耳环')
  })

  it('所有维度为空返回空字符串', () => {
    const appearance: AppearanceDescriptor = {
      hair: '',
      clothing: '',
      accessories: '',
      makeup: '',
    }
    expect(formatAppearancePrompt('主角', appearance)).toBe('')
  })

  it('纯空白维度也视为空', () => {
    const appearance: AppearanceDescriptor = {
      hair: '   ',
      clothing: '  ',
      accessories: '',
      makeup: '  ',
    }
    expect(formatAppearancePrompt('主角', appearance)).toBe('')
  })

  it('总长度不超过默认 80 字符，超长时截断加省略号', () => {
    const appearance: AppearanceDescriptor = {
      hair: '这是一个非常非常非常长的发型描述用来测试截断功能是否正常工作的文本',
      clothing: '这也是一个非常非常长的服装描述用来测试总长度控制能力',
      accessories: '超长配饰描述文本测试',
      makeup: '超长妆容描述文本测试',
    }
    const result = formatAppearancePrompt('主角', appearance)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result.endsWith('…')).toBe(true)
  })

  it('正好 80 字符不截断', () => {
    // 前缀 "本镜头中主角的造型：" = 10 个字符
    // 需要描述部分正好 70 个字符
    const desc = '一'.repeat(70)
    const appearance: AppearanceDescriptor = {
      hair: desc,
      clothing: '',
      accessories: '',
      makeup: '',
    }
    const result = formatAppearancePrompt('主角', appearance)
    expect(result.length).toBe(80)
    expect(result).toBe(`本镜头中主角的造型：${desc}`)
  })

  it('自定义 maxLength 限制', () => {
    const appearance: AppearanceDescriptor = {
      hair: '黑色短发',
      clothing: '白色衬衫搭配深蓝色西裤',
      accessories: '金色耳环',
      makeup: '淡妆红唇',
    }
    const result = formatAppearancePrompt('主角', appearance, 30)
    expect(result.length).toBeLessThanOrEqual(30)
    expect(result.endsWith('…')).toBe(true)
  })

  it('只有一个维度非空且未超长', () => {
    const appearance: AppearanceDescriptor = {
      hair: '黑色短发',
      clothing: '',
      accessories: '',
      makeup: '',
    }
    const result = formatAppearancePrompt('主角', appearance)
    expect(result).toBe('本镜头中主角的造型：黑色短发')
  })
})

describe('aggregateGroupAppearances', () => {
  it('单个 Shot 单个角色：直接返回该角色外观', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '白色衬衫', accessories: '', makeup: '淡妆' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.size).toBe(1)
    expect(result.get('主角')).toEqual({
      hair: '黑色短发',
      clothing: '白色衬衫',
      accessories: '',
      makeup: '淡妆',
    })
  })

  it('多个 Shot 同一角色：取每个维度的众数', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '白色衬衫', accessories: '金表', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '蓝色外套', accessories: '金表', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '蓝色外套', accessories: '银链', makeup: '' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.get('主角')).toEqual({
      hair: '黑色短发',       // 3次，众数
      clothing: '蓝色外套',   // 2次 > 1次
      accessories: '金表',    // 2次 > 1次
      makeup: '',             // 全为空
    })
  })

  it('平局时取首次出现的描述', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '黑色', clothing: '', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '金色', clothing: '', accessories: '', makeup: '' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    // 黑色和金色各出现1次，平局取首次出现的"黑色"
    expect(result.get('主角')!.hair).toBe('黑色')
  })

  it('所有值均为空字符串时该维度结果为空字符串', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '', clothing: '', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '', clothing: '', accessories: '', makeup: '' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.get('主角')).toEqual({
      hair: '',
      clothing: '',
      accessories: '',
      makeup: '',
    })
  })

  it('空字符串不参与众数统计', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '', clothing: '', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '', clothing: '', accessories: '', makeup: '' } }],
      [{ name: '主角', appearance: { hair: '黑色短发', clothing: '', accessories: '', makeup: '' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    // 虽然空字符串出现2次，但被忽略，非空"黑色短发"出现1次为众数
    expect(result.get('主角')!.hair).toBe('黑色短发')
  })

  it('多个角色各自独立聚合', () => {
    const shotAppearances = [
      [
        { name: '主角', appearance: { hair: '黑色', clothing: '白衬衫', accessories: '', makeup: '' } },
        { name: '女主', appearance: { hair: '棕色卷发', clothing: '红裙', accessories: '珍珠项链', makeup: '红唇' } },
      ],
      [
        { name: '主角', appearance: { hair: '黑色', clothing: '蓝外套', accessories: '', makeup: '' } },
        { name: '女主', appearance: { hair: '棕色卷发', clothing: '红裙', accessories: '珍珠项链', makeup: '淡妆' } },
      ],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.size).toBe(2)
    expect(result.get('主角')!.hair).toBe('黑色')
    expect(result.get('女主')!.clothing).toBe('红裙')
    expect(result.get('女主')!.accessories).toBe('珍珠项链')
  })

  it('空数组输入返回空 Map', () => {
    const result = aggregateGroupAppearances([])
    expect(result.size).toBe(0)
  })

  it('包含空 Shot 数组的输入正常处理', () => {
    const shotAppearances = [
      [],
      [{ name: '主角', appearance: { hair: '黑色', clothing: '', accessories: '', makeup: '' } }],
      [],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.size).toBe(1)
    expect(result.get('主角')!.hair).toBe('黑色')
  })

  it('角色只在部分 Shot 中出现时正常聚合', () => {
    const shotAppearances = [
      [{ name: '主角', appearance: { hair: '黑色', clothing: '白衬衫', accessories: '', makeup: '' } }],
      [
        { name: '主角', appearance: { hair: '黑色', clothing: '白衬衫', accessories: '', makeup: '' } },
        { name: '配角', appearance: { hair: '红色', clothing: '黑裤', accessories: '', makeup: '' } },
      ],
      [{ name: '配角', appearance: { hair: '红色', clothing: '灰衣', accessories: '', makeup: '' } }],
    ]
    const result = aggregateGroupAppearances(shotAppearances)
    expect(result.size).toBe(2)
    expect(result.get('主角')!.hair).toBe('黑色')
    expect(result.get('配角')!.hair).toBe('红色')
    expect(result.get('配角')!.clothing).toBe('黑裤') // 平局取首次出现
  })
})
