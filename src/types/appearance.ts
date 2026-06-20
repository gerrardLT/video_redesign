/**
 * 角色外观描述类型定义
 * 用于表示分镜中每位角色的造型信息（发型、服装、配饰、妆容）
 */

/**
 * 角色外观描述，四个维度均为文本描述
 * 无法识别时对应维度为空字符串
 */
export interface AppearanceDescriptor {
  /** 发型描述（如"黑色长发马尾"） */
  hair: string
  /** 服装描述（如"白色衬衫搭配深蓝色西裤"） */
  clothing: string
  /** 配饰描述（如"金色耳环、黑框眼镜"） */
  accessories: string
  /** 妆容描述（如"淡妆、红色口红"） */
  makeup: string
}

/**
 * 角色外观记录数组类型
 * 用于持久化到 Shot.characterAppearances 字段（JSON 序列化存储）
 */
export type CharacterAppearanceRecord = Array<{
  /** 角色名称 */
  name: string
  /** 该角色的外观描述 */
  appearance: AppearanceDescriptor
}>
