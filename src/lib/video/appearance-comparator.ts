/**
 * 角色外观比对模块
 * 提供外观文本规范化、单角色外观变化检测、组级外观变化检测、组级外观聚合等功能
 */

import type { AppearanceDescriptor } from '@/types/appearance'

/** 外观比对涉及的四个维度 */
const APPEARANCE_DIMENSIONS: Array<keyof AppearanceDescriptor> = [
  'hair',
  'clothing',
  'accessories',
  'makeup',
]

/**
 * 中英文标点正则（覆盖常见中文标点和 ASCII 标点）
 * 包括：句号、逗号、顿号、分号、冒号、问号、叹号、引号、括号、破折号、省略号等
 */
const PUNCTUATION_REGEX =
  /[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g

/**
 * 文本规范化：去除首尾空白、统一小写、移除标点符号（中英文标点）
 * 纯函数，用于外观比对前的噪声消除
 */
export function normalizeAppearanceText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, '')
}

/**
 * 比对两个 AppearanceDescriptor 是否存在差异
 *
 * 规则：
 * - 逐维度比对（hair, clothing, accessories, makeup）
 * - 某维度在任一侧为空字符串时忽略该维度
 * - 比对前执行 normalizeAppearanceText 规范化
 * - 任一非空维度存在差异即返回 true（外观变化）
 */
export function hasAppearanceChanged(
  prev: AppearanceDescriptor,
  next: AppearanceDescriptor
): boolean {
  for (const dim of APPEARANCE_DIMENSIONS) {
    const prevVal = normalizeAppearanceText(prev[dim])
    const nextVal = normalizeAppearanceText(next[dim])

    // 某维度在任一侧为空字符串时忽略该维度
    if (prevVal === '' || nextVal === '') {
      continue
    }

    // 规范化后比较，不相等即存在差异
    if (prevVal !== nextVal) {
      return true
    }
  }

  return false
}

/**
 * 比对两组中所有共有角色的外观是否发生变化
 *
 * 规则：
 * - 提取两组中共有的角色名集合
 * - 对每个共有角色调用 hasAppearanceChanged
 * - 任一角色外观变化即返回 true
 * - 无共有角色时返回 false（不影响承接决策）
 */
export function hasGroupAppearanceChanged(
  prevAppearances: Map<string, AppearanceDescriptor>,
  nextAppearances: Map<string, AppearanceDescriptor>
): boolean {
  // 提取共有角色名集合
  const commonCharacters: string[] = []
  for (const name of prevAppearances.keys()) {
    if (nextAppearances.has(name)) {
      commonCharacters.push(name)
    }
  }

  // 无共有角色时返回 false
  if (commonCharacters.length === 0) {
    return false
  }

  // 对每个共有角色检测外观变化
  for (const name of commonCharacters) {
    const prevDesc = prevAppearances.get(name)!
    const nextDesc = nextAppearances.get(name)!

    if (hasAppearanceChanged(prevDesc, nextDesc)) {
      return true
    }
  }

  return false
}

/**
 * 格式化外观差异文案，控制在 maxLength 字符以内
 *
 * 格式：「本镜头中{角色名}的造型：{各维度非空描述用顿号拼接}」
 * 超长时从末尾截断描述部分并加省略号「…」
 * 所有维度均为空字符串时返回空字符串
 *
 * @param characterName - 角色名称
 * @param appearance - 外观描述对象
 * @param maxLength - 最大总字符数，默认 80
 * @returns 格式化后的外观提示文案，或空字符串
 */
export function formatAppearancePrompt(
  characterName: string,
  appearance: AppearanceDescriptor,
  maxLength: number = 80
): string {
  // 收集所有非空维度的描述文本
  const descriptions: string[] = []
  for (const dim of APPEARANCE_DIMENSIONS) {
    const val = appearance[dim].trim()
    if (val !== '') {
      descriptions.push(val)
    }
  }

  // 所有维度均为空时返回空字符串
  if (descriptions.length === 0) {
    return ''
  }

  // 构建前缀和描述文本
  const prefix = `本镜头中${characterName}的造型：`
  const descriptionText = descriptions.join('、')
  const fullText = prefix + descriptionText

  // 总长度未超限，直接返回
  if (fullText.length <= maxLength) {
    return fullText
  }

  // 超长时截断描述部分并加省略号「…」
  // 可用描述长度 = maxLength - 前缀长度 - 省略号长度(1)
  const availableLength = maxLength - prefix.length - 1
  if (availableLength <= 0) {
    // 前缀本身就超长，截断整个文本
    return fullText.slice(0, maxLength - 1) + '…'
  }

  const truncatedDescription = descriptionText.slice(0, availableLength)
  return prefix + truncatedDescription + '…'
}


/**
 * 从一组 Shot 的 characterAppearances 中聚合出每位角色的代表外观。
 * 按维度取众数（出现频率最高的非空描述），平局时取首次出现。
 *
 * 逻辑：
 * 1. 遍历所有 Shot 的外观数据，按角色名收集每个维度的描述值
 * 2. 对每个角色的每个维度，统计非空描述的出现次数
 * 3. 取出现频率最高的描述作为该维度的代表值
 * 4. 若多个描述频率相同（平局），取首次出现的那个
 * 5. 若所有值均为空字符串，该维度结果为空字符串
 */
export function aggregateGroupAppearances(
  shotAppearances: Array<Array<{ name: string; appearance: AppearanceDescriptor }>>
): Map<string, AppearanceDescriptor> {
  // 按角色名收集每个维度的所有描述值（保留出现顺序）
  // 结构：Map<角色名, Map<维度, 描述值数组>>
  const characterDimValues = new Map<string, Map<keyof AppearanceDescriptor, string[]>>()

  for (const shotChars of shotAppearances) {
    for (const { name, appearance } of shotChars) {
      // 初始化该角色的维度收集器
      if (!characterDimValues.has(name)) {
        const dimMap = new Map<keyof AppearanceDescriptor, string[]>()
        for (const dim of APPEARANCE_DIMENSIONS) {
          dimMap.set(dim, [])
        }
        characterDimValues.set(name, dimMap)
      }

      const dimMap = characterDimValues.get(name)!
      // 收集该角色在当前 Shot 中每个维度的描述值
      for (const dim of APPEARANCE_DIMENSIONS) {
        dimMap.get(dim)!.push(appearance[dim])
      }
    }
  }

  // 对每个角色的每个维度取众数，生成代表外观
  const result = new Map<string, AppearanceDescriptor>()

  for (const [name, dimMap] of characterDimValues) {
    const aggregated: AppearanceDescriptor = {
      hair: '',
      clothing: '',
      accessories: '',
      makeup: '',
    }

    for (const dim of APPEARANCE_DIMENSIONS) {
      const values = dimMap.get(dim)!
      aggregated[dim] = getModeValue(values)
    }

    result.set(name, aggregated)
  }

  return result
}

/**
 * 取众数：从一组字符串值中返回出现频率最高的非空描述。
 * - 忽略空字符串
 * - 平局时取首次出现的描述
 * - 所有值均为空字符串时返回空字符串
 */
function getModeValue(values: string[]): string {
  // 统计每个非空描述的出现次数，同时记录首次出现的索引
  const countMap = new Map<string, { count: number; firstIndex: number }>()

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    // 忽略空字符串
    if (val === '') {
      continue
    }

    if (countMap.has(val)) {
      countMap.get(val)!.count++
    } else {
      countMap.set(val, { count: 1, firstIndex: i })
    }
  }

  // 所有值均为空字符串时返回空字符串
  if (countMap.size === 0) {
    return ''
  }

  // 取出现频率最高者；平局时取首次出现（firstIndex 更小）的那个
  let bestValue = ''
  let bestCount = 0
  let bestFirstIndex = Infinity

  for (const [val, { count, firstIndex }] of countMap) {
    if (count > bestCount || (count === bestCount && firstIndex < bestFirstIndex)) {
      bestValue = val
      bestCount = count
      bestFirstIndex = firstIndex
    }
  }

  return bestValue
}
