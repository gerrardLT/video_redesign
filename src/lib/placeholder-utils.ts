/**
 * 占位符管理纯函数模块
 *
 * 提供参考图 [Image N] 占位符的插入、移除重编号功能，
 * 以及参考图文件校验和剩余时间格式化工具函数。
 * 本模块为纯函数，可安全在 'use client' 组件和服务端使用。
 */

/** 占位符正则：匹配 [Image N]（N 为正整数） */
const PLACEHOLDER_REGEX = /\[Image (\d+)\]/g

/**
 * 在指定位置插入占位符
 *
 * @param text 原始文本
 * @param position 插入位置（光标位置，-1 表示末尾）
 * @param imageIndex 图片序号 (1-based)
 * @returns 插入后的文本
 */
export function insertPlaceholder(text: string, position: number, imageIndex: number): string {
  const placeholder = `[Image ${imageIndex}]`

  if (position === -1 || position >= text.length) {
    return text + placeholder
  }

  if (position <= 0) {
    return placeholder + text
  }

  return text.slice(0, position) + placeholder + text.slice(position)
}

/**
 * 移除指定序号的占位符并重新编号
 *
 * @param text 包含占位符的文本
 * @param removedIndex 被移除的图片序号 (1-based)
 * @returns 重编号后的文本
 */
export function removePlaceholderAndRenumber(text: string, removedIndex: number): string {
  // 先移除目标占位符
  const targetPlaceholder = `[Image ${removedIndex}]`
  let result = text.replace(targetPlaceholder, '')

  // 重编号：将所有大于 removedIndex 的占位符序号减 1
  result = result.replace(PLACEHOLDER_REGEX, (match, numStr) => {
    const num = parseInt(numStr, 10)
    if (num > removedIndex) {
      return `[Image ${num - 1}]`
    }
    return match
  })

  return result
}

/** 允许的参考图文件类型 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 参考图最大文件大小 (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024

/**
 * 校验文件是否满足上传条件
 *
 * @param file 文件元数据（type 和 size）
 * @returns { valid: boolean, reason?: string }
 */
export function validateReferenceImage(file: { type: string; size: number }): { valid: boolean; reason?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, reason: '仅支持 JPEG/PNG/WEBP 格式' }
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, reason: '文件大小不能超过 20MB' }
  }

  return { valid: true }
}

/**
 * 格式化剩余时间秒数为可读文本
 *
 * 规则：
 * - 0-59 秒 → "约 N 秒"
 * - 60-3599 秒 → "约 M 分 N 秒"
 * - ≥ 3600 秒 → "约 H 小时 M 分"
 *
 * @param seconds 剩余秒数（非负整数）
 * @returns 格式化文本
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds < 0) seconds = 0
  seconds = Math.round(seconds)

  if (seconds < 60) {
    return `约 ${seconds} 秒`
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) {
      return `约 ${minutes} 分`
    }
    return `约 ${minutes} 分 ${remainingSeconds} 秒`
  }

  const hours = Math.floor(seconds / 3600)
  const remainingMinutes = Math.floor((seconds % 3600) / 60)
  if (remainingMinutes === 0) {
    return `约 ${hours} 小时`
  }
  return `约 ${hours} 小时 ${remainingMinutes} 分`
}
