/**
 * 工作台（Workspace）校验纯函数
 *
 * 包含 prompt 长度校验、文件类型/大小校验、素材引用插入等。
 * 不依赖服务端模块，可在客户端 / 服务端 / 测试中复用。
 */

import { FILE_LIMITS, MAX_PROMPT_LENGTH } from '@/constants/workspace'
import type { WorkspaceAssetType } from '@/types/workspace'

// ========================
// Prompt 校验
// ========================

/**
 * 校验 prompt 长度是否合法
 *
 * @param text prompt 文本
 * @returns true 表示合法（≤ 2500 字符）
 */
export function validatePromptLength(text: string): boolean {
  return text.length <= MAX_PROMPT_LENGTH
}

// ========================
// 文件校验
// ========================

/** 文件校验结果 */
export type FileValidationResult =
  | { valid: true; type: WorkspaceAssetType }
  | { valid: false; reason: string }

/**
 * 校验文件类型和大小
 *
 * @param fileName 文件名（用于错误提示）
 * @param mimeType 文件 MIME 类型
 * @param fileSize 文件大小（字节）
 * @returns 校验结果，合法时附带素材类型
 */
export function validateFile(
  fileName: string,
  mimeType: string,
  fileSize: number
): FileValidationResult {
  // 判断 mimeType 属于哪种素材类型
  let matchedType: WorkspaceAssetType | null = null

  for (const [assetType, config] of Object.entries(FILE_LIMITS)) {
    if (config.types.includes(mimeType)) {
      matchedType = assetType as WorkspaceAssetType
      break
    }
  }

  // 类型不在允许列表中
  if (!matchedType) {
    return {
      valid: false,
      reason: `文件 "${fileName}" 的类型 ${mimeType} 不被支持，仅允许图片(jpg/png/webp)、视频(mp4/mov/webm)和音频(mp3/wav/aac)`,
    }
  }

  // 大小超出限制
  const limit = FILE_LIMITS[matchedType]
  if (fileSize > limit.maxSize) {
    const maxMB = Math.round(limit.maxSize / (1024 * 1024))
    const actualMB = (fileSize / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      reason: `文件 "${fileName}" 大小 ${actualMB}MB 超出${matchedType === 'image' ? '图片' : matchedType === 'video' ? '视频' : '音频'}限制 ${maxMB}MB`,
    }
  }

  return { valid: true, type: matchedType }
}

// ========================
// 素材引用插入
// ========================

/**
 * 在 prompt 文本的指定光标位置插入素材引用标记
 *
 * @param text 原始文本
 * @param cursorPos 光标位置（0 ≤ cursorPos ≤ text.length）
 * @param assetName 素材名称（非空）
 * @returns 插入引用后的新文本
 */
export function insertAssetReference(
  text: string,
  cursorPos: number,
  assetName: string
): string {
  const reference = `@${assetName}`
  const prefix = text.slice(0, cursorPos)
  const suffix = text.slice(cursorPos)
  return prefix + reference + suffix
}
