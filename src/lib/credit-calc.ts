/**
 * 积分计算纯函数（客户端/服务端共用）
 *
 * 本文件不 import 任何服务端模块（prisma/redis/distributed-lock），
 * 可安全在 'use client' 组件中使用。
 */

/** 超分目标分辨率类型 */
export type UpscaleResolution = '480p' | '720p' | '1080p'

/**
 * 估算超分导出积分消耗
 *
 * 导出阶段专用公式（与生成阶段 estimateCreditCost 独立）：
 * - 480p: 0 积分（合并导出免费）
 * - 720p: 0 积分（合并+超分免费）
 * - 1080p: ceil(duration × 1.33) 积分（30秒≈40积分）
 *
 * @param duration 视频时长（秒）
 * @param resolution 目标分辨率：'480p' | '720p' | '1080p'
 * @returns 超分消耗积分数（非负整数）
 */
export function estimateUpscaleCreditCost(duration: number, resolution: UpscaleResolution): number {
  if (resolution === '1080p') return Math.ceil(duration * 1.33)
  return 0 // 480p、720p 免费
}

/**
 * 估算生成阶段积分消耗
 * duration × (resolution === '720p' ? 1.5 : 1.0)，向上取整
 */
export function estimateCreditCost(duration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(duration * multiplier)
}

/**
 * 估算解析阶段积分消耗
 * 公式：ceil(duration × 0.5)
 */
export function estimateParseCreditCost(duration: number): number {
  return Math.ceil(duration * 0.5)
}
