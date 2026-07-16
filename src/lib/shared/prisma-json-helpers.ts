/**
 * Prisma JSON 列类型转换辅助
 *
 * 封装 `as unknown as Prisma.InputJsonValue` 强制转换为具名函数，
 * 提升可读性并集中管理类型转换点。
 *
 * 用法：
 *   import { toJson } from '@/lib/shared/prisma-json-helpers'
 *   platformCopies: toJson(draft.platformCopies),
 */

import type { Prisma } from '@/generated/prisma'

/**
 * 将任意 JS 值安全转换为 Prisma InputJsonValue 类型。
 *
 * 适用于 JSON 列写入时的类型桥接（如 platformCopies / provenance / renderParams 等）。
 * 运行时零开销（仅类型转换），确保调用方代码整洁。
 *
 * @param value 任意 JS 值（对象、数组、null 等）
 * @returns Prisma InputJsonValue 兼容值
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

/**
 * Prisma JSON 列 -> string[]，null/非数组返回空数组。
 *
 * Prisma JSON 列运行时类型为 unknown（JsonValue），此函数统一做安全转换，
 * 过滤非字符串元素。适用于 mainProducts / mainSellingPoints / hookKeywords 等字段。
 */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v: unknown): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Prisma JSON 列 -> 指定类型 T，解析失败返回 fallback。
 *
 * 适用于 JSON 列读取时的类型桥接（如 provenance / scoreWeight / platformCopies 等）。
 * 支持已解析对象和 JSON 字符串两种输入。
 */
export function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return value as T
}
