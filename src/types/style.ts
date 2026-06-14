/**
 * 全局一致性设定的结构化类型定义
 * 用于 StyleConfig.structuredStyle 的 JSON 存储/读取
 */

/** 角色外貌设定 */
export interface StyleCharacter {
  /** 角色名 */
  name: string
  /** 外貌描述 */
  appearance: string
  /** 道具/配饰描述（可选） */
  props?: string
}

/** 结构化风格设定（存储为 JSON 字符串到 StyleConfig.structuredStyle） */
export interface StructuredStyle {
  /** 美术风格（如：写实3D风格、赛博朋克手绘风） */
  artStyle: string
  /** 色调（如：暖色调偏橙、冷色调偏蓝） */
  colorTone: string
  /** 角色设定（数组） */
  characters: StyleCharacter[]
  /** 字幕/旁白声明（如：无字幕、中文字幕） */
  subtitleDeclaration?: string
  /** 用户自由补充的额外说明 */
  extra?: string
}

/**
 * 将 StructuredStyle 渲染为扁平文本描述（供 mergeTimelineScript 的 stylePrefix 使用）
 * 每个非空字段用句号分隔
 */
export function renderStructuredStyleToText(style: StructuredStyle): string {
  const parts: string[] = []

  if (style.artStyle?.trim()) {
    parts.push(style.artStyle.trim())
  }
  if (style.colorTone?.trim()) {
    parts.push(style.colorTone.trim())
  }
  if (style.subtitleDeclaration?.trim()) {
    parts.push(style.subtitleDeclaration.trim())
  }
  if (style.characters?.length > 0) {
    const charDesc = style.characters
      .map((c) => `${c.name}：${c.appearance}${c.props ? '，' + c.props : ''}`)
      .join('；')
    parts.push(charDesc)
  }
  if (style.extra?.trim()) {
    parts.push(style.extra.trim())
  }

  return parts.join('。')
}

/**
 * 从 JSON 字符串安全解析 StructuredStyle
 * 解析失败返回 null
 */
export function parseStructuredStyle(json: string | null | undefined): StructuredStyle | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as StructuredStyle
  } catch {
    return null
  }
}
